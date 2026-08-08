"""競走成績（結果）のデータモデル。

番組表（B）と対になる競走成績（K）を表す。事前の判定と実際の結果を突き合わせて
「その日の読みがどうだったか」を精査するために使う。

すべて frozen dataclass。
"""

from __future__ import annotations

from dataclasses import dataclass

#: 賭式の名前。公式の成績ファイルの表記に合わせる（全角を含む）
BET_TRIFECTA = "３連単"
BET_TRIO = "３連複"
BET_EXACTA = "２連単"
BET_QUINELLA = "２連複"
BET_WIDE = "拡連複"
BET_WIN = "単勝"
BET_PLACE = "複勝"

#: スミノエ・ログの賭式キーとの対応
BET_TYPE_TO_APP_KEY = {
    BET_TRIFECTA: "trifecta",
    BET_TRIO: "trio",
    BET_EXACTA: "exacta",
    BET_QUINELLA: "quinella",
    BET_WIDE: "wide",
    BET_WIN: "win",
    BET_PLACE: "place",
}


@dataclass(frozen=True)
class Payout:
    """1点ぶんの払戻。

    combo は艇番の組み合わせ。3連単なら着順どおり、3連複などは公式表記のまま。
    """

    bet_type: str
    combo: tuple[int, ...]
    amount: int
    popularity: int | None = None


@dataclass(frozen=True)
class ResultEntry:
    """結果の1艇ぶん。"""

    #: 着順の生の値。'01'〜'06' のほか 'F'(フライング) 'L'(出遅れ) 'K0'/'S0'(失格) などが入る
    rank_raw: str
    #: 着順を数値にしたもの。完走できなかった艇は None
    rank: int | None
    teiban: int
    toban: int
    name: str
    motor_no: int | None
    boat_no: int | None
    #: 展示タイム
    tenji: float | None
    #: 進入コース。住之江は枠なりがほぼ確定だが、実際にどうだったかを検証するため保持する
    course: int | None
    #: スタートタイミング。F は負値で表される場合がある
    st: float | None
    race_time: str

    @property
    def finished(self) -> bool:
        return self.rank is not None


@dataclass(frozen=True)
class RaceResult:
    """1レースの結果。"""

    race_no: int
    name: str
    weather: str
    wind_dir: str
    wind_m: int | None
    wave_cm: int | None
    #: 決まり手。公式の表記（逃げ / まくり / 差し / まくり差し / 抜き / 恵まれ など）
    kimarite: str
    #: 着順の艇番。(1着, 2着, 3着)。取れなかった着は含まない
    order: tuple[int, ...]
    entries: tuple[ResultEntry, ...] = ()
    payouts: tuple[Payout, ...] = ()
    parse_error: str | None = None

    @property
    def ok(self) -> bool:
        return self.parse_error is None and len(self.order) >= 3

    def boat(self, teiban: int) -> ResultEntry | None:
        for entry in self.entries:
            if entry.teiban == teiban:
                return entry
        return None

    def payout_of(self, bet_type: str, combo: tuple[int, ...]) -> Payout | None:
        """指定の賭式・組み合わせの払戻を返す。的中していなければ None。"""
        for payout in self.payouts:
            if payout.bet_type != bet_type:
                continue
            if payout.combo == combo:
                return payout
        return None

    @property
    def wakunari(self) -> bool | None:
        """全艇が枠なり進入だったか。進入コースが取れていなければ None。"""
        courses = [(e.teiban, e.course) for e in self.entries if e.course is not None]
        if len(courses) != len(self.entries) or not courses:
            return None
        return all(teiban == course for teiban, course in courses)


@dataclass(frozen=True)
class ResultDay:
    """その日の住之江の全レース結果。"""

    date: str
    place: str
    title: str
    day_label: str
    races: tuple[RaceResult, ...] = ()
    warnings: tuple[str, ...] = ()
