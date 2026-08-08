"""直前情報（展示タイム・チルト・部品交換・スタート展示）を取得する CLI。

    python beforeinfo.py                              # 当日の全12R
    python beforeinfo.py --date 2026-08-09 --races 1-6
    python beforeinfo.py --local-file tests\\fixtures\\beforeinfo_20260808_1r.html --races 1

直前情報は**各レースの周回展示後**（締切の10〜15分前）に順次公開される。
まだのレースはエラーではなく「まだ」として `available: false` で書き出す。

出力:
    apps/suminoe-log/public/tenji.json              アプリが起動時に読む
    apps/suminoe-log/public/archive/tenji-YYYYMMDD.json  過去日の振り返り用

終了コード:
    0  書き出した（デプロイする価値がある）
    1  エラー
    3  前回と中身が同じだったので書き換えていない（デプロイ不要）
    4  1レースも取得できなかった。既存ファイルは触っていない

30分おきにタスクスケジューラから回す前提なので、3 と 4 を分けている。
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from suminoe.beforeinfo_models import BeforeInfoDay, RaceBeforeInfo
from suminoe.beforeinfo_parser import BeforeInfoParseError, parse_beforeinfo
from suminoe.beforeinfo_payload import day_payload, is_same_content, merge_with_previous
from suminoe.fetcher import (
    MIN_INTERVAL_SEC,
    FetchError,
    fetch_beforeinfo_html,
    open_session,
)

ROOT = Path(__file__).resolve().parent
APP_TENJI_PATH = ROOT.parent.parent / "apps" / "suminoe-log" / "public" / "tenji.json"
APP_ARCHIVE_DIR = APP_TENJI_PATH.parent / "archive"

JST = timezone(timedelta(hours=9))

#: 連続でこの回数失敗したら打ち切る（公式サイトの不調・通信断で粘らない）
MAX_CONSECUTIVE_FAILURES = 3

EXIT_OK = 0
EXIT_ERROR = 1
EXIT_UNCHANGED = 3
EXIT_NO_DATA = 4


def _configure_stdout() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
        except (AttributeError, ValueError):
            pass


def _parse_date(raw: str | None) -> date:
    if raw is None:
        return datetime.now(JST).date()
    try:
        return datetime.strptime(raw, "%Y-%m-%d").date()
    except ValueError as exc:
        raise SystemExit(f"--date は YYYY-MM-DD 形式で指定してください: {raw!r}") from exc


def parse_races(raw: str) -> tuple[int, ...]:
    """"1-12" / "1,3,5" / "1-3,7" を解釈して昇順の重複なしで返す。"""
    numbers: set[int] = set()
    for chunk in raw.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        try:
            if "-" in chunk:
                start, end = (int(part) for part in chunk.split("-", 1))
                numbers.update(range(start, end + 1))
            else:
                numbers.add(int(chunk))
        except ValueError as exc:
            raise SystemExit(f"--races の書式が不正です: {chunk!r}（例: 1-12 / 1,3,5）") from exc
    if not numbers or any(n < 1 or n > 12 for n in numbers):
        raise SystemExit(f"--races は 1〜12 の範囲で指定してください: {raw!r}")
    return tuple(sorted(numbers))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="beforeinfo.py",
        description=(
            "直前情報（展示タイム・チルト・部品交換・スタート展示）を取得し、"
            "アプリが読む tenji.json に書き出します。"
            "表示のための材料であり、買い目の評価には使いません。"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "直前情報は各レースの周回展示後（締切の10〜15分前）に順次公開されます。\n"
            "まだのレースは available: false として書き出します（エラーではありません）。"
        ),
    )
    parser.add_argument("--date", help="対象日 (YYYY-MM-DD)。省略時は当日（JST）")
    parser.add_argument("--races", default="1-12", help="対象レース。既定は 1-12")
    parser.add_argument("--local-file", help="HTML を直接読む（取得をスキップ。--races で1つ指定）")
    parser.add_argument("--out", help="書き出し先を差し替える（検証用。アーカイブは書かない）")
    parser.add_argument(
        "--force", action="store_true", help="前回と中身が同じでも書き出す"
    )
    parser.add_argument(
        "--no-app-data",
        dest="emit_app_data",
        action="store_false",
        help="ファイルを書かず、取得結果の要約だけ表示する",
    )
    return parser


def _fetch_one(
    target: date, race_no: int, session, log
) -> tuple[RaceBeforeInfo, bool]:
    """1レース取得する。返り値は (結果, 取得できたか)。

    取得や解析に失敗したレースは available=False として返す。呼び出し側が
    前回の内容で埋めるため、ここで例外を投げて全体を止めない。
    """
    try:
        html = fetch_beforeinfo_html(target, race_no, session=session, log=log)
        return parse_beforeinfo(html, race_no), True
    except FetchError as exc:
        log(f"  {race_no}R: 取得できません: {exc}")
    except BeforeInfoParseError as exc:
        log(f"  {race_no}R: 解析できません: {exc}")
    return RaceBeforeInfo(race_no=race_no, available=False), False


def collect(
    target: date, races: tuple[int, ...], log=print
) -> tuple[tuple[RaceBeforeInfo, ...], int]:
    """指定レースの直前情報を順に取得する。

    公式サイトへの間隔は collect-history.py と同じ 1.5 秒。
    連続 MAX_CONSECUTIVE_FAILURES 回失敗したら打ち切り、残りは未取得として返す。

    Returns:
        (レースごとの結果, 取得できたレース数)
    """
    session = open_session()
    collected: list[RaceBeforeInfo] = []
    consecutive_failures = 0
    fetched = 0

    for index, race_no in enumerate(races):
        if index:
            time.sleep(MIN_INTERVAL_SEC)

        race, ok = _fetch_one(target, race_no, session, log)
        collected.append(race)

        if ok:
            fetched += 1
            consecutive_failures = 0
            state = "公開済み" if race.available else "まだ"
            log(f"  {race_no}R: {state}")
        else:
            consecutive_failures += 1
            if consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
                log(f"  連続 {consecutive_failures} 回失敗したため打ち切ります")
                remaining = races[index + 1 :]
                collected.extend(
                    RaceBeforeInfo(race_no=n, available=False) for n in remaining
                )
                break

    return tuple(collected), fetched


def _collect_local(path_text: str, races: tuple[int, ...], log=print) -> tuple[RaceBeforeInfo, ...]:
    path = Path(path_text)
    if not path.is_file():
        raise SystemExit(f"ファイルが見つかりません: {path}")
    if len(races) != 1:
        raise SystemExit("--local-file は1レースぶんの HTML です。--races 1 のように1つ指定してください")
    log(f"  ローカルファイル: {path}")
    return (parse_beforeinfo(path.read_text(encoding="utf-8"), races[0]),)


def _load_previous(path: Path, log=print) -> dict | None:
    """前回の tenji.json。壊れていれば None（作り直す）。"""
    if not path.is_file():
        return None
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        log(f"  警告: 既存の {path.name} を読めません（{exc}）。作り直します")
        return None
    return loaded if isinstance(loaded, dict) else None


def main(argv: list[str] | None = None) -> int:
    _configure_stdout()
    args = build_parser().parse_args(argv)
    target = _parse_date(args.date)
    races = parse_races(args.races)
    out_path = Path(args.out) if args.out else APP_TENJI_PATH

    print(f"住之江 直前情報の取得  対象日 {target:%Y-%m-%d}  対象 {len(races)} レース")
    print()

    print("[1/3] 取得")
    if args.local_file:
        collected = _collect_local(args.local_file, races)
        fetched = len(collected)
    else:
        try:
            collected, fetched = collect(target, races)
        except BeforeInfoParseError as exc:
            print(f"エラー: {exc}", file=sys.stderr)
            return EXIT_ERROR

    available = sum(1 for race in collected if race.available)
    print(f"  取得できたレース: {fetched} / {len(races)}（うち公開済み {available}）")

    if fetched == 0:
        print()
        print(
            "1レースも取得できませんでした。既存のファイルはそのままにします。",
            file=sys.stderr,
        )
        return EXIT_NO_DATA

    print("[2/3] 変換")
    day = BeforeInfoDay(
        date=f"{target:%Y-%m-%d}",
        updated_at=datetime.now(JST).isoformat(timespec="seconds"),
        races=collected,
    )
    current = day_payload(day)

    if not args.emit_app_data:
        print("  --no-app-data のためファイルは書きません")
        _print_summary(current)
        return EXIT_OK

    if not out_path.parent.is_dir():
        print(f"エラー: {out_path.parent} がありません", file=sys.stderr)
        return EXIT_ERROR

    previous = _load_previous(out_path)
    merged = merge_with_previous(previous, current)
    kept = sum(
        1
        for race, source in zip(merged["races"], current["races"])
        if race is not source
    )
    if kept:
        print(f"  取り損ねた {kept} レースは前回の内容を残しました")

    if not args.force and is_same_content(previous, merged):
        print()
        print("前回と中身が同じです。書き換えません（デプロイ不要）。")
        return EXIT_UNCHANGED

    print("[3/3] 出力")
    payload = json.dumps(merged, ensure_ascii=False, separators=(",", ":"))
    out_path.write_text(payload, encoding="utf-8")
    print(f"  出力: {out_path}")

    if not args.out:
        APP_ARCHIVE_DIR.mkdir(exist_ok=True)
        archive_path = APP_ARCHIVE_DIR / f"tenji-{target:%Y%m%d}.json"
        archive_path.write_text(payload, encoding="utf-8")
        print(f"  出力: {archive_path}")

    print()
    _print_summary(merged)
    return EXIT_OK


def _print_summary(payload: dict) -> None:
    """公開済みレースの展示タイムを1行ずつ。表示の確認用。"""
    published = [race for race in payload["races"] if race["available"]]
    if not published:
        print("公開済みのレースはまだありません（周回展示の前です）。")
        return

    print(f"公開済み {len(published)} レース:")
    for race in published:
        times = " ".join(
            f"{entry['teiban']}:{entry['tenjiTime'] if entry['tenjiTime'] is not None else '—'}"
            for entry in race["entries"]
        )
        print(f"  {race['raceNo']:>2}R  {times}")
    print()
    print("展示タイムは水面の条件で変わります。速い＝勝つではありません。")


if __name__ == "__main__":
    raise SystemExit(main())
