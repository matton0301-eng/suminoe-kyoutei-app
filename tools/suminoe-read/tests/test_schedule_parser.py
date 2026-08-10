"""月間スケジュールのパーサのテスト。

**実データ（2026-08 の公式ページ）を fixture に同梱**しているので、
ネット接続なしで通る。

いちばん守りたいのは日付の対応。表は月初から始まらず、2026年8月のページは
7/28 始まりになっている。ここを取り違えると、開催日が数日ずれたまま
「今日は開催なし」と判断してしまい、その日のオッズを永久に失う。
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from suminoe.schedule_parser import (
    ScheduleParseError,
    SchedulePendingError,
    parse_month,
    race_days,
)

FIXTURE = Path(__file__).parent / "fixtures" / "monthlyschedule_202608.html"


@pytest.fixture(scope="module")
def html() -> str:
    return FIXTURE.read_text(encoding="utf-8")


def test_住之江の節を2つ取れる(html: str) -> None:
    series = parse_month(html, 2026, 8)
    assert len(series) == 2
    assert series[0].name == "にっぽん未来プロジェクト競走ｉｎ住之江"
    assert series[1].name == "大阪ダービー第４３回摂河泉競走"


def test_節の日付が実データと一致する(html: str) -> None:
    """8/9 の舟券は「第05回06日」。6日間の最終日が 8/9 なので初日は 8/4。"""
    series = parse_month(html, 2026, 8)
    assert series[0].start == date(2026, 8, 4)
    assert series[0].end == date(2026, 8, 9)
    assert len(series[0].days) == 6


def test_次の節も位置から決まる(html: str) -> None:
    series = parse_month(html, 2026, 8)
    assert series[1].start == date(2026, 8, 13)
    assert series[1].end == date(2026, 8, 18)


def test_手元に実データがある日はすべて開催日に入る(html: str) -> None:
    """8/6〜8/9 は番組表・競走成績を実際に取得できている日。"""
    days = race_days(parse_month(html, 2026, 8), 2026, 8)
    for day in (6, 7, 8, 9):
        assert date(2026, 8, day) in days, f"8/{day} が開催日に入っていない"


def test_開催のない日は入らない(html: str) -> None:
    days = race_days(parse_month(html, 2026, 8), 2026, 8)
    for day in (1, 2, 3, 10, 11, 12, 19, 20, 31):
        assert date(2026, 8, day) not in days, f"8/{day} は開催がないはず"


def test_開催日数の合計(html: str) -> None:
    days = race_days(parse_month(html, 2026, 8), 2026, 8)
    assert len(days) == 12, "6日間の節が2つ"


def test_グレードを拾う(html: str) -> None:
    series = parse_month(html, 2026, 8)
    assert series[0].grade == "一般"


def test_対象月の外は落とす(html: str) -> None:
    """節が月をまたぐことがある。隣の月は隣の月のページで取る。"""
    days = race_days(parse_month(html, 2026, 8), 2026, 7)
    assert days == []


def test_他の場も同じ解釈で取れる(html: str) -> None:
    """尼崎（jcd=13）の最初の節は 7/31〜8/4。

    **月をまたぐ節の例。** セル内のリンクは `hd=20260804` だが、これは初日ではなく
    **最終日**。住之江の 8/9 の節（hd=20260809 で最終日）と同じ規則で、
    位置と colspan から日付を決めるやり方が正しいことの裏付けになる。
    """
    series = parse_month(html, 2026, 8, jcd=13)
    assert series[0].start == date(2026, 7, 31)
    assert series[0].end == date(2026, 8, 4)


def test_存在しない場は明確に失敗する(html: str) -> None:
    """**推測で空を返さない。** 黙って「開催なし」になるのがいちばん困る。"""
    with pytest.raises(ScheduleParseError):
        parse_month(html, 2026, 8, jcd=99)


def test_壊れたHTMLは明確に失敗する() -> None:
    with pytest.raises(ScheduleParseError):
        parse_month("<html><body>なにもない</body></html>", 2026, 8)


def test_未公開の月は解析失敗と区別する() -> None:
    """先の月を要求すると 200 だが日程表の無いページが返る。

    これを解析失敗と同じ扱いにすると、「来月が未公開なだけ」で
    今月のスケジュールまで捨てることになる（実際に一度そうなった）。
    """
    with pytest.raises(SchedulePendingError):
        parse_month("<html><body><table></table></body></html>", 2026, 10)


def test_未公開エラーは解析エラーの一種(html: str) -> None:
    """呼び出し側が ScheduleParseError だけを捕まえても取りこぼさない。"""
    assert issubclass(SchedulePendingError, ScheduleParseError)
