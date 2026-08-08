"""過去の住之江の成績を集計する。

**この集計の要点は「母数がわかること」。**
番組表の当地勝率は走数が載っておらず、母数不明のまま断定に使えなかった。
ここで作る実績は「住之江で N 走してこの成績」と言えるので、
母数が足りない選手は足りないと明示したうえで判断できる。

集計するもの:
  選手ごと   住之江での出走数・着順分布・コース別成績・平均ST
  モーターごと 使用回数・着順分布・2連対率の実測
  コース別   1着率・平均ST（全体の傾向）
  決まり手   分布
"""

from __future__ import annotations

import json
import statistics
from dataclasses import dataclass, field
from pathlib import Path

#: この走数に満たない実績は「母数不足」として断定に使わない。
#: 6艇×十数レースで1開催なので、10走はおおむね1〜2開催ぶんにあたる。
MIN_RUNS_FOR_CONFIDENCE = 10

#: モーターの実績を信頼する最低使用回数
MIN_MOTOR_RUNS = 12


@dataclass
class RunRecord:
    """1走ぶんの記録。"""

    date: str
    race_no: int
    teiban: int
    course: int | None
    rank: int | None
    rank_raw: str
    st: float | None
    motor_no: int | None
    kimarite: str
    is_winner: bool


@dataclass
class RacerHistory:
    """選手1人の住之江での実績。"""

    toban: int
    name: str
    runs: list[RunRecord] = field(default_factory=list)

    @property
    def total(self) -> int:
        return len(self.runs)

    @property
    def finished(self) -> list[RunRecord]:
        return [r for r in self.runs if r.rank is not None]

    @property
    def wins(self) -> int:
        return sum(1 for r in self.runs if r.rank == 1)

    @property
    def win_rate(self) -> float | None:
        """1着率(%)。母数が0なら None。"""
        return (self.wins / self.total * 100) if self.total else None

    @property
    def niren_rate(self) -> float | None:
        """2連対率(%)。"""
        if not self.total:
            return None
        return sum(1 for r in self.runs if r.rank in (1, 2)) / self.total * 100

    @property
    def sanren_rate(self) -> float | None:
        if not self.total:
            return None
        return sum(1 for r in self.runs if r.rank in (1, 2, 3)) / self.total * 100

    @property
    def avg_rank(self) -> float | None:
        finished = [r.rank for r in self.finished if r.rank is not None]
        return statistics.mean(finished) if finished else None

    @property
    def avg_st(self) -> float | None:
        sts = [r.st for r in self.runs if r.st is not None and -1 < r.st < 1]
        return statistics.mean(sts) if sts else None

    @property
    def reliable(self) -> bool:
        """断定的に使ってよい母数があるか。"""
        return self.total >= MIN_RUNS_FOR_CONFIDENCE

    def by_course(self, course: int) -> list[RunRecord]:
        return [r for r in self.runs if r.course == course]

    def course_win_rate(self, course: int) -> tuple[float | None, int]:
        """指定コースでの1着率と母数を返す。"""
        runs = self.by_course(course)
        if not runs:
            return None, 0
        return sum(1 for r in runs if r.rank == 1) / len(runs) * 100, len(runs)


@dataclass
class MotorHistory:
    """モーター1機の実績。"""

    motor_no: int
    runs: list[RunRecord] = field(default_factory=list)

    @property
    def total(self) -> int:
        return len(self.runs)

    @property
    def niren_rate(self) -> float | None:
        if not self.total:
            return None
        return sum(1 for r in self.runs if r.rank in (1, 2)) / self.total * 100

    @property
    def win_rate(self) -> float | None:
        return (sum(1 for r in self.runs if r.rank == 1) / self.total * 100) if self.total else None

    @property
    def reliable(self) -> bool:
        return self.total >= MIN_MOTOR_RUNS


@dataclass
class SuminoeHistory:
    """住之江の過去成績まるごと。"""

    racers: dict[int, RacerHistory] = field(default_factory=dict)
    motors: dict[int, MotorHistory] = field(default_factory=dict)
    #: コース別の (1着数, 出走数)
    course_counts: dict[int, tuple[int, int]] = field(default_factory=dict)
    kimarite_counts: dict[str, int] = field(default_factory=dict)
    dates: list[str] = field(default_factory=list)
    race_count: int = 0

    @property
    def day_count(self) -> int:
        return len(self.dates)

    @property
    def span(self) -> tuple[str, str] | None:
        if not self.dates:
            return None
        return min(self.dates), max(self.dates)

    def course_win_rate(self, course: int) -> tuple[float | None, int]:
        wins, total = self.course_counts.get(course, (0, 0))
        return (wins / total * 100 if total else None), total

    def racer(self, toban: int) -> RacerHistory | None:
        return self.racers.get(toban)

    def motor(self, motor_no: int) -> MotorHistory | None:
        return self.motors.get(motor_no)


def load_history(history_dir: Path) -> SuminoeHistory:
    """`cache/history/` に蓄積した JSON を読み込んで集計する。"""
    history = SuminoeHistory()
    if not history_dir.is_dir():
        return history

    for path in sorted(history_dir.glob("2*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue

        day_date = data.get("date", path.stem)
        races = data.get("races", [])
        if not races:
            continue
        history.dates.append(day_date)

        for race in races:
            history.race_count += 1
            order = race.get("order") or []
            winner = order[0] if order else None
            kimarite = race.get("kimarite") or ""
            if kimarite:
                history.kimarite_counts[kimarite] = history.kimarite_counts.get(kimarite, 0) + 1

            for entry in race.get("entries", []):
                toban = entry.get("toban")
                teiban = entry.get("teiban")
                if not isinstance(toban, int) or not isinstance(teiban, int):
                    continue

                record = RunRecord(
                    date=day_date,
                    race_no=race.get("raceNo", 0),
                    teiban=teiban,
                    course=entry.get("course"),
                    rank=entry.get("rank"),
                    rank_raw=entry.get("rankRaw", ""),
                    st=entry.get("st"),
                    motor_no=entry.get("motorNo"),
                    kimarite=kimarite,
                    is_winner=teiban == winner,
                )

                racer = history.racers.get(toban)
                if racer is None:
                    racer = RacerHistory(toban=toban, name=entry.get("name", ""))
                    history.racers[toban] = racer
                racer.runs.append(record)

                motor_no = entry.get("motorNo")
                if isinstance(motor_no, int):
                    motor = history.motors.get(motor_no)
                    if motor is None:
                        motor = MotorHistory(motor_no=motor_no)
                        history.motors[motor_no] = motor
                    motor.runs.append(record)

                course = entry.get("course")
                if isinstance(course, int) and 1 <= course <= 6:
                    wins, total = history.course_counts.get(course, (0, 0))
                    history.course_counts[course] = (
                        wins + (1 if record.rank == 1 else 0),
                        total + 1,
                    )

    return history


def summarize(history: SuminoeHistory) -> str:
    """集計の概要を人が読める形にする。母数を必ず添える。"""
    if history.day_count == 0:
        return "蓄積された過去成績がありません。collect-history.py を実行してください。"

    span = history.span
    lines = [
        f"住之江の過去成績: {history.day_count} 開催日 / {history.race_count} レース"
        + (f"（{span[0]} 〜 {span[1]}）" if span else ""),
        f"選手 {len(history.racers)} 人 / モーター {len(history.motors)} 機",
        "",
        "コース別1着率（実測）:",
    ]
    for course in range(1, 7):
        rate, total = history.course_win_rate(course)
        if rate is None:
            continue
        lines.append(f"  {course}コース {rate:5.1f}%  （{total} 走）")

    if history.kimarite_counts:
        lines.append("")
        lines.append("決まり手:")
        total_kimarite = sum(history.kimarite_counts.values())
        for name, count in sorted(history.kimarite_counts.items(), key=lambda x: -x[1]):
            lines.append(f"  {name:6s} {count:4d} 回 ({count / total_kimarite * 100:4.1f}%)")

    reliable = sum(1 for r in history.racers.values() if r.reliable)
    lines.append("")
    lines.append(
        f"{MIN_RUNS_FOR_CONFIDENCE}走以上ある選手: {reliable} / {len(history.racers)} 人"
    )
    return "\n".join(lines)
