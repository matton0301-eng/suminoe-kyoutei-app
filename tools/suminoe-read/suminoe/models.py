"""データモデル。

すべて frozen dataclass（イミュータブル）。更新は dataclasses.replace で新しい値を作る。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

Kyubetsu = Literal["A1", "A2", "B1", "B2"]
Grade3 = Literal["高", "中", "低"]
Verdict = Literal["勝負", "標準", "見送り"]

#: 住之江の場コード（番組表テキストのセクションマーカー `12BBGN` / `12BEND`）
SUMINOE_JCD = 12


@dataclass(frozen=True)
class Racer:
    """選手行1行ぶん（= 1艇）。

    住之江は枠なり進入がほぼ確定しているため、`teiban`（枠番）をそのまま進入コースとして扱う。
    詳細は docs/03-bangumihyou-format.md §6。
    """

    teiban: int  # 1-6
    toban: int  # 選手登番（4桁）
    name: str  # 全角スペースを除去済み
    age: int
    branch: str  # 支部
    weight: int
    kyubetsu: Kyubetsu
    zenkoku_shoritsu: float
    zenkoku_2ritsu: float
    touchi_shoritsu: float
    touchi_2ritsu: float
    motor_no: int
    motor_2ritsu: float
    boat_no: int
    boat_2ritsu: float
    konsetsu: str  # 今節成績。記号が入り得るため生文字列のまま扱う（docs/03 §7）
    hayami: str  # 早見（翌日の出走予定レース）。空文字あり

    #: 過去の住之江の成績から算出した評価勝率。
    #: 十分な母数（enrich.MIN_RUNS_FOR_CONFIDENCE 走）があるときだけ入る。
    #: 入っていれば eval_shoritsu がこれを優先するので、判定ロジック側は何も変えなくてよい。
    history_shoritsu: float | None = None

    @property
    def no_touchi_data(self) -> bool:
        """住之江での出走実績がほぼ無いと判断できるか。

        当地勝率・当地2連対率がともに 0.00 のときのみ True。
        「弱い」ではなく「データがない」ので、スコアリングでは低評価にせず別扱いにする。
        片方のみ 0.00 の実例（当地勝率 2.67 / 当地2率 0.00）があるため AND 条件。
        """
        return self.touchi_shoritsu == 0.0 and self.touchi_2ritsu == 0.0

    @property
    def eval_shoritsu(self) -> float:
        """判定に使う勝率。

        優先順は次のとおり。
          1. 過去成績から算出した実測ベースの値（母数が足りているときだけ入る）
          2. 当地勝率
          3. 当地データが無ければ全国勝率
        """
        if self.history_shoritsu is not None:
            return self.history_shoritsu
        return self.zenkoku_shoritsu if self.no_touchi_data else self.touchi_shoritsu

    @property
    def is_a_class(self) -> bool:
        return self.kyubetsu in ("A1", "A2")


@dataclass(frozen=True)
class Race:
    """1レース分。`racers` が空のままなら取得・パース失敗を意味する。"""

    race_no: int  # 1-12
    name: str  # レース名（予選 / 優勝戦 など）
    distance_m: int
    deadline: str  # 電話投票締切予定 "HH:MM"
    racers: tuple[Racer, ...] = ()
    parse_error: str | None = None

    @property
    def ok(self) -> bool:
        return self.parse_error is None and len(self.racers) == 6

    def boat(self, teiban: int) -> Racer | None:
        for r in self.racers:
            if r.teiban == teiban:
                return r
        return None


@dataclass(frozen=True)
class Program:
    """住之江のその日の番組表まるごと。"""

    date: str  # "YYYY-MM-DD"
    place: str  # "ボートレース住之江"
    title: str  # 節名
    day_label: str  # "第　３日" など原文
    races: tuple[Race, ...] = ()
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True)
class RaceAnalysis:
    """1レースの分析結果。

    3段階評価と根拠数値を必ずセットで持つ。評価だけ・数値だけの出力は仕様で禁止。
    """

    race_no: int
    in_confidence: Grade3
    in_reason: str
    upset_risk: Grade3
    upset_reason: str
    motor_picks: tuple[tuple[int, float], ...]  # (艇番, M2率)
    verdict: Verdict
    verdict_reason: str
    bet_shape: str
    notes: tuple[str, ...] = field(default_factory=tuple)
