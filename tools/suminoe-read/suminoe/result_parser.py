"""競走成績（K ファイル）のパーサ。

番組表（B）と同じく cp932・固定長。桁位置は 2026-08-06 の実データで確認した。

構造（住之江セクション `12KBGN`〜`12KEND`）:

    12KBGN
    住之江［成績］      8/ 6      にっぽん未来プロジェ  第 3日
    ...
       [払戻金]       ３連単           ３連複           ２連単         ２連複
               1R  1-3-2    1650    1-2-3     250    1-3    1130    1-3     500
               ...                                        ← 全12レースの一覧
       1R       予選         H1800m  晴　  風  南東　 3m  波　  1cm   ← レースヘッダ
      着 艇 登番 　選　手　名　　ﾓｰﾀｰ ﾎﾞｰﾄ 展示 進入 ｽﾀｰﾄﾀｲﾐﾝｸ ﾚｰｽﾀｲﾑ 逃げ ← 末尾が決まり手
    -----------------------------------------------------------------
      01  1 5186 遠　藤　　圭　吾 68   50  6.96   1    0.11     1.52.2  ← 着順行(66バイト)
      ...
            単勝     1          200
            複勝     1          120  3          160
            ２連単   1-3       1130  人気     4
            ...                                        ← 賭式ごとの払戻

**着順は払戻金の3連単から取る**（着順行には失格 `S0`/`F` などが混ざるため）。
着順行からは進入コース・ST・展示タイムを取る。
"""

from __future__ import annotations

import re
import unicodedata

from .models import SUMINOE_JCD
from .result_models import (
    BET_EXACTA,
    BET_PLACE,
    BET_QUINELLA,
    BET_TRIFECTA,
    BET_TRIO,
    BET_WIDE,
    BET_WIN,
    Payout,
    RaceResult,
    ResultDay,
    ResultEntry,
)

#: 着順行のバイト長
ENTRY_BYTES = 66

# 着順行のフィールド（cp932 バイトオフセット。終了は排他）
F_RANK = (0, 4)
F_TEIBAN = (4, 7)
F_TOBAN = (7, 12)
F_NAME = (12, 29)
F_MOTOR = (29, 32)
F_BOAT = (32, 37)
F_TENJI = (37, 43)
F_COURSE = (43, 47)
F_ST = (47, 55)
F_RACE_TIME = (55, ENTRY_BYTES)

#: レースヘッダ。NFKC 正規化後に適用する
RE_RESULT_HEADER = re.compile(
    r"(\d{1,2})R\s+(.+?)\s+[A-Z]?(\d{3,4})m"
    r"(?:\s+(\S+?)\s*風\s+(\S+?)\s*(\d+)m\s*波\s*(\d+)cm)?"
)

#: 着順行の先頭（着順 + 艇番）。着順は数字2桁・F・L・K0・S0 などが入る
RE_ENTRY_HEAD = re.compile(r"^\s{2}(\d{2}|[A-Z]\d?|[A-Z])\s+([1-6])\s+\d{4}")

#: 払戻金の一覧表の1行（3連単・3連複・2連単・2連複）
RE_PAYOUT_TABLE = re.compile(
    r"(\d{1,2})R\s+"
    r"(\d-\d-\d)\s+(\d+)\s+"
    r"(\d-\d-\d)\s+(\d+)\s+"
    r"(\d-\d)\s+(\d+)\s+"
    r"(\d-\d)\s+(\d+)"
)

#: 賭式ごとの払戻明細。賭式名は省略されることがある（拡連複の2行目以降）
RE_PAYOUT_DETAIL = re.compile(
    r"^\s+(単勝|複勝|２連単|２連複|拡連複|３連単|３連複)?\s*"
    r"((?:\d(?:-\d)*\s+\d+\s*(?:人気\s+\d+)?\s*)+)$"
)
RE_PAYOUT_PAIR = re.compile(r"(\d(?:-\d)*)\s+(\d+)(?:\s+人気\s+(\d+))?")

BET_ORDER = (BET_WIN, BET_PLACE, BET_EXACTA, BET_QUINELLA, BET_WIDE, BET_TRIFECTA, BET_TRIO)

#: 決まり手として認める語。これ以外が来たら生の値をそのまま保持する
KNOWN_KIMARITE = ("逃げ", "まくり差し", "まくり", "差し", "抜き", "恵まれ")


class ResultParseError(Exception):
    """成績のパース失敗。レース単位で捕捉し、全体を止めない。"""


def _nfkc(text: str) -> str:
    return unicodedata.normalize("NFKC", text)


def _slice(row: bytes, span: tuple[int, int]) -> str:
    return row[span[0] : span[1]].decode("cp932", errors="replace").strip()


def _opt_int(raw: str) -> int | None:
    try:
        return int(raw)
    except ValueError:
        return None


def _opt_float(raw: str) -> float | None:
    # F は「F.01」のように、L は空欄で来ることがある
    cleaned = raw.replace("F", "-").strip()
    try:
        return float(cleaned)
    except ValueError:
        return None


def normalize_racer_name(raw: str) -> str:
    """成績ファイルの選手名は全角スペースで区切られている。詰めて返す。"""
    return raw.replace("　", "").strip()


def extract_section(text: str, jcd: int = SUMINOE_JCD) -> list[str]:
    begin = f"{jcd:02d}KBGN"
    end = f"{jcd:02d}KEND"
    lines = text.splitlines()
    try:
        start = next(i for i, line in enumerate(lines) if line.strip() == begin)
        stop = next(i for i, line in enumerate(lines) if line.strip() == end)
    except StopIteration:
        return []
    return lines[start + 1 : stop]


def parse_payout_table(section: list[str]) -> dict[int, list[Payout]]:
    """先頭の払戻金一覧から、レース番号ごとの払戻を取り出す。

    ここで取れるのは3連単・3連複・2連単・2連複の4つ。
    単勝・複勝・拡連複はレースごとの明細から拾う。
    """
    table: dict[int, list[Payout]] = {}
    for line in section:
        match = RE_PAYOUT_TABLE.search(_nfkc(line))
        if not match:
            continue
        race_no = int(match.group(1))
        table[race_no] = [
            Payout(BET_TRIFECTA, _combo(match.group(2)), int(match.group(3))),
            Payout(BET_TRIO, _combo(match.group(4)), int(match.group(5))),
            Payout(BET_EXACTA, _combo(match.group(6)), int(match.group(7))),
            Payout(BET_QUINELLA, _combo(match.group(8)), int(match.group(9))),
        ]
    return table


def _combo(raw: str) -> tuple[int, ...]:
    return tuple(int(part) for part in raw.split("-"))


def parse_result_header(line: str) -> tuple[int, str, str, str, int | None, int | None] | None:
    """レースヘッダから (レース番号, レース名, 天候, 風向, 風速m, 波高cm) を取る。"""
    match = RE_RESULT_HEADER.search(_nfkc(line))
    if not match:
        return None
    race_no = int(match.group(1))
    if not 1 <= race_no <= 12:
        return None
    return (
        race_no,
        match.group(2).replace("　", "").strip(),
        (match.group(4) or "").replace("　", "").strip(),
        (match.group(5) or "").replace("　", "").strip(),
        _opt_int(match.group(6) or ""),
        _opt_int(match.group(7) or ""),
    )


def looks_like_entry_row(line: str) -> bool:
    return bool(RE_ENTRY_HEAD.match(line))


def parse_entry_row(line: str) -> ResultEntry:
    """着順行1行を ResultEntry に変換する。"""
    row = line.encode("cp932", errors="replace")
    if len(row) < ENTRY_BYTES:
        row = row.ljust(ENTRY_BYTES, b" ")

    rank_raw = _slice(row, F_RANK)
    teiban = _opt_int(_slice(row, F_TEIBAN))
    toban = _opt_int(_slice(row, F_TOBAN))
    if teiban is None or toban is None:
        raise ResultParseError(f"艇番または登番を読めません: {line!r}")

    return ResultEntry(
        rank_raw=rank_raw,
        rank=_opt_int(rank_raw),
        teiban=teiban,
        toban=toban,
        name=normalize_racer_name(row[F_NAME[0] : F_NAME[1]].decode("cp932", errors="replace")),
        motor_no=_opt_int(_slice(row, F_MOTOR)),
        boat_no=_opt_int(_slice(row, F_BOAT)),
        tenji=_opt_float(_slice(row, F_TENJI)),
        course=_opt_int(_slice(row, F_COURSE)),
        st=_opt_float(_slice(row, F_ST)),
        race_time=_slice(row, F_RACE_TIME),
    )


def _extract_kimarite(header_line: str) -> str:
    """列見出し行の末尾に決まり手が入っている（公式フォーマットの仕様）。"""
    tail = header_line.replace("　", " ").rstrip()
    for kimarite in KNOWN_KIMARITE:
        if tail.endswith(kimarite):
            return kimarite
    # 未知の語が来たら末尾の語をそのまま返す（欠場・不成立など）
    parts = tail.split()
    return parts[-1] if parts else ""


def parse_payout_details(lines: list[str]) -> list[Payout]:
    """レースごとの払戻明細（単勝〜3連複）を読む。"""
    payouts: list[Payout] = []
    current_type: str | None = None
    for line in lines:
        normalized = _nfkc(line).rstrip()
        if not normalized.strip():
            continue
        match = RE_PAYOUT_DETAIL.match(line.rstrip())
        if not match:
            continue
        if match.group(1):
            current_type = match.group(1)
        if current_type is None:
            continue
        for pair in RE_PAYOUT_PAIR.finditer(_nfkc(match.group(2))):
            payouts.append(
                Payout(
                    bet_type=current_type,
                    combo=_combo(pair.group(1)),
                    amount=int(pair.group(2)),
                    popularity=_opt_int(pair.group(3) or ""),
                )
            )
    return payouts


def parse_results(text: str, date: str, jcd: int = SUMINOE_JCD) -> ResultDay:
    """成績テキストから、指定場のその日の結果をまとめる。"""
    section = extract_section(text, jcd)
    if not section:
        raise ResultParseError(
            f"{date} の成績に場コード {jcd:02d} のセクションがありません（開催なしの可能性）"
        )

    place, title, day_label = _parse_heading(section)
    payout_table = parse_payout_table(section)

    races: list[RaceResult] = []
    warnings: list[str] = []

    # レースヘッダの位置で区切る
    header_indexes = [
        i for i, line in enumerate(section) if parse_result_header(line) is not None
    ]
    # 払戻金一覧の行もヘッダの正規表現に当たるため、着順行が続くものだけを残す
    header_indexes = [
        i
        for i in header_indexes
        if any(looks_like_entry_row(line) for line in section[i + 1 : i + 12])
    ]

    for position, start in enumerate(header_indexes):
        stop = header_indexes[position + 1] if position + 1 < len(header_indexes) else len(section)
        block = section[start:stop]
        header = parse_result_header(block[0])
        if header is None:
            continue
        race_no, name, weather, wind_dir, wind_m, wave_cm = header

        kimarite = ""
        entries: list[ResultEntry] = []
        for line in block[1:]:
            if "着" in line and "艇" in line and "登番" in line:
                kimarite = _extract_kimarite(line)
                continue
            if looks_like_entry_row(line):
                try:
                    entries.append(parse_entry_row(line))
                except ResultParseError as exc:
                    warnings.append(f"{race_no}R: 着順行のパース失敗 ({exc})")

        payouts = list(payout_table.get(race_no, []))
        payouts.extend(parse_payout_details(block))

        # 着順は3連単の払戻（着順どおりの組み合わせ）から取るのが最も確実
        trifecta = next((p for p in payouts if p.bet_type == BET_TRIFECTA), None)
        if trifecta is not None:
            order = trifecta.combo
        else:
            order = tuple(
                e.teiban for e in sorted(entries, key=lambda e: e.rank or 99) if e.finished
            )[:3]
            if order:
                warnings.append(f"{race_no}R: 3連単の払戻が無いため着順行から着順を組み立てました")

        error = None
        if len(order) < 3:
            error = "着順を確定できませんでした"
            warnings.append(f"{race_no}R: {error}")

        races.append(
            RaceResult(
                race_no=race_no,
                name=name,
                weather=weather,
                wind_dir=wind_dir,
                wind_m=wind_m,
                wave_cm=wave_cm,
                kimarite=kimarite,
                order=order,
                entries=tuple(sorted(entries, key=lambda e: e.teiban)),
                payouts=tuple(_dedupe_payouts(payouts)),
                parse_error=error,
            )
        )

    if not races:
        raise ResultParseError(f"{date}: レースを1件も検出できませんでした（まだ開催前の可能性）")

    return ResultDay(
        date=date,
        place=place,
        title=title,
        day_label=day_label,
        races=tuple(sorted(races, key=lambda r: r.race_no)),
        warnings=tuple(warnings),
    )


def _dedupe_payouts(payouts: list[Payout]) -> list[Payout]:
    """一覧表と明細で重複する払戻を、人気の情報があるほうを残して1つにする。"""
    best: dict[tuple[str, tuple[int, ...]], Payout] = {}
    for payout in payouts:
        key = (payout.bet_type, payout.combo)
        existing = best.get(key)
        if existing is None or (existing.popularity is None and payout.popularity is not None):
            best[key] = payout
    return sorted(best.values(), key=lambda p: (BET_ORDER.index(p.bet_type) if p.bet_type in BET_ORDER else 99, p.combo))


def _parse_heading(section: list[str]) -> tuple[str, str, str]:
    place = ""
    title = ""
    day_label = ""
    for i, line in enumerate(section[:12]):
        stripped = line.strip()
        if not place and "ボートレース" in stripped:
            match = re.search(r"(ボートレース\S+?)(?:\s|$)", _nfkc(stripped))
            if match:
                place = match.group(1).replace("　", "")
        if not day_label:
            match = re.search(r"第\s*[0-9]+日", _nfkc(stripped))
            if match:
                day_label = match.group(0)
        if not title and "競走成績" in stripped:
            for candidate in section[i + 1 : i + 4]:
                if candidate.strip():
                    title = candidate.strip().replace("　", "")
                    break
    if not place:
        place = "ボートレース住之江"
    return place, title, day_label
