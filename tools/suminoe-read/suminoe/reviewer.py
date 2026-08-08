"""事前の判定と、実際の結果を突き合わせる。

**これは「当たった / 外れた」を正直に記録するための機能。**
1日12レースは統計的にはごく小さな母数で、当たっても外れても実力の証明にはならない。
出力には必ず母数を併記し、回収率のような数字を成績として誇張しない。

むしろ「型どおり買っても控除率25%を覆せない」ことが見えるなら、それが正しい情報。
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .baseline import COURSE_FIRST_RATE
from .models import Program, RaceAnalysis
from .result_models import BET_TRIFECTA, RaceResult, ResultDay

#: 1点あたりの想定購入額（円）。回収率の目安を出すためだけに使う
UNIT_YEN = 100


@dataclass(frozen=True)
class RaceReview:
    """1レース分の照合結果。"""

    race_no: int
    verdict: str | None
    in_confidence: str | None
    upset_risk: str | None
    #: 事前に軸として提示した艇（買い目の型の先頭）
    anchor: int | None
    #: 実際の着順
    order: tuple[int, ...]
    kimarite: str
    wave_cm: int | None
    wakunari: bool | None
    #: 軸が1着だったか。軸を出していなければ None
    anchor_won: bool | None
    #: 軸が3着以内だったか
    anchor_in3: bool | None
    #: 1号艇が1着だったか
    inside_won: bool
    #: 3連単の払戻（円）。参考値
    trifecta_yen: int | None
    notes: tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class VerdictSummary:
    """判定ごとの集計。母数を必ず持たせる。"""

    verdict: str
    total: int
    inside_won: int
    anchor_won: int
    anchor_in3: int

    @property
    def inside_rate(self) -> float | None:
        return (self.inside_won / self.total * 100) if self.total else None

    @property
    def anchor_rate(self) -> float | None:
        return (self.anchor_won / self.total * 100) if self.total else None


@dataclass(frozen=True)
class DayReview:
    """その日全体の照合結果。"""

    date: str
    title: str
    day_label: str
    races: tuple[RaceReview, ...]
    by_verdict: tuple[VerdictSummary, ...]
    #: コース別1着率（当日実測）
    course_rates: dict[int, float]
    #: 枠なり進入だったレース数 / 判定できたレース数
    wakunari_count: tuple[int, int]
    warnings: tuple[str, ...] = field(default_factory=tuple)

    @property
    def total(self) -> int:
        return len(self.races)

    @property
    def inside_won_total(self) -> int:
        return sum(1 for r in self.races if r.inside_won)


def _anchor_of(analysis: RaceAnalysis) -> int | None:
    """買い目の型の先頭から、事前に軸としていた艇を読み取る。

    型の文字列表現に依存するため、読めなければ None を返す（推測しない）。
    """
    import re

    shape = analysis.bet_shape
    for pattern in (r"買うなら(\d)号艇軸", r"複勝 (\d)号艇", r"3連単フォーメーション (\d)-"):
        match = re.search(pattern, shape)
        if match:
            return int(match.group(1))
    return None


def review_race(analysis: RaceAnalysis, result: RaceResult) -> RaceReview:
    anchor = _anchor_of(analysis)
    order = result.order
    first = order[0] if order else None

    anchor_won = None if anchor is None or first is None else anchor == first
    anchor_in3 = None if anchor is None or not order else anchor in order[:3]

    trifecta = next((p for p in result.payouts if p.bet_type == BET_TRIFECTA), None)

    notes: list[str] = []
    if result.wakunari is False:
        outliers = [
            f"{e.teiban}号艇→{e.course}コース"
            for e in result.entries
            if e.course is not None and e.course != e.teiban
        ]
        if outliers:
            notes.append("枠なりでない進入: " + "・".join(outliers))
    non_finishers = [e for e in result.entries if not e.finished]
    if non_finishers:
        notes.append(
            "完走せず: "
            + "・".join(f"{e.teiban}号艇 {e.name}({e.rank_raw})" for e in non_finishers)
        )

    return RaceReview(
        race_no=result.race_no,
        verdict=analysis.verdict,
        in_confidence=analysis.in_confidence,
        upset_risk=analysis.upset_risk,
        anchor=anchor,
        order=order,
        kimarite=result.kimarite,
        wave_cm=result.wave_cm,
        wakunari=result.wakunari,
        anchor_won=anchor_won,
        anchor_in3=anchor_in3,
        inside_won=first == 1,
        trifecta_yen=trifecta.amount if trifecta else None,
        notes=tuple(notes),
    )


def review_day(
    program: Program,
    analyses: tuple[RaceAnalysis, ...],
    results: ResultDay,
) -> DayReview:
    """番組表・分析・結果の3つを突き合わせる。"""
    by_race = {a.race_no: a for a in analyses}
    result_by_race = {r.race_no: r for r in results.races}

    reviews: list[RaceReview] = []
    warnings: list[str] = []

    for race_no in sorted(set(by_race) & set(result_by_race)):
        result = result_by_race[race_no]
        if not result.ok:
            warnings.append(f"{race_no}R: 結果を確定できず照合から除外しました")
            continue
        reviews.append(review_race(by_race[race_no], result))

    missing = sorted(set(by_race) - set(result_by_race))
    if missing:
        warnings.append(
            "結果が無く照合できなかったレース: " + ", ".join(f"{n}R" for n in missing)
        )

    # 判定ごとの集計
    summaries: list[VerdictSummary] = []
    for verdict in ("勝負", "標準", "見送り"):
        group = [r for r in reviews if r.verdict == verdict]
        if not group:
            continue
        summaries.append(
            VerdictSummary(
                verdict=verdict,
                total=len(group),
                inside_won=sum(1 for r in group if r.inside_won),
                anchor_won=sum(1 for r in group if r.anchor_won),
                anchor_in3=sum(1 for r in group if r.anchor_in3),
            )
        )

    # コース別1着率（当日実測）
    course_rates: dict[int, float] = {}
    if reviews:
        for course in range(1, 7):
            wins = sum(1 for r in reviews if r.order and r.order[0] == course)
            course_rates[course] = wins / len(reviews) * 100

    judged = [r for r in reviews if r.wakunari is not None]
    wakunari_count = (sum(1 for r in judged if r.wakunari), len(judged))

    return DayReview(
        date=results.date,
        title=results.title,
        day_label=results.day_label,
        races=tuple(reviews),
        by_verdict=tuple(summaries),
        course_rates=course_rates,
        wakunari_count=wakunari_count,
        warnings=tuple(warnings) + results.warnings,
    )


def render_review_markdown(review: DayReview) -> str:
    """人が読む照合レポート。数字を成績として誇張しない。"""
    out: list[str] = []
    out.append(f"# 住之江 {review.date} 事前の読みと結果の照合")
    out.append("")
    if review.title:
        out.append(f"**{review.title}**　{review.day_label}")
        out.append("")
    out.append(
        f"> 照合できたのは **{review.total} レース**です。"
        "1日ぶんの結果は統計的にごく小さな母数で、当たっても外れても分析の実力を示しません。"
    )
    out.append("> 舟券の控除率は約25%あり、それを覆せる想定でもありません。")
    out.append("> ここに出しているのは「その日の読みが実際どうだったか」の記録です。")
    out.append("")

    # --- 判定ごと ---
    out.append("## 判定ごとの結果")
    out.append("")
    out.append("| 判定 | レース数 | 1号艇が1着 | 軸が1着 | 軸が3着以内 |")
    out.append("|---|---|---|---|---|")
    for summary in review.by_verdict:
        rate = summary.inside_rate
        out.append(
            f"| {summary.verdict} | {summary.total} | "
            f"{summary.inside_won} ({rate:.0f}%) | "
            f"{summary.anchor_won} | {summary.anchor_in3} |"
        )
    out.append("")
    out.append(
        f"当日の1号艇1着は **{review.inside_won_total} / {review.total} レース** "
        f"（{review.inside_won_total / review.total * 100:.1f}%）。"
        f"住之江の基準は {COURSE_FIRST_RATE[1]}%。"
    )
    out.append("")

    # --- コース別 ---
    out.append("## コース別1着率（当日 vs 基準）")
    out.append("")
    out.append("| コース | 当日 | 基準 | 差 |")
    out.append("|---|---|---|---|")
    for course in range(1, 7):
        actual = review.course_rates.get(course)
        base = COURSE_FIRST_RATE[course]
        if actual is None:
            continue
        diff = actual - base
        out.append(f"| {course}コース | {actual:.1f}% | {base}% | {diff:+.1f} |")
    out.append("")
    won, judged = review.wakunari_count
    if judged:
        out.append(
            f"枠なり進入は **{won} / {judged} レース**。"
            "本ツールは「枠番=進入コース」を前提にしているので、ここが崩れると読みも崩れる。"
        )
        out.append("")

    # --- レースごと ---
    out.append("## レースごと")
    out.append("")
    out.append("| R | 判定 | イン/波乱 | 軸 | 結果 | 決まり手 | 波 | 枠なり | 3連単 |")
    out.append("|---|---|---|---|---|---|---|---|---|")
    for race in review.races:
        mark = {True: "○", False: "×", None: "—"}
        order = "-".join(str(b) for b in race.order) if race.order else "—"
        wave = f"{race.wave_cm}cm" if race.wave_cm is not None else "—"
        wakunari = mark[race.wakunari]
        anchor = f"{race.anchor}号艇 {mark[race.anchor_won]}" if race.anchor else "—"
        yen = f"{race.trifecta_yen:,}円" if race.trifecta_yen else "—"
        out.append(
            f"| {race.race_no} | {race.verdict or '—'} | "
            f"{race.in_confidence or '—'}/{race.upset_risk or '—'} | {anchor} | "
            f"{order} | {race.kimarite or '—'} | {wave} | {wakunari} | {yen} |"
        )
    out.append("")

    notes = [(r.race_no, note) for r in review.races for note in r.notes]
    if notes:
        out.append("### 気になった点")
        out.append("")
        for race_no, note in notes:
            out.append(f"- **{race_no}R**: {note}")
        out.append("")

    if review.warnings:
        out.append("### 警告")
        out.append("")
        for warning in review.warnings:
            out.append(f"- {warning}")
        out.append("")

    out.append("---")
    out.append("")
    out.append(
        "「軸」は事前に提示した買い目の型の先頭の艇です。"
        "軸が1着でも、その賭式が的中したかは組み合わせ次第です（アプリの買い目タブで確認できます）。"
    )
    return "\n".join(out)
