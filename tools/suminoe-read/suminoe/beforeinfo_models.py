"""直前情報（展示タイム・チルト・部品交換・スタート展示・気象）のデータモデル。

番組表（B）・競走成績（K）が固定長テキストなのに対し、直前情報は公式PCサイトの
HTML からしか取れない。取れなかった項目は None にし、**推測で埋めない**。

すべて frozen dataclass。
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class WeatherInfo:
    """水面気象情報。周回展示のあとに更新される。"""

    #: 観測時刻。ページ上の「20:33現在」の部分
    observed_at: str | None
    temp_c: float | None
    #: 天候の名前（晴 / 曇り / 雨 など）。公式の表記そのまま
    weather: str | None
    wind_m: int | None
    #: 風向はアイコンの通し番号でしか公開されていない（is-wind1〜is-wind17）。
    #: 方位名との対応は未検証なので、番号のまま持つ。無風は 17。
    wind_dir_no: int | None
    water_temp_c: float | None
    wave_cm: int | None


@dataclass(frozen=True)
class TenjiEntry:
    """直前情報の1艇ぶん。"""

    teiban: int
    name: str
    #: 体重（kg）。直前計量の値
    weight: float | None
    #: 展示タイム（秒）。周回展示の直線タイム
    tenji_time: float | None
    tilt: float | None
    #: プロペラを交換していれば「新」。していなければ None
    propeller: str | None
    #: 部品交換の内容（「リング×２」など）。交換なしは空
    parts_changed: tuple[str, ...]
    #: スタート展示の進入コース。表の並び順から取る
    st_course: int | None
    #: スタート展示のタイミング。フライングは負値（"F.06" → -0.06）、
    #: 出遅れ（L）はタイミングを持たないので None
    st_time: float | None


@dataclass(frozen=True)
class RaceBeforeInfo:
    """1レースぶんの直前情報。

    available=False は「まだ公開されていない」であってエラーではない。
    直前情報は周回展示のあと（締切の10〜15分前）に順次公開される。
    """

    race_no: int
    available: bool
    entries: tuple[TenjiEntry, ...] = ()
    weather: WeatherInfo | None = None


@dataclass(frozen=True)
class BeforeInfoDay:
    """その日の全レースぶんの直前情報。"""

    date: str
    #: 取得時刻（ISO8601・JST）。鮮度の判断に使う
    updated_at: str
    races: tuple[RaceBeforeInfo, ...] = ()

    @property
    def available_count(self) -> int:
        return sum(1 for race in self.races if race.available)
