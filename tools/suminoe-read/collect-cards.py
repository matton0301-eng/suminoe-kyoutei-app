"""過去の開催日の番組表を集めて cache/cards/ に蓄積する。

確率モデルの較正（calibrate）に使う。成績（cache/history/）と対にすることで
「事前にどう見立てたか」と「実際にどうなったか」を突き合わせられる。

    python collect-cards.py              # history にある開催日すべて
    python collect-cards.py --limit 10   # 先頭10日だけ（動作確認用）

出力はアプリの racecard.json と同じ形式。較正スクリプト（TypeScript）が
アプリ本体と同じ取り込み処理で読めるようにするため。

**過去成績の実測（enrich）は混ぜない。** 蓄積してある成績はその日より後のものも含むため、
過去日に当てると「未来を見て予想した」ことになり、較正が甘く出る。
番組表に書かれている値だけで見立てを再現する。
"""

from __future__ import annotations

import argparse
import sys
import time
from datetime import date, datetime
from pathlib import Path

from suminoe.analyzer import analyze_program
from suminoe.extractor import ExtractError, extract_lzh
from suminoe.fetcher import MIN_INTERVAL_SEC, KIND_PROGRAM, FetchError, fetch_lzh, read_text
from suminoe.formatter import render_json
from suminoe.parser import ParseError, parse_program

ROOT = Path(__file__).resolve().parent
CACHE_DIR = ROOT / "cache"
HISTORY_DIR = CACHE_DIR / "history"
CARDS_DIR = CACHE_DIR / "cards"


def _configure_stdout() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
        except (AttributeError, ValueError):
            pass


def held_days() -> list[date]:
    """成績が蓄積されている日＝住之江の開催日。古い順に返す。"""
    days: list[date] = []
    for path in sorted(HISTORY_DIR.glob("*.json")):
        try:
            days.append(datetime.strptime(path.stem, "%Y%m%d").date())
        except ValueError:
            continue
    return days


def collect_day(target: date, use_cache: bool = True) -> str:
    """1日分の番組表を取り込む。'saved' / 'cached' / 'unavailable' を返す。"""
    out_path = CARDS_DIR / f"{target:%Y%m%d}.json"
    if use_cache and out_path.is_file():
        return "cached"

    quiet = lambda *_: None  # noqa: E731 - 取得の詳細ログは出さない（63日分回るため）
    try:
        lzh = fetch_lzh(target, CACHE_DIR, use_cache=use_cache, kind=KIND_PROGRAM, log=quiet)
        txt = CACHE_DIR / f"B{target:%y%m%d}.TXT"
        if not txt.is_file():
            txt = extract_lzh(lzh, CACHE_DIR, log=quiet)
        text = read_text(txt, log=quiet)
    except (FetchError, ExtractError):
        return "unavailable"

    try:
        program = parse_program(text, f"{target:%Y-%m-%d}")
    except ParseError:
        return "unavailable"

    analyses, motor_line = analyze_program(program)
    CARDS_DIR.mkdir(parents=True, exist_ok=True)
    out_path.write_text(render_json(program, analyses, motor_line), encoding="utf-8")
    return "saved"


def main(argv: list[str] | None = None) -> int:
    _configure_stdout()
    parser = argparse.ArgumentParser(
        prog="collect-cards.py",
        description=(
            "確率モデルの較正に使う過去の番組表を集めます。"
            "成績が蓄積されている日（＝開催日）だけを取りに行きます。"
        ),
    )
    parser.add_argument("--limit", type=int, help="先頭からこの日数だけ処理する")
    parser.add_argument("--no-cache", action="store_true", help="すでにあるものも取り直す")
    args = parser.parse_args(argv)

    days = held_days()
    if args.limit:
        days = days[: args.limit]
    if not days:
        print("cache/history/ が空です。先に collect-history.py を実行してください。")
        return 1

    print(f"過去の番組表を集めます: {days[0]} 〜 {days[-1]}（{len(days)} 開催日）")
    print(f"公式サーバへの礼儀として {MIN_INTERVAL_SEC} 秒間隔で取得します。")
    print()

    counts = {"saved": 0, "cached": 0, "unavailable": 0}
    fetched = 0
    for index, target in enumerate(days, start=1):
        if fetched:
            time.sleep(MIN_INTERVAL_SEC)
        result = collect_day(target, use_cache=not args.no_cache)
        counts[result] += 1
        if result != "cached":
            fetched += 1
        if index % 10 == 0 or index == len(days):
            print(f"  {index}/{len(days)} 日  取得 {counts['saved']} / 既存 {counts['cached']}"
                  f" / 取れず {counts['unavailable']}")

    print()
    print(f"完了: {CARDS_DIR} に {counts['saved'] + counts['cached']} 日分")
    if counts["unavailable"]:
        print(f"  {counts['unavailable']} 日は番組表を取得できませんでした（古い日付は配布が終わっている可能性）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
