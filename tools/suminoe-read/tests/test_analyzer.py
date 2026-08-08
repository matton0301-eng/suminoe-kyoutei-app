"""分析ロジックのテスト。

設計思想（断定を避ける・母数を併記する・住之江の水面特性に沿う）が
コードとして守られていることを検証する。
"""

from __future__ import annotations

import dataclasses
from pathlib import Path

import pytest

from suminoe.analyzer import (
    MOTOR_PICK_MARGIN,
    analyze_program,
    analyze_race,
    motor_median,
)
from suminoe.models import Race, Racer
from suminoe.parser import parse_program

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="module")
def program():
    text = (FIXTURES / "B260806.TXT").read_bytes().decode("cp932")
    return parse_program(text, "2026-08-06")


def make_racer(teiban: int, **overrides) -> Racer:
    base = dict(
        teiban=teiban,
        toban=4000 + teiban,
        name=f"選手{teiban}",
        age=35,
        branch="大阪",
        weight=52,
        kyubetsu="B1",
        zenkoku_shoritsu=4.50,
        zenkoku_2ritsu=25.0,
        touchi_shoritsu=4.50,
        touchi_2ritsu=25.0,
        motor_no=teiban * 10,
        motor_2ritsu=30.0,
        boat_no=teiban * 10,
        boat_2ritsu=30.0,
        konsetsu="123",
        hayami="",
    )
    base.update(overrides)
    return Racer(**base)  # type: ignore[arg-type]


def make_race(racers: list[Racer], race_no: int = 1) -> Race:
    return Race(
        race_no=race_no,
        name="予選",
        distance_m=1800,
        deadline="15:00",
        racers=tuple(racers),
    )


# --- イン信頼度 ---
def test_in_confidence_high_for_a_class_with_strong_local_record():
    race = make_race(
        [make_racer(1, kyubetsu="A1", touchi_shoritsu=6.42)] + [make_racer(i) for i in range(2, 7)]
    )
    analysis = analyze_race(race, motor_line=99.0, max_bets=6)
    assert analysis.in_confidence == "高"
    assert "6.00以上" in analysis.in_reason


def test_in_confidence_rescues_a1_with_high_national_but_low_local():
    """当地勝率が低いA1級を「低」に落とさない。

    番組表には当地の走数が載っておらず、当地勝率は母数不明。
    母数の小さい数値で断定しないという設計思想の実装。
    """
    race = make_race(
        [make_racer(1, kyubetsu="A1", zenkoku_shoritsu=7.43, touchi_shoritsu=4.62)]
        + [make_racer(i) for i in range(2, 7)]
    )
    analysis = analyze_race(race, motor_line=99.0, max_bets=6)
    assert analysis.in_confidence == "高"
    assert "走数がない" in analysis.in_reason


def test_in_confidence_mid_for_b_class_above_local_line():
    """B級でも当地勝率が基準以上なら「低」にしない。"""
    race = make_race(
        [make_racer(1, kyubetsu="B1", touchi_shoritsu=5.44, zenkoku_shoritsu=4.55)]
        + [make_racer(i) for i in range(2, 7)]
    )
    analysis = analyze_race(race, motor_line=99.0, max_bets=6)
    assert analysis.in_confidence == "中"


def test_in_confidence_low_when_both_rates_weak():
    race = make_race(
        [make_racer(1, kyubetsu="B1", touchi_shoritsu=3.13, zenkoku_shoritsu=4.14)]
        + [make_racer(i) for i in range(2, 7)]
    )
    analysis = analyze_race(race, motor_line=99.0, max_bets=6)
    assert analysis.in_confidence == "低"


def test_no_touchi_data_is_capped_at_mid_and_annotated():
    """当地実績なしの艇は全国勝率で判定し、「高」には上げず、注記を残す。"""
    race = make_race(
        [
            make_racer(
                1,
                kyubetsu="A1",
                zenkoku_shoritsu=7.50,
                touchi_shoritsu=0.0,
                touchi_2ritsu=0.0,
            )
        ]
        + [make_racer(i) for i in range(2, 7)]
    )
    analysis = analyze_race(race, motor_line=99.0, max_bets=6)
    assert analysis.in_confidence == "中"
    assert any("当地データなし" in note for note in analysis.notes)


# --- 波乱リスク ---
def test_upset_high_when_challenger_outranks_boat1():
    race = make_race(
        [make_racer(1, touchi_shoritsu=4.00), make_racer(2)]
        + [make_racer(3, touchi_shoritsu=6.60)]
        + [make_racer(i) for i in range(4, 7)]
    )
    analysis = analyze_race(race, motor_line=99.0, max_bets=6)
    assert analysis.upset_risk == "高"


def test_upset_low_when_boat1_clearly_ahead():
    race = make_race(
        [make_racer(1, kyubetsu="A1", touchi_shoritsu=7.11)]
        + [make_racer(i, touchi_shoritsu=4.00) for i in range(2, 7)]
    )
    analysis = analyze_race(race, motor_line=99.0, max_bets=6)
    assert analysis.upset_risk == "低"
    assert analysis.verdict == "勝負"


def test_upset_high_when_outer_a1_against_b_class_inside():
    race = make_race(
        [make_racer(1, kyubetsu="B1", touchi_shoritsu=5.50)]
        + [make_racer(2)]
        + [make_racer(3, touchi_shoritsu=5.20)]
        + [make_racer(4)]
        + [make_racer(5, kyubetsu="A1", touchi_shoritsu=5.00)]
        + [make_racer(6)]
    )
    analysis = analyze_race(race, motor_line=99.0, max_bets=6)
    assert analysis.upset_risk == "高"
    assert "A1級がいる" in analysis.upset_reason


# --- モーター注目 ---
def test_motor_pick_threshold_uses_median_plus_margin(program):
    median = motor_median(program)
    assert median is not None
    _, motor_line = analyze_program(program)
    assert motor_line == pytest.approx(median + MOTOR_PICK_MARGIN)


def test_motor_picks_listed_above_line():
    race = make_race(
        [make_racer(1, motor_2ritsu=58.2), make_racer(2, motor_2ritsu=20.0)]
        + [make_racer(i, motor_2ritsu=30.0) for i in range(3, 7)]
    )
    analysis = analyze_race(race, motor_line=46.0, max_bets=6)
    assert analysis.motor_picks == ((1, 58.2),)


# --- 買い目の型 ---
def test_bet_shape_always_anchors_on_boat1_for_shobu_and_hyojun(program):
    """住之江は1コース1着率56.2%。勝負・標準の型は必ず1号艇を軸に置く。"""
    analyses, _ = analyze_program(program)
    for analysis in analyses:
        if analysis.verdict in ("勝負", "標準"):
            assert analysis.bet_shape.startswith("3連単フォーメーション 1-"), (
                f"{analysis.race_no}R の型が1号艇軸になっていない: {analysis.bet_shape}"
            )


def test_bet_shape_respects_max_bets():
    race = make_race(
        [make_racer(1, kyubetsu="A1", touchi_shoritsu=7.11)]
        + [make_racer(i, touchi_shoritsu=4.00) for i in range(2, 7)]
    )
    for max_bets in (2, 4, 6):
        analysis = analyze_race(race, motor_line=99.0, max_bets=max_bets)
        assert analysis.verdict == "勝負"
        points = int(analysis.bet_shape.split("（")[1].rstrip("点）"))
        assert points <= max_bets, f"max_bets={max_bets} を超えた: {analysis.bet_shape}"


def test_bet_shape_prefers_inner_lane_among_similar_racers():
    """勝率が同じなら、コース別1着率の高い内側の枠を相手の上位に置く。"""
    race = make_race(
        [make_racer(1, kyubetsu="A1", touchi_shoritsu=7.11)]
        + [make_racer(i, touchi_shoritsu=4.00) for i in range(2, 7)]
    )
    analysis = analyze_race(race, motor_line=99.0, max_bets=6)
    assert "1-{2,3}-" in analysis.bet_shape


def test_miokuri_without_clear_anchor_offers_no_trifecta():
    """誰も抜け出していない本当の混戦では3連単の型を出さない。"""
    race = make_race(
        [make_racer(1, kyubetsu="B2", touchi_shoritsu=4.60, zenkoku_shoritsu=4.08)]
        + [make_racer(2, touchi_shoritsu=4.80)]
        + [make_racer(3, touchi_shoritsu=5.20)]
        + [make_racer(i, touchi_shoritsu=4.70) for i in range(4, 7)]
    )
    analysis = analyze_race(race, motor_line=99.0, max_bets=6)
    assert analysis.verdict == "見送り"
    assert "3連単" not in analysis.bet_shape
    assert "買わない" in analysis.bet_shape


def test_miokuri_with_strong_outsider_proposes_alternative_anchor():
    """1号艇が弱くても他に明確な実力者がいれば、その艇を軸にした型を示す。

    波乱リスクは仕様上3・4号艇しか見ないため、2号艇に実力者がいるレースを
    「読みどころなし」で片付けてしまう。それを補う挙動。
    """
    race = make_race(
        [make_racer(1, kyubetsu="B1", touchi_shoritsu=3.59, zenkoku_shoritsu=4.67)]
        + [make_racer(2, kyubetsu="A1", touchi_shoritsu=7.29)]
        + [make_racer(3, touchi_shoritsu=5.22)]
        + [make_racer(i) for i in range(4, 7)]
    )
    analysis = analyze_race(race, motor_line=99.0, max_bets=6)
    assert analysis.verdict == "見送り"
    assert "1号艇の頭は避ける" in analysis.bet_shape
    assert "2号艇軸" in analysis.bet_shape
    assert analysis.bet_shape.count("3連単") == 1
    assert any("明確に上位" in note for note in analysis.notes)


def test_alternative_anchor_respects_max_bets():
    race = make_race(
        [make_racer(1, kyubetsu="B1", touchi_shoritsu=3.59, zenkoku_shoritsu=4.67)]
        + [make_racer(2, kyubetsu="A1", touchi_shoritsu=7.29)]
        + [make_racer(3, touchi_shoritsu=5.22)]
        + [make_racer(i) for i in range(4, 7)]
    )
    for max_bets in (2, 4, 6):
        analysis = analyze_race(race, motor_line=99.0, max_bets=max_bets)
        points = int(analysis.bet_shape.split("（")[1].split("点")[0])
        assert points <= max_bets


# --- 取得失敗レースの扱い ---
def test_failed_race_is_not_judged():
    race = Race(
        race_no=7, name="予選", distance_m=1800, deadline="18:00", racers=(), parse_error="取得失敗"
    )
    analysis = analyze_race(race, motor_line=46.0, max_bets=6)
    assert analysis.bet_shape == "判定不能"
    assert "判定できない" in analysis.in_reason


def test_analysis_never_contains_probability_claims(program):
    """存在しない小数精度の「的中確率」を出力しないこと。"""
    analyses, _ = analyze_program(program)
    for analysis in analyses:
        blob = " ".join(
            [analysis.in_reason, analysis.upset_reason, analysis.verdict_reason, analysis.bet_shape]
        )
        for banned in ("的中率", "的中確率", "勝率予測", "期待値"):
            assert banned not in blob, f"{analysis.race_no}R に断定的表現: {banned}"


def test_immutability_of_models():
    racer = make_racer(1)
    with pytest.raises(dataclasses.FrozenInstanceError):
        racer.name = "変更"  # type: ignore[misc]
