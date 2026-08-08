"""直前情報ページ（beforeinfo）のパーサ。

    https://www.boatrace.jp/owpc/pc/race/beforeinfo?rno={R}&jcd=12&hd={YYYYMMDD}

番組表・成績と違って HTML なので、公式がページ構造を変えればここが落ちる。
**fixture が正**（tests/fixtures/beforeinfo_*.html は実ページをそのまま保存したもの）。
セレクタを勘で直さず、まず fixture を取り直して構造を確かめること。

依存を増やさないため標準ライブラリの html.parser で書いている（requirements.txt 参照）。
汎用の DOM は作らず、必要な3か所だけを状態機械で拾う。

## ページ構造（2026-08-08 の実データで確認）

**出走表テーブル**: 1艇 = 1 tbody。td の並びは先頭から

    0:艇番 1:写真 2:選手名 3:体重 4:展示タイム 5:チルト 6:プロペラ 7:部品交換

    艇番セルの class が `is-boatColor{N}` になっている。8番目より後ろは
    **その選手のその日の前走**（R・進入・ST・着順）で、そこの艇番セルにも
    同じ `is-boatColor{N}` が付く。素朴に class だけで拾うと1レースが最大12艇に
    膨らむため、**tbody ごとに最初の1つだけ**を艇番として採る。
    1R は前走が無いので露見しない（実データ12レースで発覚。fixture の 9R が回帰テスト）。

**スタート展示テーブル**: 行の並びが**コース順**（1行目 = 1コース）。
    行の中の数字が艇番なので、前づけがあると行番号と艇番がずれる。
    ST は ".19"（0.19）、フライングは "F.06"（-0.06）。

**気象**: `weather1_bodyUnit is-{種別}` で種別が分かる。風向だけは方位名の文字列が無く、
    アイコンの class（`is-wind1`〜`is-wind17`）でしか公開されていない。

未公開のレース（周回展示前）も同じ骨組みで返り、値だけが空になる。
展示タイムが1つも取れないことをもって available=False とする。
"""

from __future__ import annotations

import re
from html.parser import HTMLParser

from .beforeinfo_models import RaceBeforeInfo, TenjiEntry, WeatherInfo
from .result_parser import normalize_racer_name

#: 出走表テーブルで1艇ぶんに使う td の数（艇番〜部品交換）。
#: これより後ろは結果欄なので読み捨てる。
BOAT_CELL_COUNT = 8

#: td の並び（BOAT_CELL_COUNT 個ぶん）
CELL_WEIGHT = 3
CELL_TENJI = 4
CELL_TILT = 5
CELL_PROPELLER = 6

_BOAT_COLOR = re.compile(r"is-boatColor(\d)")
_WIND_ICON = re.compile(r"is-wind(\d+)\b")
_OBSERVED_AT = re.compile(r"(\d{1,2}:\d{2})")


class BeforeInfoParseError(Exception):
    """直前情報のパース失敗。レース単位で捕捉し、その日全体を止めない。"""


class _RawBoat:
    """収集途中の1艇ぶん。確定前なので可変。"""

    def __init__(self, teiban: int) -> None:
        self.teiban = teiban
        self.cells: list[str] = []
        self.parts: list[str] = []


def _has_class(classes: str, name: str) -> bool:
    """class 属性をトークンで比べる。

    部分文字列で見ると `weather1_bodyUnitLabel` が `weather1_bodyUnit` に
    誤ってあたる（実際に踏んだ）。
    """
    return name in classes.split()


def _unit_kind(classes: str) -> str | None:
    """`weather1_bodyUnit is-wave` → "wave"。is-wind と is-windDirection を取り違えない。"""
    for token in classes.split():
        if token.startswith("is-"):
            return token[3:]
    return None


class _Extractor(HTMLParser):
    """必要な断片だけを拾う。data の行き先を1つだけ持つ単純な状態機械。"""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.boats: list[_RawBoat] = []
        #: スタート展示。上の行から順に (艇番, ST の生文字列)
        self.starts: list[list[str]] = []
        #: 気象ユニット。種別 → {"title", "data", "icon"}
        self.weather: dict[str, dict[str, str]] = {}
        self.observed_at: str | None = None

        self._sink: str | None = None
        self._buf: list[str] = []
        self._boat: _RawBoat | None = None
        #: いま読んでいる tbody で艇番セルを見たか。前走欄の艇番を弾くために使う
        self._boat_taken = False
        self._in_parts = False
        self._unit: str | None = None

    # --- 収集の開始と確定 ---
    def _start(self, sink: str) -> None:
        self._sink = sink
        self._buf = []

    def _take(self) -> str:
        text = "".join(self._buf).strip()
        self._sink = None
        self._buf = []
        return text

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        classes = dict(attrs).get("class") or ""

        if tag == "tbody":
            # 1艇 = 1 tbody。またいだら前の艇のセルに続きを足さない
            self._boat = None
            self._boat_taken = False
            return

        if tag == "td":
            matched = _BOAT_COLOR.search(classes)
            if matched and not self._boat_taken:
                self._boat_taken = True
                self._boat = _RawBoat(int(matched.group(1)))
                self.boats.append(self._boat)
            self._in_parts = _has_class(classes, "is-p5-5")
            self._start("cell")
            return

        if tag == "li" and self._in_parts:
            self._start("part")
            return

        if tag == "span":
            if _has_class(classes, "table1_boatImage1Number"):
                self._start("st_teiban")
            elif _has_class(classes, "table1_boatImage1Time"):
                self._start("st_time")
            elif _has_class(classes, "weather1_bodyUnitLabelTitle"):
                self._start("w_title")
            elif _has_class(classes, "weather1_bodyUnitLabelData"):
                self._start("w_data")
            return

        if tag == "div" and _has_class(classes, "weather1_bodyUnit"):
            self._unit = _unit_kind(classes)
            if self._unit:
                self.weather.setdefault(self._unit, {})
            return

        if tag == "p":
            if _has_class(classes, "weather1_title"):
                self._start("observed")
            elif _has_class(classes, "weather1_bodyUnitImage") and self._unit:
                self.weather[self._unit]["icon"] = classes

    def handle_data(self, data: str) -> None:
        if self._sink is not None:
            self._buf.append(data)

    def handle_endtag(self, tag: str) -> None:
        if self._sink is None:
            return

        if tag == "td" and self._sink == "cell":
            text = self._take()
            if self._boat is not None and len(self._boat.cells) < BOAT_CELL_COUNT:
                self._boat.cells.append(text)
            return

        if tag == "li" and self._sink == "part":
            text = self._take()
            if self._boat is not None and text:
                self._boat.parts.append(text)
            return

        if tag == "p" and self._sink == "observed":
            matched = _OBSERVED_AT.search(self._take())
            self.observed_at = matched.group(1) if matched else None
            return

        if tag != "span":
            return

        if self._sink == "st_teiban":
            self.starts.append([self._take(), ""])
        elif self._sink == "st_time":
            time_text = self._take()
            if self.starts:
                self.starts[-1][1] = time_text
        elif self._sink in {"w_title", "w_data"} and self._unit:
            # _take() が _sink を消すので、キーを先に確定させる
            key = self._sink.removeprefix("w_")
            self.weather[self._unit][key] = self._take()


# --- 値の変換 ---
def _number(raw: str, suffix: str = "") -> float | None:
    """"52.0kg" → 52.0。空欄（&nbsp;）や想定外の文字列は None。"""
    text = raw.strip().replace(suffix, "").strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _int_number(raw: str, suffix: str = "") -> int | None:
    value = _number(raw, suffix)
    return None if value is None else int(value)


def _start_timing(raw: str) -> float | None:
    """".19" → 0.19、"F.06" → -0.06。出遅れ（L）はタイミングを持たないので None。"""
    text = raw.strip().replace(" ", "")
    if not text:
        return None
    negative = False
    if text.startswith("F"):
        negative = True
        text = text[1:]
    elif text.startswith("L"):
        return None
    if text.startswith("."):
        text = "0" + text
    try:
        value = float(text)
    except ValueError:
        return None
    return -value if negative else value


def _cell(boat: _RawBoat, index: int) -> str:
    return boat.cells[index] if index < len(boat.cells) else ""


def _build_weather(extractor: _Extractor) -> WeatherInfo | None:
    units = extractor.weather
    if not units:
        return None

    # 気温は is-direction ユニットに入っている（公式の class 名がそうなっている）
    temp = _number(units.get("direction", {}).get("data", ""), "℃")
    weather_name = units.get("weather", {}).get("title", "") or None
    wind_m = _int_number(units.get("wind", {}).get("data", ""), "m")
    water_temp = _number(units.get("waterTemperature", {}).get("data", ""), "℃")
    wave_cm = _int_number(units.get("wave", {}).get("data", ""), "cm")

    icon = units.get("windDirection", {}).get("icon", "")
    matched = _WIND_ICON.search(icon)
    wind_dir_no = int(matched.group(1)) if matched else None

    values = (temp, weather_name, wind_m, wind_dir_no, water_temp, wave_cm)
    if all(value is None for value in values):
        return None

    return WeatherInfo(
        observed_at=extractor.observed_at,
        temp_c=temp,
        weather=weather_name,
        wind_m=wind_m,
        wind_dir_no=wind_dir_no,
        water_temp_c=water_temp,
        wave_cm=wave_cm,
    )


def _start_positions(extractor: _Extractor) -> dict[int, tuple[int, float | None]]:
    """艇番 → (進入コース, ST)。表の並び順がコースなので index+1 を使う。"""
    positions: dict[int, tuple[int, float | None]] = {}
    for course, (teiban_text, st_text) in enumerate(extractor.starts, start=1):
        try:
            teiban = int(teiban_text)
        except ValueError:
            continue
        positions[teiban] = (course, _start_timing(st_text))
    return positions


def parse_beforeinfo(html: str, race_no: int) -> RaceBeforeInfo:
    """直前情報ページを1レースぶん読む。

    Args:
        html: ページの HTML。
        race_no: そのページのレース番号（ページ内から取らず、呼び出し側の値を信じる）。

    Returns:
        まだ公開されていない場合は available=False・entries 空で返す。

    Raises:
        BeforeInfoParseError: 空の入力、または出走表テーブルが見つからない場合。
    """
    if not html.strip():
        raise BeforeInfoParseError(f"{race_no}R: 空のページです")

    extractor = _Extractor()
    extractor.feed(html)

    boats = [boat for boat in extractor.boats if boat.cells]
    if len(boats) < 6:
        raise BeforeInfoParseError(
            f"{race_no}R: 出走表テーブルを読めませんでした"
            f"（艇 {len(boats)} 件）。ページ構造が変わった可能性があります"
        )

    positions = _start_positions(extractor)
    entries: list[TenjiEntry] = []
    for boat in boats:
        course, st_time = positions.get(boat.teiban, (None, None))
        propeller = _cell(boat, CELL_PROPELLER).strip() or None
        entries.append(
            TenjiEntry(
                teiban=boat.teiban,
                name=normalize_racer_name(_cell(boat, 2)),
                weight=_number(_cell(boat, CELL_WEIGHT), "kg"),
                tenji_time=_number(_cell(boat, CELL_TENJI)),
                tilt=_number(_cell(boat, CELL_TILT)),
                propeller=propeller,
                parts_changed=tuple(boat.parts),
                st_course=course,
                st_time=st_time,
            )
        )

    available = any(entry.tenji_time is not None for entry in entries)
    if not available:
        return RaceBeforeInfo(race_no=race_no, available=False)

    return RaceBeforeInfo(
        race_no=race_no,
        available=True,
        entries=tuple(entries),
        weather=_build_weather(extractor),
    )
