"""過去成績の実績を、当日の出走表に重ねる。

番組表の当地勝率は走数が載っていないため母数不明で、断定に使えない。
過去成績から作った実績には母数があるので、
「住之江で N 走してこの成績」と根拠を示せる。

**母数が足りない選手は足りないと明示する。** 3走の1着率100%を強い根拠として扱わない。
"""

from __future__ import annotations

from dataclasses import dataclass

from .history import MIN_MOTOR_RUNS, MIN_RUNS_FOR_CONFIDENCE, SuminoeHistory
from .models import Program, Racer


@dataclass(frozen=True)
class RacerFacts:
    """1艇について、過去成績から分かったこと。

    すべて母数付き。母数が足りないときは rate を持たせない（None）。
    """

    toban: int
    #: 住之江での総出走数
    runs: int
    #: 1着率(%)。母数不足なら None
    win_rate: float | None
    #: 2連対率(%)
    niren_rate: float | None
    #: 3連対率(%)
    sanren_rate: float | None
    #: 平均着順
    avg_rank: float | None
    #: 平均ST
    avg_st: float | None
    #: 今回入る枠（=コース）での1着率と母数
    course_win_rate: float | None
    course_runs: int
    #: モーターの実測2連対率と使用回数
    motor_niren_rate: float | None
    motor_runs: int

    @property
    def reliable(self) -> bool:
        return self.runs >= MIN_RUNS_FOR_CONFIDENCE

    @property
    def motor_reliable(self) -> bool:
        return self.motor_runs >= MIN_MOTOR_RUNS

    def describe(self) -> str:
        """根拠として出す1行。母数を必ず添える。"""
        if self.runs == 0:
            return "住之江での過去データなし"
        parts = [f"住之江{self.runs}走"]
        if self.win_rate is not None:
            parts.append(f"1着率{self.win_rate:.0f}%")
        if self.niren_rate is not None:
            parts.append(f"2連対{self.niren_rate:.0f}%")
        if self.course_runs > 0 and self.course_win_rate is not None:
            parts.append(f"当該コース{self.course_runs}走で1着率{self.course_win_rate:.0f}%")
        if self.avg_st is not None:
            parts.append(f"平均ST{self.avg_st:.2f}")
        text = " / ".join(parts)
        if not self.reliable:
            text += f"（{MIN_RUNS_FOR_CONFIDENCE}走未満のため参考値）"
        return text


def facts_for(racer: Racer, history: SuminoeHistory) -> RacerFacts:
    """1艇ぶんの実績を取り出す。住之江は枠なり進入前提なので枠番をコースとして見る。"""
    entry = history.racer(racer.toban)
    motor = history.motor(racer.motor_no)

    if entry is None:
        return RacerFacts(
            toban=racer.toban,
            runs=0,
            win_rate=None,
            niren_rate=None,
            sanren_rate=None,
            avg_rank=None,
            avg_st=None,
            course_win_rate=None,
            course_runs=0,
            motor_niren_rate=motor.niren_rate if motor and motor.reliable else None,
            motor_runs=motor.total if motor else 0,
        )

    course_rate, course_runs = entry.course_win_rate(racer.teiban)
    reliable = entry.reliable

    return RacerFacts(
        toban=racer.toban,
        runs=entry.total,
        # 母数不足のときは率を出さない（3走の100%を根拠にしないため）
        win_rate=entry.win_rate if reliable else None,
        niren_rate=entry.niren_rate if reliable else None,
        sanren_rate=entry.sanren_rate if reliable else None,
        avg_rank=entry.avg_rank if reliable else None,
        avg_st=entry.avg_st,
        course_win_rate=course_rate if course_runs >= 3 else None,
        course_runs=course_runs,
        motor_niren_rate=motor.niren_rate if motor and motor.reliable else None,
        motor_runs=motor.total if motor else 0,
    )


def build_facts(
    racers: tuple[Racer, ...], history: SuminoeHistory
) -> dict[int, RacerFacts]:
    """レースの全艇について実績を引く。キーは艇番。"""
    return {racer.teiban: facts_for(racer, history) for racer in racers}


#: 実績を評価勝率に反映させるときの重み。
#: 番組表の勝率（期別成績ベース、全場合算または当地）と、
#: 住之江の実測（母数は少ないが場が一致）を混ぜる。
#: 母数が増えるほど実測に寄せるが、上限は 0.5 に留める（過学習を避ける）。
MAX_HISTORY_WEIGHT = 0.5
HISTORY_WEIGHT_FULL_RUNS = 40


def history_weight(runs: int) -> float:
    """母数に応じた実測の重み。10走未満は0（使わない）。"""
    if runs < MIN_RUNS_FOR_CONFIDENCE:
        return 0.0
    return min(MAX_HISTORY_WEIGHT, runs / HISTORY_WEIGHT_FULL_RUNS)


def blended_shoritsu(racer: Racer, facts: RacerFacts) -> tuple[float, str]:
    """番組表の勝率と住之江の実測を混ぜた評価勝率を返す。

    実測は「1着率・2連対率」から勝率スケール相当の値に換算する。
    競艇の勝率は着順点（1着=10点…）の平均で、おおよそ次の対応になる:
      勝率6.00 → 1着率30%前後 / 勝率4.00 → 1着率10%前後
    ここでは 1着率(%) / 5 + 2連対率(%) / 25 を目安の勝率相当値として使う。

    Returns:
        (評価勝率, 根拠の説明)
    """
    base = racer.eval_shoritsu
    weight = history_weight(facts.runs)
    if weight == 0.0 or facts.win_rate is None or facts.niren_rate is None:
        return base, f"番組表の勝率{base:.2f}（住之江{facts.runs}走で実測は使わず）"

    implied = facts.win_rate / 5.0 + facts.niren_rate / 25.0
    blended = base * (1 - weight) + implied * weight
    return (
        blended,
        f"番組表{base:.2f} と 住之江{facts.runs}走の実測（1着率{facts.win_rate:.0f}%"
        f"→勝率相当{implied:.2f}）を {int(weight * 100)}% 混ぜて {blended:.2f}",
    )


def enrich_program(program: Program, history: SuminoeHistory):
    """全艇に実測ベースの評価勝率を注入した Program を返す。

    `Racer.history_shoritsu` に入れるだけなので、判定ロジック側は何も変えなくてよい。
    母数が足りない選手には何も入れない（従来どおり番組表の勝率で判定される）。

    Returns:
        (強化した Program, レース番号 -> 艇番 -> RacerFacts, 根拠の説明リスト)
    """
    import dataclasses

    facts_by_race: dict[int, dict[int, RacerFacts]] = {}
    notes: list[str] = []
    races = []

    for race in program.races:
        facts = build_facts(race.racers, history)
        facts_by_race[race.race_no] = facts

        racers = []
        for racer in race.racers:
            entry = facts[racer.teiban]
            blended, why = blended_shoritsu(racer, entry)
            if history_weight(entry.runs) > 0.0:
                racers.append(dataclasses.replace(racer, history_shoritsu=blended))
                notes.append(f"{race.race_no}R {racer.teiban}号艇 {racer.name}: {why}")
            else:
                racers.append(racer)
        races.append(dataclasses.replace(race, racers=tuple(racers)))

    return dataclasses.replace(program, races=tuple(races)), facts_by_race, notes
