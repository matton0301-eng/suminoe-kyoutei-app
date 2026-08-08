"""過去の競走成績を集めて蓄積する。

住之江の過去レースを自分で集計することで、**母数のわかる実績**が作れる。
番組表の「当地勝率」は走数が載っておらず母数不明なので、断定的に使えない。
ここで集めたデータなら「住之江で何走してこの成績」と言える。

    python collect-history.py                 # 直近90日
    python collect-history.py --days 180
    python collect-history.py --days 30 --no-cache

公式サーバへの礼儀として、取得のたびに 1.5 秒以上あける。
すでにキャッシュにある日は取りに行かない（開催がなかった日も記録して再取得を防ぐ）。
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import date, timedelta
from pathlib import Path

from suminoe.extractor import ExtractError, extract_lzh
from suminoe.fetcher import (
    KIND_RESULT,
    MIN_INTERVAL_SEC,
    FetchError,
    fetch_lzh,
    read_text,
)
from suminoe.result_parser import ResultParseError, parse_results

ROOT = Path(__file__).resolve().parent
CACHE_DIR = ROOT / "cache"
HISTORY_DIR = ROOT / "cache" / "history"
#: 取得を試みたが住之江の開催がなかった日を記録する（再取得を避けるため）
NO_RACE_INDEX = HISTORY_DIR / "_no_race.json"


def _configure_stdout() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
        except (AttributeError, ValueError):
            pass


def load_no_race_days() -> set[str]:
    if not NO_RACE_INDEX.is_file():
        return set()
    try:
        return set(json.loads(NO_RACE_INDEX.read_text(encoding="utf-8")))
    except (json.JSONDecodeError, OSError):
        return set()


def save_no_race_days(days: set[str]) -> None:
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    NO_RACE_INDEX.write_text(json.dumps(sorted(days), ensure_ascii=False), encoding="utf-8")


def history_path(target: date) -> Path:
    return HISTORY_DIR / f"{target:%Y%m%d}.json"


def to_payload(day) -> dict:
    """集計に必要な情報だけを残して保存する（生データは cache/ にある）。"""
    return {
        "date": day.date,
        "title": day.title,
        "dayLabel": day.day_label,
        "races": [
            {
                "raceNo": race.race_no,
                "name": race.name,
                "order": list(race.order),
                "kimarite": race.kimarite,
                "weather": race.weather,
                "windM": race.wind_m,
                "waveCm": race.wave_cm,
                "wakunari": race.wakunari,
                "entries": [
                    {
                        "teiban": e.teiban,
                        "toban": e.toban,
                        "name": e.name,
                        "rank": e.rank,
                        "rankRaw": e.rank_raw,
                        "course": e.course,
                        "st": e.st,
                        "tenji": e.tenji,
                        "motorNo": e.motor_no,
                        "boatNo": e.boat_no,
                    }
                    for e in race.entries
                ],
            }
            for race in day.races
            if race.ok
        ],
    }


def collect_day(target: date, use_cache: bool, log=print) -> str:
    """1日分を取得して保存する。戻り値は 'saved' / 'cached' / 'norace' / 'unavailable'。"""
    out_path = history_path(target)
    if use_cache and out_path.is_file():
        return "cached"

    try:
        lzh = fetch_lzh(target, CACHE_DIR, use_cache=use_cache, kind=KIND_RESULT, log=lambda *_: None)
    except FetchError:
        return "unavailable"

    try:
        txt = CACHE_DIR / f"K{target:%y%m%d}.TXT"
        if not txt.is_file():
            txt = extract_lzh(lzh, CACHE_DIR, log=lambda *_: None)
        text = read_text(txt, log=lambda *_: None)
    except ExtractError:
        return "unavailable"

    try:
        day = parse_results(text, f"{target:%Y-%m-%d}")
    except ResultParseError:
        # 住之江の開催がない日。以後取りに行かないよう記録する
        return "norace"

    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(to_payload(day), ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    return "saved"


def main(argv: list[str] | None = None) -> int:
    _configure_stdout()
    parser = argparse.ArgumentParser(
        prog="collect-history.py",
        description="住之江の過去の競走成績を集めて cache/history/ に蓄積します。",
    )
    parser.add_argument("--days", type=int, default=90, help="さかのぼる日数（既定90）")
    parser.add_argument("--until", help="この日まで（YYYY-MM-DD）。既定は昨日")
    parser.add_argument("--no-cache", action="store_true", help="キャッシュを無視して取り直す")
    args = parser.parse_args(argv)

    if args.until:
        from datetime import datetime

        end = datetime.strptime(args.until, "%Y-%m-%d").date()
    else:
        end = date.today() - timedelta(days=1)

    use_cache = not args.no_cache
    no_race = load_no_race_days()

    targets = [end - timedelta(days=offset) for offset in range(args.days)]
    print(f"住之江の過去成績を収集します: {targets[-1]} 〜 {targets[0]}（{len(targets)}日分）")
    print(f"公式サーバへの礼儀として {MIN_INTERVAL_SEC} 秒間隔で取得します。")
    print()

    counts = {"saved": 0, "cached": 0, "norace": 0, "unavailable": 0}
    fetched_this_run = 0

    for target in targets:
        key = f"{target:%Y-%m-%d}"
        if use_cache and key in no_race:
            counts["norace"] += 1
            continue
        if use_cache and history_path(target).is_file():
            counts["cached"] += 1
            continue

        # 実際に取りに行くときだけ間隔をあける
        if fetched_this_run:
            time.sleep(MIN_INTERVAL_SEC)
        fetched_this_run += 1

        status = collect_day(target, use_cache)
        counts[status] += 1
        if status == "norace":
            no_race.add(key)
        if status == "saved":
            print(f"  取得: {key}")
        elif status == "unavailable":
            print(f"  取得できず: {key}")

    save_no_race_days(no_race)

    total_days = len(list(HISTORY_DIR.glob("2*.json")))
    total_races = 0
    for path in HISTORY_DIR.glob("2*.json"):
        try:
            total_races += len(json.loads(path.read_text(encoding="utf-8")).get("races", []))
        except (json.JSONDecodeError, OSError):
            continue

    print()
    print(
        f"完了: 新規 {counts['saved']} 日 / キャッシュ {counts['cached']} 日 / "
        f"開催なし {counts['norace']} 日 / 取得不可 {counts['unavailable']} 日"
    )
    print(f"蓄積: {total_days} 開催日 / {total_races} レース分（{HISTORY_DIR}）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
