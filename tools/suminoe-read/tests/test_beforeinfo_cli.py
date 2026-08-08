"""beforeinfo.py CLI の引数解釈のテスト。

取得そのものはネットに出るので触らない。ここで見るのは
「外から来た値を境界で弾けているか」だけ。
"""

from __future__ import annotations

import pytest

from beforeinfo import parse_races


def test_range_form():
    assert parse_races("1-12") == tuple(range(1, 13))
    assert parse_races("3-5") == (3, 4, 5)


def test_list_form():
    assert parse_races("1,3,5") == (1, 3, 5)
    assert parse_races("5,3,1") == (1, 3, 5)  # 昇順に均す


def test_mixed_form_and_duplicates():
    assert parse_races("1-3,7,2") == (1, 2, 3, 7)


def test_spaces_are_ignored():
    assert parse_races(" 1 , 2 ") == (1, 2)


@pytest.mark.parametrize("raw", ["0-3", "1-13", "13", "0", "-1"])
def test_out_of_range_is_rejected(raw):
    with pytest.raises(SystemExit):
        parse_races(raw)


@pytest.mark.parametrize("raw", ["", "abc", "1-", "1-2-3", ","])
def test_malformed_is_rejected(raw):
    with pytest.raises(SystemExit):
        parse_races(raw)
