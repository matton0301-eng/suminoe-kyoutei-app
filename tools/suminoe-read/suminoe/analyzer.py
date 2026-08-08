"""分析ロジック。

**設計思想（厳守）**: これは勝つための予想ツールではない。舟券の控除率は約25%あり、
データ分析でそれを覆すことは想定していない。目的は「根拠を持ってレースを見られること」。

したがって、
  - 存在しない小数精度の「的中確率」を出力しない
  - 母数の小さい集計値には必ず母数を併記する
  - 「買い目」は候補の型を提示するに留め、断定的な推奨文言を使わない
"""

from __future__ import annotations

import statistics

from .baseline import COURSE_FIRST_RATE
from .models import Grade3, Program, Race, RaceAnalysis, Racer, Verdict

#: モーター注目艇のしきい値（当日全艇のM2率中央値からの上乗せポイント）
MOTOR_PICK_MARGIN = 15.0

# --- イン信頼度のしきい値 ---
# 2026-08-06 の実データ12レースで検証し、初期案から調整した（docs/02 §4-4、README「しきい値の調整記録」）。
# 番組表には当地勝率の「走数」が載っていない。母数不明の当地勝率だけで断定しないため、
# 全国勝率による救済ルートを併設している。
#: 「高」: A級かつ当地勝率がこの値以上
IN_HIGH_TOUCHI = 6.00
#: 「高」: A1級かつ全国勝率がこの値以上（当地の母数が少ないA1級を取りこぼさないため）
IN_HIGH_ZENKOKU_A1 = 6.50
#: 「中」: 当地勝率がこの値以上
IN_MID_TOUCHI = 5.00
#: 「中」: 全国勝率がこの値以上
IN_MID_ZENKOKU = 5.50
#: 波乱リスク「中」と判定する当地勝率差の上限
UPSET_CLOSE_DIFF = 0.50

# --- コース補正 ---
# 勝率だけで艇を並べると、構造的に不利な外枠（6コースの1着率は1.8%）が上位に来る。
# コース別1着率(%)をこの値で割って勝率スケールに足すことで、枠の有利不利を織り込む。
# **スミノエ・ログ (apps/suminoe-log/lib/betting.ts) と同じ値を使うこと。**
# 値がずれると、同じデータから2つのツールが違う軸を出して利用者が混乱する。
#: 1着（軸）の評価に使う。1コース +4.01 / 2コース +1.09（差 2.93）
COURSE_WEIGHT_FIRST = 14
#: 2・3着の相手選びに使う。1着ほどコースの影響が大きくないため弱めにする
COURSE_WEIGHT_PLACE = 28

# --- 代替軸（1号艇が信頼できないレースで軸に据えられる艇）のしきい値 ---
# 波乱リスクは仕様上3・4号艇しか見ないため、2号艇や5・6号艇に明確な実力者がいる
# レースを「読みどころなし」で終わらせてしまう。それを補うための判定。
#: A級でない場合、評価勝率がこの値以上あること
ALT_ANCHOR_MIN_SHORITSU = 5.50

DEFAULT_MAX_BETS = 6


def _fmt(value: float) -> str:
    return f"{value:.2f}"



def _shoritsu_label(racer: Racer) -> str:
    """勝率の根拠表示。当地データがない艇はそのことを明示する。"""
    if racer.no_touchi_data:
        return f"全国{_fmt(racer.zenkoku_shoritsu)}（当地データなし）"
    return f"当地{_fmt(racer.touchi_shoritsu)}"


def motor_median(program: Program) -> float | None:
    """当日出走する全艇のモーター2連対率の中央値。"""
    values = [r.motor_2ritsu for race in program.races for r in race.racers]
    return statistics.median(values) if values else None


def _in_confidence(boat1: Racer, motor_line: float | None) -> tuple[Grade3, str]:
    """イン信頼度（1号艇が逃げ切れそうか）を3段階で判定する。

    当地データがない艇は全国勝率で代替評価するが、「高」には上げない。
    住之江での実績が無いこと自体が不確実性であり、断定を避ける方針に沿う。
    """
    motor_hot = motor_line is not None and boat1.motor_2ritsu >= motor_line
    base = f"1号艇 {boat1.name}({boat1.kyubetsu}) {_shoritsu_label(boat1)}, M2率{_fmt(boat1.motor_2ritsu)}%"

    if boat1.no_touchi_data:
        grade: Grade3 = "中" if boat1.zenkoku_shoritsu >= IN_MID_ZENKOKU else "低"
        return grade, f"{base}。当地実績がないため全国勝率で判定し、上限を中に留めた。"

    if boat1.is_a_class and boat1.touchi_shoritsu >= IN_HIGH_TOUCHI:
        return "高", f"{base}。A級で当地勝率{IN_HIGH_TOUCHI:.2f}以上。"
    if boat1.kyubetsu == "A1" and boat1.zenkoku_shoritsu >= IN_HIGH_ZENKOKU_A1:
        return (
            "高",
            f"{base}。A1級で全国勝率{IN_HIGH_ZENKOKU_A1:.2f}以上。"
            f"当地勝率は{_fmt(boat1.touchi_shoritsu)}だが、番組表に当地の走数がないため"
            "母数が少ない可能性を考慮した。",
        )
    if motor_hot:
        caveat = "ただしB級のため、選手の信頼度は割り引いて見る。" if boat1.kyubetsu.startswith("B") else ""
        return (
            "高",
            f"{base}。モーター2連対率が当日中央値+{MOTOR_PICK_MARGIN:.0f}pt以上"
            f"（{_fmt(motor_line)}%以上）の上位機。{caveat}",
        )
    if boat1.touchi_shoritsu >= IN_MID_TOUCHI:
        return "中", f"{base}。当地勝率{IN_MID_TOUCHI:.2f}以上だが高の条件には届かない。"
    if boat1.zenkoku_shoritsu >= IN_MID_ZENKOKU:
        return "中", f"{base}。当地勝率は伸びていないが全国勝率{IN_MID_ZENKOKU:.2f}以上。"
    if boat1.is_a_class:
        return "中", f"{base}。勝率は高の条件に届かないがA級。"
    return "低", f"{base}。当地・全国とも勝率が基準に届かない。"


def _upset_risk(race: Race) -> tuple[Grade3, str]:
    """波乱リスク（3・4号艇の攻めが利きそうか）を3段階で判定する。"""
    boat1 = race.boat(1)
    challengers = [b for b in (race.boat(3), race.boat(4)) if b is not None]
    if boat1 is None or not challengers:
        return "中", "1号艇または3・4号艇の情報が欠けており判定できない。"

    best = max(challengers, key=lambda b: b.eval_shoritsu)
    diff = boat1.eval_shoritsu - best.eval_shoritsu
    detail = (
        f"1号艇 {_shoritsu_label(boat1)} vs {best.teiban}号艇 {best.name} "
        f"{_shoritsu_label(best)}（差 {diff:+.2f}）"
    )

    outer_a1 = [b for b in race.racers if b.teiban >= 3 and b.kyubetsu == "A1"]
    if outer_a1 and boat1.kyubetsu.startswith("B"):
        seats = "・".join(f"{b.teiban}号艇" for b in outer_a1)
        return "高", f"{detail}。1号艇がB級で、{seats}にA1級がいる。"
    if diff < 0:
        return "高", f"{detail}。{best.teiban}号艇の勝率が1号艇を上回る。"
    if diff <= UPSET_CLOSE_DIFF:
        return "中", f"{detail}。勝率差が{UPSET_CLOSE_DIFF:.2f}以内。"
    return "低", f"{detail}。1号艇が明確に上位。"


def _motor_picks(race: Race, motor_line: float | None) -> tuple[tuple[int, float], ...]:
    if motor_line is None:
        return ()
    return tuple(
        (r.teiban, r.motor_2ritsu)
        for r in sorted(race.racers, key=lambda r: -r.motor_2ritsu)
        if r.motor_2ritsu >= motor_line
    )


def _verdict(in_conf: Grade3, upset: Grade3) -> tuple[Verdict, str]:
    if in_conf == "高" and upset == "低":
        return "勝負", "イン信頼度が高く、波乱リスクが低い。読みどころがはっきりしている。"
    if in_conf == "低" and upset == "高":
        return "見送り", "イン信頼度が低く波乱リスクが高い。1号艇のセオリーが通じないレース。"
    return "標準", "極端な偏りがない。セオリー通りに見るレース。"


def _alt_anchor(race: Race) -> Racer | None:
    """1号艇が信頼できないレースで、代わりに軸に据えられる艇を探す。

    波乱リスクの判定は仕様上3・4号艇に限られる。2号艇や外枠に明確な実力者がいる
    レースを「読みどころなし」で片付けないための補完。

    判定は**コース補正込みのスコアで1号艇を上回るか**で行う。勝率差だけで見ると
    枠の不利を無視してしまい、住之江の1コース1着率56.2%を過小評価する。
    この基準はスミノエ・ログの軸選定と一致する。
    """
    boat1 = race.boat(1)
    if boat1 is None:
        return None
    boat1_score = _first_score(boat1)
    candidates = [
        r
        for r in race.racers
        if r.teiban != 1
        and _first_score(r) > boat1_score
        and (r.is_a_class or r.eval_shoritsu >= ALT_ANCHOR_MIN_SHORITSU)
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda r: (_first_score(r), -r.teiban))


def _first_score(racer: Racer) -> float:
    """1着（軸）としての評価。コース別1着率を織り込む。"""
    return racer.eval_shoritsu + COURSE_FIRST_RATE.get(racer.teiban, 0.0) / COURSE_WEIGHT_FIRST


def _partner_score(racer: Racer) -> float:
    """2・3着の相手候補としての評価。1着よりコース補正を弱くする。"""
    return racer.eval_shoritsu + COURSE_FIRST_RATE.get(racer.teiban, 0.0) / COURSE_WEIGHT_PLACE


def _rank_partners(race: Race, exclude: tuple[int, ...] = ()) -> list[Racer]:
    """2・3着の相手候補を、コース補正込みの評価で高い順に並べる。"""
    return sorted(
        (r for r in race.racers if r.teiban not in exclude),
        key=lambda r: (-_partner_score(r), r.teiban),
    )


def _format_set(boats: list[int]) -> str:
    """買い目の艇番セットを昇順で表記する（フォーメーション表記の実務慣習）。"""
    return "{" + ",".join(str(b) for b in sorted(set(boats))) + "}"


def _bet_shape(race: Race, verdict: Verdict, max_bets: int) -> str:
    """買い目の「型」を提示する。断定的な推奨ではなく定石の形を示すに留める。

    住之江は1コース1着率56.2%。勝負・標準はいずれも**1号艇を軸に置く**形にする。
    勝率だけで1着候補を選ぶと水面特性を無視した型になるため、そうしない。
    """
    if verdict == "見送り":
        alt = _alt_anchor(race)
        if alt is None:
            # 誰も抜け出していない本当の混戦。複勝は2着以内が的中なので、
            # コース補正込みの評価で選ぶ（スミノエ・ログの軸と一致させる）
            top = sorted(race.racers, key=lambda r: (-_first_score(r), r.teiban))[:1]
            if not top:
                return "買わない"
            return f"買わない、または複勝 {top[0].teiban}号艇 1点"
        # 1号艇は買えないが、明確に上位の艇がいる。その艇を軸にした型を示す
        alt_partners = _rank_partners(race, (alt.teiban,))
        second = [b.teiban for b in alt_partners[:2]]
        third_count = max(2, min(5, (max_bets + 2) // 2))
        third = [b.teiban for b in alt_partners[:third_count]]
        points = len(second) * len(third) - len(set(second) & set(third))
        return (
            f"1号艇の頭は避ける。買うなら{alt.teiban}号艇軸で "
            f"3連単フォーメーション {alt.teiban}-{_format_set(second)}-{_format_set(third)}"
            f"（{points}点）、または複勝 {alt.teiban}号艇 1点"
        )

    partners = _rank_partners(race, (1,))
    if race.boat(1) is None or len(partners) < 3:
        return "情報不足のため型を提示しない"

    if verdict == "勝負":
        second = [b.teiban for b in partners[:2]]
        # 3着候補には2着候補も含める。含めないと「2着2号艇→3着3号艇」を買えず、
        # フォーメーションとして不自然になる。
        # 点数 = 2着2艇 × 3着n艇 − 重複2 = 2n−2。max_bets に収まる最大の n を採る。
        third_count = max(2, min(5, (max_bets + 2) // 2))
        third = [b.teiban for b in partners[:third_count]]
        points = len(second) * len(third) - len(set(second) & set(third))
        return (
            f"3連単フォーメーション 1-{_format_set(second)}-{_format_set(third)}"
            f"（{points}点）"
        )

    # 標準: 1号艇を軸に据えたまま手広く。対抗の1着は3連複で押さえる。
    second = [b.teiban for b in partners[:2]]
    third = [b.teiban for b in partners[:3]]
    combos = [(s, t) for s in second for t in third if s != t]
    trio = sorted([1, *second])
    combos = combos[: max(1, max_bets - 1)]
    return (
        f"3連単フォーメーション 1-{_format_set(second)}-{_format_set(third)}"
        f"（{len(combos)}点） ＋ 3連複 {'='.join(str(b) for b in trio)} 1点"
        f"（対抗の1着を押さえ）"
    )


def analyze_race(race: Race, motor_line: float | None, max_bets: int) -> RaceAnalysis:
    boat1 = race.boat(1)
    if not race.ok or boat1 is None:
        return RaceAnalysis(
            race_no=race.race_no,
            in_confidence="中",
            in_reason="出走表を取得できなかったため判定できない。",
            upset_risk="中",
            upset_reason="出走表を取得できなかったため判定できない。",
            motor_picks=(),
            verdict="標準",
            verdict_reason="データ不足のため判定を保留した。",
            bet_shape="判定不能",
            notes=(race.parse_error or "取得失敗",),
        )

    in_conf, in_reason = _in_confidence(boat1, motor_line)
    upset, upset_reason = _upset_risk(race)
    verdict, verdict_reason = _verdict(in_conf, upset)

    notes: list[str] = []
    no_data = [r for r in race.racers if r.no_touchi_data]
    if no_data:
        seats = "・".join(f"{r.teiban}号艇 {r.name}" for r in no_data)
        notes.append(f"当地データなし（全国勝率で代替判定）: {seats}")

    if verdict == "見送り" and (alt := _alt_anchor(race)) is not None:
        diff = alt.eval_shoritsu - boat1.eval_shoritsu
        notes.append(
            f"1号艇より{alt.teiban}号艇 {alt.name}({alt.kyubetsu}) が明確に上位"
            f"（{_shoritsu_label(alt)}、差 +{diff:.2f}）。"
            "「読みどころなし」ではなく「1号艇の頭が薄い」レース。"
        )

    return RaceAnalysis(
        race_no=race.race_no,
        in_confidence=in_conf,
        in_reason=in_reason,
        upset_risk=upset,
        upset_reason=upset_reason,
        motor_picks=_motor_picks(race, motor_line),
        verdict=verdict,
        verdict_reason=verdict_reason,
        bet_shape=_bet_shape(race, verdict, max_bets),
        notes=tuple(notes),
    )


def analyze_program(
    program: Program, max_bets: int = DEFAULT_MAX_BETS
) -> tuple[tuple[RaceAnalysis, ...], float | None]:
    """全レースを分析する。

    Returns:
        (分析結果, モーター注目のしきい値)。しきい値は出力に母数として併記するため返す。
    """
    median = motor_median(program)
    motor_line = median + MOTOR_PICK_MARGIN if median is not None else None
    results = tuple(analyze_race(race, motor_line, max_bets) for race in program.races)
    return results, motor_line


def course_baseline_note() -> str:
    rates = " / ".join(f"{c}C {v}%" for c, v in COURSE_FIRST_RATE.items())
    return f"コース別1着率の基準: {rates}"
