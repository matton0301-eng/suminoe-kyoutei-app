"""スミノエ・リード CLI エントリポイント。

使い方:
    python main.py                                  # 当日分
    python main.py --date 2026-08-09
    python main.py --date 2026-08-09 --format md,csv,chat
    python main.py --date 2026-08-06 --dry-run      # 動作確認
    python main.py --local-file .\\cache\\B260809.TXT --date 2026-08-09
"""

from __future__ import annotations

import argparse
import sys
from datetime import date, datetime
from pathlib import Path

from suminoe.analyzer import DEFAULT_MAX_BETS, analyze_program
from suminoe.enrich import enrich_program
from suminoe.extractor import ExtractError, extract_lzh
from suminoe.fetcher import FetchError, fetch_lzh, read_text
from suminoe.formatter import render_chat, render_csv, render_json, render_markdown
from suminoe.history import load_history, summarize
from suminoe.parser import ParseError, parse_program

ROOT = Path(__file__).resolve().parent
CACHE_DIR = ROOT / "cache"
OUTPUT_DIR = ROOT / "output"
HISTORY_DIR = CACHE_DIR / "history"

#: スミノエ・ログに同梱する出走表データの置き場所。
#: ここに書いておけば、アプリは起動時に自動で読み込む（貼り付け不要）。
APP_DATA_PATH = ROOT.parent.parent / "apps" / "suminoe-log" / "public" / "racecard.json"

#: 過去日を振り返れるよう、日付付きの控えも残す（アプリの /archive/ 配信用）
APP_ARCHIVE_DIR = APP_DATA_PATH.parent / "archive"

VALID_FORMATS = ("md", "csv", "chat", "json")


def _configure_stdout() -> None:
    """PowerShell で cp932 由来の UnicodeEncodeError が起きるため UTF-8 に切り替える。"""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
        except (AttributeError, ValueError):
            pass


def _parse_date(raw: str | None) -> date:
    if raw is None:
        return date.today()
    try:
        return datetime.strptime(raw, "%Y-%m-%d").date()
    except ValueError as exc:
        raise SystemExit(f"--date は YYYY-MM-DD 形式で指定してください: {raw!r}") from exc


def _parse_formats(raw: str) -> tuple[str, ...]:
    formats = tuple(f.strip().lower() for f in raw.split(",") if f.strip())
    invalid = [f for f in formats if f not in VALID_FORMATS]
    if invalid:
        raise SystemExit(
            f"--format に未知の値があります: {', '.join(invalid)}"
            f"（使えるのは {', '.join(VALID_FORMATS)}）"
        )
    return formats or ("md", "csv", "json")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="main.py",
        description=(
            "住之江の番組表を取得・分析し、レースごとの判断材料を出力します。"
            "勝つための予想ツールではありません。"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "注意: 番組表データの公開は当日早朝（5〜6時頃）です。\n"
            "翌日以降の日付を指定すると 404 になります（異常ではありません）。"
        ),
    )
    parser.add_argument("--date", help="対象日 (YYYY-MM-DD)。省略時は当日")
    parser.add_argument(
        "--format",
        default="md,csv,json",
        help=(
            f"出力形式をカンマ区切りで {VALID_FORMATS}（既定 md,csv,json）。"
            "json はスミノエ・ログの買い目タブへの取り込み用"
        ),
    )
    parser.add_argument(
        "--max-bets", type=int, default=DEFAULT_MAX_BETS, help="買い目の型の点数上限（既定6）"
    )
    parser.add_argument(
        "--local-file", help="手動で解凍した番組表TXTを直接読む（取得・解凍をスキップ）"
    )
    parser.add_argument("--no-cache", action="store_true", help="キャッシュを使わず再取得する")
    parser.add_argument(
        "--dry-run", action="store_true", help="動作確認用。出力ファイル名に _dryrun を付ける"
    )
    parser.add_argument(
        "--no-app-data",
        dest="emit_app_data",
        action="store_false",
        help="スミノエ・ログ同梱用の public/racecard.json を書き出さない",
    )
    parser.add_argument(
        "--no-history",
        dest="use_history",
        action="store_false",
        help="蓄積した過去成績を使わず、番組表の勝率だけで判定する",
    )
    return parser


def load_text(args: argparse.Namespace, target: date, log=print) -> str:
    """番組表テキストを取得する（ローカル指定 → キャッシュ → ダウンロード）。"""
    if args.local_file:
        path = Path(args.local_file)
        if not path.is_file():
            raise SystemExit(f"--local-file が見つかりません: {path}")
        log(f"[1/4] ローカルファイルを読み込み: {path}")
        return read_text(path, log=log)

    log(f"[1/4] 番組表を取得 ({target:%Y-%m-%d})")
    lzh = fetch_lzh(target, CACHE_DIR, use_cache=not args.no_cache, log=log)

    cached_txt = CACHE_DIR / f"B{target:%y%m%d}.TXT"
    if not args.no_cache and cached_txt.is_file():
        log(f"[2/4] 解凍済みキャッシュを使用: {cached_txt.name}")
        return read_text(cached_txt, log=log)

    log("[2/4] LZH を解凍")
    txt = extract_lzh(lzh, CACHE_DIR, log=log)
    return read_text(txt, log=log)


def main(argv: list[str] | None = None) -> int:
    _configure_stdout()
    args = build_parser().parse_args(argv)
    target = _parse_date(args.date)
    formats = _parse_formats(args.format)

    if args.max_bets < 1:
        raise SystemExit("--max-bets は1以上を指定してください")

    print(f"住之江 出走表アナライザ  対象日 {target:%Y-%m-%d}"
          f"{'  [dry-run]' if args.dry_run else ''}")
    print()

    try:
        text = load_text(args, target)
    except (FetchError, ExtractError) as exc:
        print()
        print(f"エラー: {exc}", file=sys.stderr)
        return 1

    print("[3/4] 番組表をパース")
    try:
        program = parse_program(text, f"{target:%Y-%m-%d}")
    except ParseError as exc:
        print(f"エラー: {exc}", file=sys.stderr)
        return 1

    ok_count = sum(1 for race in program.races if race.ok)
    print(f"  {program.place} {program.title} {program.day_label}")
    print(f"  {len(program.races)} レース検出（正常 {ok_count} / 失敗 {len(program.races) - ok_count}）")

    # --- 過去の住之江の成績を重ねる（母数のわかる実績で判定するため） ---
    history_notes: list[str] = []
    facts_by_race: dict = {}
    if args.use_history:
        history = load_history(HISTORY_DIR)
        if history.day_count:
            span = history.span
            print(
                f"  過去成績を反映: {history.day_count} 開催日 / {history.race_count} レース"
                + (f"（{span[0]} 〜 {span[1]}）" if span else "")
            )
            program, facts_by_race, history_notes = enrich_program(program, history)
            print(f"    実測を混ぜた艇: {len(history_notes)} / {len(program.races) * 6}")
        else:
            print("  過去成績の蓄積がないため、番組表の勝率だけで判定します")
            print("    （collect-history.py を実行すると母数のわかる実績が使えます）")

    print("[4/4] 分析と出力")
    analyses, motor_line = analyze_program(program, max_bets=args.max_bets)

    counts: dict[str, int] = {}
    for analysis in analyses:
        counts[analysis.verdict] = counts.get(analysis.verdict, 0) + 1
    print(f"  判定分布: " + " / ".join(f"{k} {v}" for k, v in counts.items()))
    if motor_line is not None:
        print(f"  モーター注目ライン: {motor_line:.1f}% 以上")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    suffix = "_dryrun" if args.dry_run else ""
    stem = f"suminoe_{target:%Y%m%d}{suffix}"

    if "md" in formats:
        path = OUTPUT_DIR / f"{stem}.md"
        path.write_text(
            render_markdown(program, analyses, motor_line, facts_by_race), encoding="utf-8"
        )
        print(f"  出力: {path}")

    if "csv" in formats:
        path = OUTPUT_DIR / f"{stem}.csv"
        # Excel で開くため UTF-8 BOM 付き
        path.write_text(render_csv(program, analyses), encoding="utf-8-sig")
        print(f"  出力: {path}")

    if "json" in formats:
        payload = render_json(program, analyses, motor_line)
        path = OUTPUT_DIR / f"{stem}.json"
        path.write_text(payload, encoding="utf-8")
        print(f"  出力: {path}")

        # アプリに同梱する（dry-run では本番データを差し替えない）
        if not args.dry_run and args.emit_app_data:
            if APP_DATA_PATH.parent.is_dir():
                APP_DATA_PATH.write_text(payload, encoding="utf-8")
                print(f"  出力: {APP_DATA_PATH}")
                APP_ARCHIVE_DIR.mkdir(exist_ok=True)
                archive_path = APP_ARCHIVE_DIR / f"racecard-{target:%Y%m%d}.json"
                archive_path.write_text(payload, encoding="utf-8")
                print(f"  出力: {archive_path}")
                print("    → この状態でアプリをデプロイすると、貼り付けなしで出走表が入ります")
            else:
                print(f"  警告: {APP_DATA_PATH.parent} が無いため、アプリ用データは書き出しませんでした")

    if "chat" in formats:
        print()
        print("----- ここから chat 貼り付け用 -----")
        print(render_chat(program, analyses, motor_line))
        print("----- ここまで -----")

    if program.warnings:
        print()
        print(f"⚠ 警告 {len(program.warnings)} 件:")
        for warning in program.warnings:
            print(f"  - {warning}")

    print()
    print("完了。出力は勝率を保証するものではありません。母数の小さい数値は断定的に扱わないでください。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
