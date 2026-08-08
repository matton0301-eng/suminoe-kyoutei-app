"""固定長パースのユニットテスト。

フィクスチャ（2026-08-06 の実データ）を同梱しているため、**ネット接続なしで全件通る**。
桁位置の根拠は docs/03-bangumihyou-format.md §6。
"""

from __future__ import annotations

from pathlib import Path

import pytest

from suminoe.parser import (
    ParseError,
    extract_section,
    looks_like_racer_row,
    normalize_name,
    parse_program,
    parse_race_header,
    parse_racer_row,
)

FIXTURES = Path(__file__).parent / "fixtures"
SAMPLE_TXT = FIXTURES / "B260806.TXT"
SAMPLE_LZH = FIXTURES / "b260806.lzh"

# 実データから採取した行（cp932 で 79 バイト）
ROW_STANDARD = "1 4299中島浩哉43長崎56B1 4.23 17.57 5.00 30.43 15 17.02 12 43.18             10"
ROW_FULLWIDTH_SPACE = "4 3797岩井　繁53広島61B1 3.64 11.88 2.67  0.00 15 27.63 88 37.88 421         10"
ROW_A1 = "2 4950高岡竜也33山口52A1 6.55 49.55 7.29 64.29 77 38.46 14 32.89 4 26         8"
HEADER_LINE = "　１Ｒ  予選　　　　          Ｈ１８００ｍ  電話投票締切予定１５：１７ "


@pytest.fixture(scope="module")
def sample_text() -> str:
    return SAMPLE_TXT.read_bytes().decode("cp932")


def patch_bytes(line: str, start: int, raw: bytes) -> str:
    """選手行の指定バイト位置を差し替える。

    桁位置はバイトオフセットで定義されている（全角1文字=2バイト）。
    文字数ベースのスライスでは位置がずれるため、必ずバイト列で操作する。
    """
    encoded = line.encode("cp932")
    patched = encoded[:start] + raw + encoded[start + len(raw) :]
    assert len(patched) == len(encoded), "差し替えで行長が変わってはいけない"
    return patched.decode("cp932")


# --- ケース1: 標準的な選手行のフルパース ---
def test_parse_standard_row():
    racer = parse_racer_row(ROW_STANDARD)
    assert racer.teiban == 1
    assert racer.toban == 4299
    assert racer.name == "中島浩哉"
    assert racer.age == 43
    assert racer.branch == "長崎"
    assert racer.weight == 56
    assert racer.kyubetsu == "B1"
    assert racer.zenkoku_shoritsu == pytest.approx(4.23)
    assert racer.zenkoku_2ritsu == pytest.approx(17.57)
    assert racer.touchi_shoritsu == pytest.approx(5.00)
    assert racer.touchi_2ritsu == pytest.approx(30.43)
    assert racer.motor_no == 15
    assert racer.motor_2ritsu == pytest.approx(17.02)
    assert racer.boat_no == 12
    assert racer.boat_2ritsu == pytest.approx(43.18)
    assert racer.hayami == "10"
    assert racer.no_touchi_data is False


# --- ケース2: 全角スペースを含む選手名 ---
def test_parse_row_with_fullwidth_space_in_name():
    racer = parse_racer_row(ROW_FULLWIDTH_SPACE)
    assert racer.name == "岩井繁"
    # 名前が短くても後続フィールドがずれない
    assert racer.age == 53
    assert racer.branch == "広島"
    assert racer.weight == 61
    assert racer.motor_no == 15
    assert racer.boat_no == 88


def test_normalize_name_strips_fullwidth_space():
    assert normalize_name("岩井　繁") == "岩井繁"
    assert normalize_name("中島浩哉") == "中島浩哉"


# --- ケース3: 当地勝率 0.00（当地実績なし）の扱い ---
def test_no_touchi_data_requires_both_zero():
    # 当地2率のみ 0.00、当地勝率は 2.67 → データなしとは扱わない
    partial = parse_racer_row(ROW_FULLWIDTH_SPACE)
    assert partial.touchi_shoritsu == pytest.approx(2.67)
    assert partial.touchi_2ritsu == pytest.approx(0.00)
    assert partial.no_touchi_data is False
    assert partial.eval_shoritsu == pytest.approx(2.67)

    # 両方 0.00 → データなし。評価は全国勝率で代替する
    # 当地勝率(35-41) と 当地2率(41-47) をまとめて差し替える
    both_zero = patch_bytes(ROW_STANDARD, 35, b" 0.00  0.00 ")
    racer = parse_racer_row(both_zero)
    assert racer.touchi_shoritsu == pytest.approx(0.0)
    assert racer.touchi_2ritsu == pytest.approx(0.0)
    assert racer.no_touchi_data is True
    assert racer.eval_shoritsu == pytest.approx(racer.zenkoku_shoritsu)
    # 差し替えで後続フィールドがずれていないこと
    assert racer.motor_no == 15
    assert racer.boat_no == 12


# --- ケース4: レースヘッダのパース ---
def test_parse_race_header():
    parsed = parse_race_header(HEADER_LINE)
    assert parsed is not None
    race_no, name, distance, deadline = parsed
    assert race_no == 1
    assert name == "予選"
    assert distance == 1800
    assert deadline == "15:17"


def test_parse_race_header_rejects_non_header():
    assert parse_race_header(ROW_STANDARD) is None
    assert parse_race_header("艇 選手 選手  年 支 体級    全国      当地") is None


# --- ケース5: 住之江セクションの切り出しと全体パース ---
def test_extract_suminoe_section(sample_text):
    section = extract_section(sample_text, jcd=12)
    assert section, "住之江セクションが取れていない"
    racer_rows = [line for line in section if looks_like_racer_row(line)]
    assert len(racer_rows) == 72, f"12R×6艇=72行のはずが {len(racer_rows)} 行"


def test_parse_program_full(sample_text):
    program = parse_program(sample_text, "2026-08-06")
    assert program.place == "ボートレース住之江"
    assert "にっぽん未来プロジェクト" in program.title
    assert len(program.races) == 12
    assert [r.race_no for r in program.races] == list(range(1, 13))
    assert all(race.ok for race in program.races), program.warnings
    assert not program.warnings
    for race in program.races:
        assert [r.teiban for r in race.racers] == [1, 2, 3, 4, 5, 6]


def test_parse_program_missing_place_raises(sample_text):
    # 場コード 99 は存在しない → 開催なしとしてエラー
    with pytest.raises(ParseError, match="99"):
        parse_program(sample_text, "2026-08-06", jcd=99)


# --- ケース6: LZH の解凍 ---
def test_extract_lzh(tmp_path):
    from suminoe.extractor import extract_lzh

    txt = extract_lzh(SAMPLE_LZH, tmp_path, log=lambda *_: None)
    assert txt.is_file()
    assert txt.name.upper() == "B260806.TXT"
    text = txt.read_bytes().decode("cp932")
    assert "12BBGN" in text
    assert "ボートレース住之江" in text


def test_extract_lzh_ignores_other_txt_in_dest(tmp_path):
    """解凍先に別の TXT があっても、書庫に対応する TXT を返す。

    番組表(B)と成績(K)は同じ `cache/` に溜まる。以前は「B で始まるものを優先」
    という選び方をしていたため、成績を解凍したのに番組表が返り、成績パーサが
    番組表を読んで「場コード 12 の区画がありません」という無関係なエラーを出した
    （2026-08-07）。紛れ込みやすい名前を置いた状態で確かめる。
    """
    from suminoe.extractor import extract_lzh

    # 実際に踏んだ状況を再現する: 先に番組表が置かれている想定の別名 TXT
    for decoy in ("B260807.TXT", "A000000.TXT", "K999999.TXT"):
        (tmp_path / decoy).write_bytes(b"decoy")

    txt = extract_lzh(SAMPLE_LZH, tmp_path, log=lambda *_: None)
    assert txt.name.upper() == SAMPLE_LZH.stem.upper() + ".TXT"
    assert txt.read_bytes() != b"decoy"
    assert "ボートレース住之江" in txt.read_bytes().decode("cp932")


# --- ケース7: 桁数の頑健性 ---
def test_short_row_is_padded():
    # 末尾の空白が失われた行でも、既知のフィールドは同じ値を返す
    trimmed = ROW_A1.rstrip()
    racer = parse_racer_row(trimmed)
    assert racer.name == "高岡竜也"
    assert racer.kyubetsu == "A1"
    assert racer.boat_2ritsu == pytest.approx(32.89)


def test_invalid_kyubetsu_raises():
    broken = patch_bytes(ROW_STANDARD, 22, b"XX")
    with pytest.raises(ParseError, match="級別"):
        parse_racer_row(broken)


def test_non_numeric_field_raises():
    broken = patch_bytes(ROW_STANDARD, 24, b" ab.c")
    with pytest.raises(ParseError, match="全国勝率"):
        parse_racer_row(broken)


def test_looks_like_racer_row():
    assert looks_like_racer_row(ROW_STANDARD)
    assert not looks_like_racer_row(HEADER_LINE)
    assert not looks_like_racer_row("7 1234ダミー選手30東京50A1 5.00 30.00 5.00 30.00 1 30.00 1 30.00 1  1")
