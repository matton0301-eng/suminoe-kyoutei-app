"""月間スケジュール（公式）から、住之江の開催日を取り出す。

    https://www.boatrace.jp/owpc/pc/race/monthlyschedule?ym=YYYYMM

**表は月初から始まらない。** 2026年8月のページは 7/28 から 9/4 までの39日ぶんを
1行に並べている。**列の位置を月初と決めつけると必ずずれる**ので、
ヘッダーの日付から起点を割り出すこと。

1つの節（開催）は `colspan="N"` の1セルで表され、N がそのまま日数になる。
セル内のリンクの `hd=` は**当てにならない**:

  - 終わった節は `raceindex?...&hd=` で、値は**最終日**（2026-08-09 の節がそう）
  - これからの節は `assen?...&hd=` で、値は**初日**

なので日付は `hd` ではなく**セルの位置と colspan から**決める。
2026年8月の実データで検算した: 住之江は 8/4〜8/9 と 8/13〜8/18。
前者は手元の番組表・競走成績（8/6〜8/9）と一致する。
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, timedelta

#: 住之江の場コード
SUMINOE_JCD = 12

#: グレードを表す class 名。公式のスタイル名から拾う
_GRADE_LABELS = {
    "is-gradeColorSG": "SG",
    "is-gradeColorPG1": "PG1",
    "is-gradeColorG1": "G1",
    "is-gradeColorG2": "G2",
    "is-gradeColorG3": "G3",
    "is-gradeColorIppan": "一般",
    "is-gradeColorRookie": "ルーキー",
    "is-gradeColorVenus": "ヴィーナス",
    "is-gradeColorTakeuchi": "レディース",
}


@dataclass(frozen=True)
class Series:
    """1つの節（開催）。"""

    name: str
    grade: str | None
    start: date
    end: date

    @property
    def days(self) -> list[date]:
        span = (self.end - self.start).days + 1
        return [self.start + timedelta(days=i) for i in range(span)]


class ScheduleParseError(Exception):
    """スケジュールを読み取れなかった。**推測で埋めない。**"""


class SchedulePendingError(ScheduleParseError):
    """その月のスケジュールがまだ公開されていない。

    先の月を要求すると、200 は返るが日程表そのものが無いページが返る
    （2026-10 を 2026-08 時点で取ると、ヘッダーごと存在しない）。
    **これは異常ではない。** 解析の失敗と混ぜると、
    「先の月が未公開なだけ」で今月のスケジュールまで捨てることになる。
    """


def _strip_tags(html: str) -> str:
    return re.sub(r"<[^>]+>", "", html).replace("&nbsp;", " ").strip()


def _header_days(html: str) -> list[int]:
    """ヘッダーの日付列（[28, 29, 30, 31, 1, 2, ...]）を返す。"""
    head = re.search(r"<thead>.*?</thead>", html, re.S)
    if not head:
        raise SchedulePendingError("この月のスケジュールはまだ公開されていません")
    cells = re.findall(r"<th[^>]*>(.*?)</th>", head.group(0), re.S)
    days: list[int] = []
    for cell in cells:
        matched = re.match(r"(\d{1,2})", _strip_tags(cell))
        if matched:
            days.append(int(matched.group(1)))
    if not days:
        raise ScheduleParseError("ヘッダーから日付を読み取れません")
    return days


def _column_dates(html: str, year: int, month: int) -> list[date]:
    """列ごとの日付。ヘッダーの「1」が現れる位置を対象月の1日として合わせる。"""
    days = _header_days(html)
    try:
        first = days.index(1)
    except ValueError as exc:
        raise ScheduleParseError("ヘッダーに対象月の1日が見つかりません") from exc

    origin = date(year, month, 1) - timedelta(days=first)
    return [origin + timedelta(days=i) for i in range(len(days))]


def _venue_row(html: str, jcd: int) -> str:
    """その場の行だけを切り出す。"""
    pattern = rf"<tr[^>]*>\s*<th[^>]*>\s*<a href=/owpc/pc/data/stadium\?jcd={jcd:02d}>.*?</tr>"
    matched = re.search(pattern, html, re.S)
    if not matched:
        raise ScheduleParseError(f"jcd={jcd} の行が見つかりません")
    return matched.group(0)


def parse_month(html: str, year: int, month: int, jcd: int = SUMINOE_JCD) -> list[Series]:
    """月間スケジュールのHTMLから、その場の節を取り出す。"""
    dates = _column_dates(html, year, month)
    row = _venue_row(html, jcd)
    cells = re.findall(r"<td([^>]*)>(.*?)</td>", row, re.S)

    series: list[Series] = []
    column = 0
    for attrs, body in cells:
        span_match = re.search(r'colspan\s*=\s*"?(\d+)', attrs)
        span = int(span_match.group(1)) if span_match else 1
        name = _strip_tags(body)

        # 名前が入っているセルだけが開催。空セル（&nbsp;）は非開催日
        if name and column < len(dates):
            end_index = min(column + span - 1, len(dates) - 1)
            grade = next(
                (label for key, label in _GRADE_LABELS.items() if key in attrs),
                None,
            )
            series.append(
                Series(name=name, grade=grade, start=dates[column], end=dates[end_index])
            )
        column += span

    return series


def race_days(series: list[Series], year: int, month: int) -> list[date]:
    """対象月に入る開催日だけを、重複なく昇順で返す。

    節は月をまたぐことがあるので、**対象月の外は落とす**
    （隣の月は隣の月のページで取る。二重に数えない）。
    """
    seen: set[date] = set()
    for entry in series:
        for day in entry.days:
            if day.year == year and day.month == month:
                seen.add(day)
    return sorted(seen)
