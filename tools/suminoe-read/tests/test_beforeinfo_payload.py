"""直前情報のアプリ用ペイロード（tenji.json）のテスト。

Python 側は snake_case、アプリ側は camelCase。ここがずれると
アプリの parseBeforeInfo が黙って null を返すため、キー名まで検査する。
"""

from __future__ import annotations

import json
from pathlib import Path

from suminoe.beforeinfo_models import BeforeInfoDay, RaceBeforeInfo
from suminoe.beforeinfo_parser import parse_beforeinfo
from suminoe.beforeinfo_payload import (
    SCHEMA_VERSION,
    day_payload,
    is_same_content,
    merge_with_previous,
)

FIXTURES = Path(__file__).parent / "fixtures"
PUBLISHED_HTML = FIXTURES / "beforeinfo_20260808_1r.html"


def _day() -> BeforeInfoDay:
    published = parse_beforeinfo(PUBLISHED_HTML.read_text(encoding="utf-8"), race_no=1)
    return BeforeInfoDay(
        date="2026-08-08",
        updated_at="2026-08-08T20:40:00+09:00",
        races=(published, RaceBeforeInfo(race_no=2, available=False)),
    )


def test_day_payload_shape():
    payload = day_payload(_day())
    assert payload["schemaVersion"] == SCHEMA_VERSION
    assert payload["date"] == "2026-08-08"
    assert payload["updatedAt"] == "2026-08-08T20:40:00+09:00"
    assert [r["raceNo"] for r in payload["races"]] == [1, 2]


def test_entry_keys_are_camel_case():
    entry = day_payload(_day())["races"][0]["entries"][0]
    assert set(entry) == {
        "teiban",
        "name",
        "weight",
        "tenjiTime",
        "tilt",
        "propeller",
        "partsChanged",
        "stCourse",
        "stTime",
    }
    assert entry["teiban"] == 1
    assert entry["tenjiTime"] == 6.95
    assert entry["tilt"] == -0.5
    assert entry["partsChanged"] == ["リング×２"]
    assert entry["stCourse"] == 1
    assert entry["stTime"] == 0.19


def test_weather_keys_are_camel_case():
    weather = day_payload(_day())["races"][0]["weather"]
    assert set(weather) == {
        "observedAt",
        "tempC",
        "weather",
        "windM",
        "windDirNo",
        "waterTempC",
        "waveCm",
    }
    assert weather["tempC"] == 29.0
    assert weather["windDirNo"] == 17


def test_pending_race_has_empty_entries():
    pending = day_payload(_day())["races"][1]
    assert pending["available"] is False
    assert pending["entries"] == []
    assert pending["weather"] is None


def test_payload_is_json_serializable():
    # tuple のまま残っていると json.dumps は通るが、比較で False になり冪等性が壊れる
    text = json.dumps(day_payload(_day()), ensure_ascii=False)
    assert json.loads(text) == day_payload(_day())


# --- 冪等性（デプロイを無駄に走らせない） ---
def test_same_content_ignores_updated_at():
    first = day_payload(_day())
    second = day_payload(
        BeforeInfoDay(
            date=_day().date,
            updated_at="2026-08-08T23:59:00+09:00",  # 取得時刻だけ違う
            races=_day().races,
        )
    )
    assert is_same_content(first, second) is True


def test_different_races_are_not_same():
    first = day_payload(_day())
    changed = day_payload(
        BeforeInfoDay(
            date=_day().date,
            updated_at=_day().updated_at,
            races=(_day().races[0],),  # 2R が消えた
        )
    )
    assert is_same_content(first, changed) is False


def test_different_date_is_not_same():
    first = day_payload(_day())
    other_day = day_payload(
        BeforeInfoDay(date="2026-08-09", updated_at=_day().updated_at, races=_day().races)
    )
    assert is_same_content(first, other_day) is False


def test_missing_previous_is_not_same():
    assert is_same_content(None, day_payload(_day())) is False


# --- 取り損ねたレースの引き継ぎ ---
#
# 直前情報は一度公開されたら消えない。通信の一時障害でアプリの表示から
# 展示タイムが消えるのを防ぐため、取れなかったレースは前回の内容を残す。
def _pending_day(date_: str = "2026-08-08") -> dict:
    """全レース未取得（1R も available=False）の状態。"""
    return day_payload(
        BeforeInfoDay(
            date=date_,
            updated_at="2026-08-08T21:10:00+09:00",
            races=(
                RaceBeforeInfo(race_no=1, available=False),
                RaceBeforeInfo(race_no=2, available=False),
            ),
        )
    )


def test_merge_keeps_previously_available_race():
    merged = merge_with_previous(day_payload(_day()), _pending_day())
    assert merged["races"][0]["available"] is True
    assert merged["races"][0]["entries"][0]["tenjiTime"] == 6.95
    # 更新時刻は今回のものを使う（鮮度は「いつ確認したか」）
    assert merged["updatedAt"] == "2026-08-08T21:10:00+09:00"
    # もともと未公開の 2R はそのまま
    assert merged["races"][1]["available"] is False


def test_merge_prefers_current_when_available():
    previous = _pending_day()
    merged = merge_with_previous(previous, day_payload(_day()))
    assert merged["races"][0]["entries"][0]["tenjiTime"] == 6.95


def test_merge_ignores_previous_from_another_date():
    # 前日の tenji.json が残っていても引き継がない
    merged = merge_with_previous(day_payload(_day()), _pending_day("2026-08-09"))
    assert merged["races"][0]["available"] is False


def test_merge_without_previous_returns_current():
    current = _pending_day()
    assert merge_with_previous(None, current) == current
