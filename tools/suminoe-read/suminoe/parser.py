"""番組表テキスト（cp932・固定長）のパーサ。

桁位置は docs/03-bangumihyou-format.md §6 の確定表に従う。
2026-08-06 の実データ（全10場・選手行720行）でエラー0件を確認済みのため、
**この定義を推測で書き換えないこと。**
"""

from __future__ import annotations

import re
import unicodedata

from .models import SUMINOE_JCD, Program, Race, Racer

#: 選手行のバイト長（cp932エンコード後）
ROW_BYTES = 79

#: フィールドのバイトオフセット (開始, 終了)。終了は排他。
F_TEIBAN = (0, 1)
F_TOBAN = (2, 6)
F_NAME = (6, 14)
F_AGE = (14, 16)
F_BRANCH = (16, 20)
F_WEIGHT = (20, 22)
F_KYUBETSU = (22, 24)
F_Z_SHORITSU = (24, 29)
F_Z_2RITSU = (29, 35)
F_T_SHORITSU = (35, 41)
F_T_2RITSU = (41, 47)
F_MOTOR_NO = (47, 50)
F_MOTOR_2RITSU = (50, 56)
F_BOAT_NO = (56, 59)
F_BOAT_2RITSU = (59, 65)
F_KONSETSU = (65, 77)
F_HAYAMI = (77, ROW_BYTES)

#: レースヘッダ。NFKC正規化後の文字列に適用する。
#: 例: " 1R  予選              H1800m  電話投票締切予定15:17"
RE_RACE_HEADER = re.compile(
    r"(\d{1,2})R\s+(.+?)\s+[A-Z]?(\d{3,4})m\s+電話投票締切予定(\d{1,2}:\d{2})"
)

#: 選手行の先頭パターン（艇番 + 半角スペース + 登番4桁）
RE_ROW_HEAD = re.compile(r"^[1-6] \d{4}")

#: 節の日次（"第　３日" など）
RE_DAY_LABEL = re.compile(r"第\s*[0-9]+日")

VALID_KYUBETSU = ("A1", "A2", "B1", "B2")


class ParseError(Exception):
    """パース失敗。レース単位で捕捉し、全体を止めずに警告として残す。"""


def _nfkc(text: str) -> str:
    """全角英数・記号・全角スペースを半角へ正規化する。"""
    return unicodedata.normalize("NFKC", text)


def _slice(row: bytes, span: tuple[int, int]) -> str:
    return row[span[0] : span[1]].decode("cp932", errors="replace").strip()


def _to_int(raw: str, label: str) -> int:
    try:
        return int(raw)
    except ValueError as exc:
        raise ParseError(f"{label} を整数として読めません: {raw!r}") from exc


def _to_float(raw: str, label: str) -> float:
    try:
        return float(raw)
    except ValueError as exc:
        raise ParseError(f"{label} を小数として読めません: {raw!r}") from exc


def normalize_name(raw: str) -> str:
    """選手名の全角スペース詰めを除去する（例: "岩井　繁" -> "岩井繁"）。"""
    return raw.replace("　", "").strip()


def looks_like_racer_row(line: str) -> bool:
    return bool(RE_ROW_HEAD.match(line))


def parse_racer_row(line: str) -> Racer:
    """選手行1行を Racer に変換する。

    行が 79 バイトに満たない場合（末尾空白が失われた場合）は右側を空白で埋める。
    """
    row = line.encode("cp932", errors="replace")
    if len(row) < ROW_BYTES:
        row = row.ljust(ROW_BYTES, b" ")
    elif len(row) > ROW_BYTES:
        raise ParseError(f"選手行が {len(row)} バイトです（期待 {ROW_BYTES}）: {line!r}")

    kyubetsu = _slice(row, F_KYUBETSU)
    if kyubetsu not in VALID_KYUBETSU:
        raise ParseError(f"級別が不正です: {kyubetsu!r}")

    return Racer(
        teiban=_to_int(_slice(row, F_TEIBAN), "艇番"),
        toban=_to_int(_slice(row, F_TOBAN), "登番"),
        name=normalize_name(row[F_NAME[0] : F_NAME[1]].decode("cp932", errors="replace")),
        age=_to_int(_slice(row, F_AGE), "年齢"),
        branch=_slice(row, F_BRANCH),
        weight=_to_int(_slice(row, F_WEIGHT), "体重"),
        kyubetsu=kyubetsu,  # type: ignore[arg-type]
        zenkoku_shoritsu=_to_float(_slice(row, F_Z_SHORITSU), "全国勝率"),
        zenkoku_2ritsu=_to_float(_slice(row, F_Z_2RITSU), "全国2連対率"),
        touchi_shoritsu=_to_float(_slice(row, F_T_SHORITSU), "当地勝率"),
        touchi_2ritsu=_to_float(_slice(row, F_T_2RITSU), "当地2連対率"),
        motor_no=_to_int(_slice(row, F_MOTOR_NO), "モーター番号"),
        motor_2ritsu=_to_float(_slice(row, F_MOTOR_2RITSU), "モーター2連対率"),
        boat_no=_to_int(_slice(row, F_BOAT_NO), "ボート番号"),
        boat_2ritsu=_to_float(_slice(row, F_BOAT_2RITSU), "ボート2連対率"),
        konsetsu=row[F_KONSETSU[0] : F_KONSETSU[1]].decode("cp932", errors="replace").rstrip(),
        hayami=_slice(row, F_HAYAMI),
    )


def parse_race_header(line: str) -> tuple[int, str, int, str] | None:
    """レースヘッダ行から (レース番号, レース名, 距離m, 締切時刻) を取り出す。"""
    m = RE_RACE_HEADER.search(_nfkc(line))
    if not m:
        return None
    race_no = int(m.group(1))
    name = m.group(2).strip()
    if not 1 <= race_no <= 12:
        return None
    return race_no, name, int(m.group(3)), m.group(4)


def extract_section(text: str, jcd: int = SUMINOE_JCD) -> list[str]:
    """`{jcd}BBGN` 〜 `{jcd}BEND` の行を切り出す。開催がなければ空リスト。"""
    begin = f"{jcd:02d}BBGN"
    end = f"{jcd:02d}BEND"
    lines = text.splitlines()
    try:
        start = next(i for i, line in enumerate(lines) if line.strip() == begin)
        stop = next(i for i, line in enumerate(lines) if line.strip() == end)
    except StopIteration:
        return []
    return lines[start + 1 : stop]


def parse_program(text: str, date: str, jcd: int = SUMINOE_JCD) -> Program:
    """番組表テキスト全体から、指定場のその日の Program を組み立てる。

    パースできなかったレースは `parse_error` を持つ Race として残し、全体を止めない。
    """
    section = extract_section(text, jcd)
    if not section:
        raise ParseError(
            f"{date} の番組表に場コード {jcd:02d} のセクションがありません（本日は開催なしの可能性）"
        )

    place, title, day_label = _parse_section_heading(section)

    races: list[Race] = []
    warnings: list[str] = []
    pending: tuple[int, str, int, str] | None = None
    racers: list[Racer] = []

    def flush() -> None:
        nonlocal pending, racers
        if pending is None:
            return
        race_no, name, distance, deadline = pending
        error = None
        if len(racers) != 6:
            error = f"選手行が {len(racers)} 行しか取れませんでした（期待6行）"
            warnings.append(f"{race_no}R: {error}")
        races.append(
            Race(
                race_no=race_no,
                name=name,
                distance_m=distance,
                deadline=deadline,
                racers=tuple(sorted(racers, key=lambda r: r.teiban)),
                parse_error=error,
            )
        )
        pending, racers = None, []

    for line in section:
        header = parse_race_header(line)
        if header is not None:
            flush()
            pending = header
            continue
        if pending is not None and looks_like_racer_row(line):
            try:
                racers.append(parse_racer_row(line))
            except ParseError as exc:
                warnings.append(f"{pending[0]}R: 選手行のパース失敗 ({exc})")
    flush()

    if not races:
        raise ParseError(f"{date}: レースヘッダを1件も検出できませんでした")

    return Program(
        date=date,
        place=place,
        title=title,
        day_label=day_label,
        races=tuple(sorted(races, key=lambda r: r.race_no)),
        warnings=tuple(warnings),
    )


def _parse_section_heading(section: list[str]) -> tuple[str, str, str]:
    """場名・節名・日次を取り出す。取れなかった項目は空文字を返す（致命的ではない）。"""
    place = ""
    title = ""
    day_label = ""

    for i, line in enumerate(section[:12]):
        stripped = line.strip()
        if not place and "ボートレース" in stripped:
            m = re.search(r"(ボートレース\S+?)(?:\s|$)", _nfkc(stripped))
            if m:
                place = m.group(1).replace("　", "")
        if not day_label:
            m = RE_DAY_LABEL.search(_nfkc(stripped))
            if m:
                day_label = m.group(0)
        if not title and "番組表" in stripped:
            for candidate in section[i + 1 : i + 4]:
                if candidate.strip():
                    title = candidate.strip().replace("　", "")
                    break

    return place, title, day_label
