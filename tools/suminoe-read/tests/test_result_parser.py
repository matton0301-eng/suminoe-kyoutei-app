"""競走成績パーサと照合のテスト。

フィクスチャ（2026-08-06 の実 LZH と TXT）を同梱しているため、ネット接続なしで通る。
"""

from __future__ import annotations

from pathlib import Path

import pytest

from suminoe.analyzer import analyze_program
from suminoe.parser import parse_program
from suminoe.result_models import BET_PLACE, BET_TRIFECTA, BET_TRIO, BET_WIDE
from suminoe.result_parser import (
    ResultParseError,
    extract_section,
    looks_like_entry_row,
    normalize_racer_name,
    parse_entry_row,
    parse_payout_table,
    parse_result_header,
    parse_results,
)
from suminoe.reviewer import review_day

FIXTURES = Path(__file__).parent / "fixtures"
RESULT_TXT = FIXTURES / "K260806.TXT"
RESULT_LZH = FIXTURES / "k260806.lzh"
PROGRAM_TXT = FIXTURES / "B260806.TXT"

# 実データから採取した行
ENTRY_ROW = "  01  1 5186 遠　藤　　圭　吾 68   50  6.96   1    0.11     1.52.2"
ENTRY_ROW_DISQUALIFIED = "  S2  2 3976 内　田　　　　圭 11   56  7.11   2    0.25      .  . "
RESULT_HEADER = "   1R       予選　　　　                 H1800m  晴　  風  南東　 3m  波　  1cm"


@pytest.fixture(scope="module")
def result_text() -> str:
    return RESULT_TXT.read_bytes().decode("cp932")


@pytest.fixture(scope="module")
def day(result_text: str):
    return parse_results(result_text, "2026-08-06")


# --- 着順行 ---
def test_parse_entry_row():
    entry = parse_entry_row(ENTRY_ROW)
    assert entry.rank_raw == "01"
    assert entry.rank == 1
    assert entry.teiban == 1
    assert entry.toban == 5186
    assert entry.name == "遠藤圭吾"
    assert entry.motor_no == 68
    assert entry.boat_no == 50
    assert entry.tenji == pytest.approx(6.96)
    assert entry.course == 1
    assert entry.st == pytest.approx(0.11)
    assert entry.finished is True


def test_parse_disqualified_row():
    """失格（S2）の艇は着順を数値化せず、完走扱いにしない。"""
    entry = parse_entry_row(ENTRY_ROW_DISQUALIFIED)
    assert entry.rank_raw == "S2"
    assert entry.rank is None
    assert entry.finished is False
    assert entry.teiban == 2
    assert entry.name == "内田圭"
    # 失格でも進入コースとSTは記録されている
    assert entry.course == 2
    assert entry.st == pytest.approx(0.25)


def test_normalize_racer_name():
    assert normalize_racer_name("遠　藤　　圭　吾") == "遠藤圭吾"
    assert normalize_racer_name("内　田　　　　圭") == "内田圭"


def test_looks_like_entry_row():
    assert looks_like_entry_row(ENTRY_ROW)
    assert looks_like_entry_row(ENTRY_ROW_DISQUALIFIED)
    assert not looks_like_entry_row(RESULT_HEADER)


# --- レースヘッダ ---
def test_parse_result_header():
    parsed = parse_result_header(RESULT_HEADER)
    assert parsed is not None
    race_no, name, weather, wind_dir, wind_m, wave_cm = parsed
    assert race_no == 1
    assert name == "予選"
    assert weather == "晴"
    assert wind_dir == "南東"
    assert wind_m == 3
    assert wave_cm == 1


# --- 払戻金の一覧表 ---
def test_parse_payout_table(result_text):
    section = extract_section(result_text, jcd=12)
    table = parse_payout_table(section)
    assert len(table) == 12
    # 1R は 3連単 1-3-2 が 1650円
    trifecta = next(p for p in table[1] if p.bet_type == BET_TRIFECTA)
    assert trifecta.combo == (1, 3, 2)
    assert trifecta.amount == 1650


# --- 全体 ---
def test_parse_results_full(day):
    assert day.place == "ボートレース住之江"
    assert len(day.races) == 12
    assert [r.race_no for r in day.races] == list(range(1, 13))
    assert not day.warnings, day.warnings
    for race in day.races:
        assert race.ok, f"{race.race_no}R が ok でない"
        assert len(race.order) == 3
        assert len(race.entries) == 6
        assert race.kimarite, f"{race.race_no}R に決まり手がない"


def test_order_matches_trifecta_payout(day):
    """着順は3連単の払戻と一致していなければならない。"""
    for race in day.races:
        trifecta = next(p for p in race.payouts if p.bet_type == BET_TRIFECTA)
        assert race.order == trifecta.combo, f"{race.race_no}R の着順が3連単と違う"


def test_all_bet_types_present(day):
    """アプリで提示する賭式の払戻がすべて取れていること。"""
    for race in day.races:
        kinds = {p.bet_type for p in race.payouts}
        for required in (BET_TRIFECTA, BET_TRIO, BET_WIDE, BET_PLACE):
            assert required in kinds, f"{race.race_no}R に {required} の払戻がない"


def test_wakunari_detection(day):
    """枠なり進入の判定。8/6 は 4R と 8R が枠なりでなかった。"""
    wakunari = {r.race_no: r.wakunari for r in day.races}
    assert wakunari[1] is True
    assert wakunari[4] is False
    assert wakunari[8] is False
    assert sum(1 for v in wakunari.values() if v) == 10


def test_payout_lookup(day):
    race = next(r for r in day.races if r.race_no == 1)
    hit = race.payout_of(BET_TRIFECTA, (1, 3, 2))
    assert hit is not None and hit.amount == 1650
    assert race.payout_of(BET_TRIFECTA, (1, 2, 3)) is None


def test_missing_place_raises(result_text):
    with pytest.raises(ResultParseError, match="99"):
        parse_results(result_text, "2026-08-06", jcd=99)


def test_extract_lzh_result(tmp_path):
    from suminoe.extractor import extract_lzh

    txt = extract_lzh(RESULT_LZH, tmp_path, log=lambda *_: None)
    assert txt.name.upper() == "K260806.TXT"
    assert "12KBGN" in txt.read_bytes().decode("cp932")


# --- 照合 ---
@pytest.fixture(scope="module")
def review(day):
    program = parse_program(PROGRAM_TXT.read_bytes().decode("cp932"), "2026-08-06")
    analyses, _ = analyze_program(program)
    return review_day(program, analyses, day)


def test_review_covers_all_races(review):
    assert review.total == 12
    assert not review.warnings, review.warnings


def test_review_inside_win_rate(review):
    """8/6 は1号艇1着が4レース（インが崩れた日）。"""
    assert review.inside_won_total == 4
    assert review.course_rates[1] == pytest.approx(4 / 12 * 100)


def test_review_verdict_summary(review):
    by_verdict = {s.verdict: s for s in review.by_verdict}
    assert by_verdict["勝負"].total == 2
    assert by_verdict["標準"].total == 4
    assert by_verdict["見送り"].total == 6
    assert sum(s.total for s in review.by_verdict) == 12


def test_review_anchor_tracking(review):
    """軸を読み取れており、1着だったかを判定できていること。"""
    races = {r.race_no: r for r in review.races}
    # 5R は勝負判定で1号艇が1着（1-6-4）
    assert races[5].anchor == 1
    assert races[5].anchor_won is True
    assert races[5].inside_won is True
    # 11R は勝負判定だが3号艇が1着（3-1-4）
    assert races[11].anchor == 1
    assert races[11].anchor_won is False
    assert races[11].inside_won is False


def test_review_records_disqualified(review):
    """4R の失格2艇が注記に残ること。"""
    race4 = next(r for r in review.races if r.race_no == 4)
    assert any("完走せず" in note for note in race4.notes)
    assert any("枠なりでない進入" in note for note in race4.notes)


def test_review_markdown_has_no_boastful_claims(review):
    """回収率などを成績として誇張していないこと。"""
    from suminoe.reviewer import render_review_markdown

    md = render_review_markdown(review)
    assert "母数" in md
    assert "控除率" in md
    for banned in ("必勝", "確実に", "儲か", "稼げ"):
        assert banned not in md
