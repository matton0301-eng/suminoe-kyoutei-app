"""直前情報（beforeinfo）パーサのテスト。

フィクスチャは公式PCサイトの実ページをそのまま保存したもの。ネット接続なしで通る。

- beforeinfo_20260808_1r.html  2026-08-08 1R（周回展示・スタート展示ともに公開済み）
- beforeinfo_20260808_9r.html  2026-08-08 9R（各選手に「前走」欄がある。1R には無い）
- beforeinfo_20260809_1r_pending.html  2026-08-09 1R（番組は組まれているが直前情報は未公開）
"""

from __future__ import annotations

from pathlib import Path

import pytest

from suminoe.beforeinfo_parser import BeforeInfoParseError, parse_beforeinfo

FIXTURES = Path(__file__).parent / "fixtures"
PUBLISHED_HTML = FIXTURES / "beforeinfo_20260808_1r.html"
WITH_PREVIOUS_HTML = FIXTURES / "beforeinfo_20260808_9r.html"
PENDING_HTML = FIXTURES / "beforeinfo_20260809_1r_pending.html"


@pytest.fixture(scope="module")
def published():
    return parse_beforeinfo(PUBLISHED_HTML.read_text(encoding="utf-8"), race_no=1)


@pytest.fixture(scope="module")
def pending():
    return parse_beforeinfo(PENDING_HTML.read_text(encoding="utf-8"), race_no=1)


# --- 公開済みのレース ---
def test_published_is_available(published):
    assert published.available is True
    assert published.race_no == 1
    assert len(published.entries) == 6
    assert [e.teiban for e in published.entries] == [1, 2, 3, 4, 5, 6]


def test_tenji_time_and_tilt(published):
    assert [e.tenji_time for e in published.entries] == [6.95, 6.94, 6.99, 6.91, 6.92, 6.97]
    assert [e.tilt for e in published.entries] == [-0.5, 0.0, -0.5, -0.5, 0.0, -0.5]


def test_weight_and_name(published):
    first = published.entries[0]
    assert first.name == "佐藤大騎"
    assert first.weight == 52.0
    assert published.entries[1].weight == 54.9


def test_parts_changed(published):
    # リング交換は1・3・5号艇。2・4・6号艇は交換なし
    assert published.entries[0].parts_changed == ("リング×２",)
    assert published.entries[1].parts_changed == ()
    assert published.entries[2].parts_changed == ("リング×２",)
    assert published.entries[3].parts_changed == ()


def test_propeller_not_changed(published):
    # このレースはプロペラ交換なし（交換時は「新」と表示される）
    assert all(e.propeller is None for e in published.entries)


def test_start_exhibition_course_and_st(published):
    # スタート展示テーブルは上から順にコース。このレースは枠なり進入
    assert [e.st_course for e in published.entries] == [1, 2, 3, 4, 5, 6]
    assert published.entries[0].st_time == 0.19
    assert published.entries[1].st_time == 0.30
    assert published.entries[2].st_time == 0.42


def test_flying_start_is_negative(published):
    # 4号艇は "F.06"（フライング）
    assert published.entries[3].st_time == -0.06


def test_weather(published):
    weather = published.weather
    assert weather is not None
    assert weather.temp_c == 29.0
    assert weather.weather == "晴"
    assert weather.wind_m == 0
    assert weather.water_temp_c == 31.0
    assert weather.wave_cm == 1
    assert weather.wind_dir_no == 17
    assert weather.observed_at == "20:33"


# --- 前走欄のあるレース（後半のレースはこちらが普通） ---
#
# 出走表の各行には、その選手のその日の前走（R・進入・ST・着順）が並ぶ。
# そこの艇番セルにも艇色の class が付くため、素朴に拾うと1レースが
# 12艇に膨らむ。1R は前走が無いので、このフィクスチャでしか再現しない。
@pytest.fixture(scope="module")
def with_previous():
    return parse_beforeinfo(WITH_PREVIOUS_HTML.read_text(encoding="utf-8"), race_no=9)


def test_previous_race_cells_do_not_add_boats(with_previous):
    assert len(with_previous.entries) == 6
    assert [e.teiban for e in with_previous.entries] == [1, 2, 3, 4, 5, 6]


def test_previous_race_page_values(with_previous):
    entries = with_previous.entries
    assert [e.name for e in entries] == [
        "岡部大輝",
        "君島秀三",
        "渡辺空依",
        "亀山雅幸",
        "高岡竜也",
        "抹香雄三",
    ]
    assert [e.tenji_time for e in entries] == [6.87, 6.94, 6.89, 6.85, 6.88, 6.90]
    assert [e.tilt for e in entries] == [-0.5, -0.5, 0.0, 0.0, -0.5, -0.5]
    assert entries[0].weight == 52.2


def test_previous_race_page_start_exhibition(with_previous):
    entries = with_previous.entries
    assert [e.st_course for e in entries] == [1, 2, 3, 4, 5, 6]
    assert [e.st_time for e in entries] == [0.16, 0.10, 0.27, -0.01, 0.01, 0.03]


# --- 未公開のレース ---
def test_pending_is_not_available(pending):
    assert pending.available is False
    assert pending.entries == ()
    assert pending.weather is None


# --- 壊れた入力 ---
def test_empty_html_raises():
    with pytest.raises(BeforeInfoParseError):
        parse_beforeinfo("", race_no=1)


def test_html_without_table_raises():
    with pytest.raises(BeforeInfoParseError):
        parse_beforeinfo("<html><body><p>メンテナンス中</p></body></html>", race_no=1)
