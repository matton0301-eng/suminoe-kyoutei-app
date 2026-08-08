"""事前の読みと実際の結果を照合する CLI。

    python review.py                     # 当日分
    python review.py --date 2026-08-07
    python review.py --date 2026-08-06 --local-result tests\\fixtures\\K260806.TXT

競走成績は**全レースが終わってから確定**する（住之江のナイターは21時頃）。
レース前の成績ファイルは中身が空のまま存在するため、取得側で弾いている。

出力:
    output/review_YYYYMMDD.md                     人が読む照合レポート
    apps/suminoe-log/public/results.json          アプリが読む結果データ
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime
from pathlib import Path

from suminoe.analyzer import analyze_program
from suminoe.enrich import enrich_program
from suminoe.extractor import ExtractError, extract_lzh
from suminoe.fetcher import KIND_PROGRAM, KIND_RESULT, FetchError, fetch_lzh, read_text
from suminoe.history import load_history
from suminoe.parser import ParseError, parse_program
from suminoe.result_parser import ResultParseError, parse_results
from suminoe.reviewer import render_review_markdown, review_day
from suminoe.result_models import BET_TYPE_TO_APP_KEY

ROOT = Path(__file__).resolve().parent
CACHE_DIR = ROOT / "cache"
HISTORY_DIR = CACHE_DIR / "history"
OUTPUT_DIR = ROOT / "output"
APP_RESULTS_PATH = ROOT.parent.parent / "apps" / "suminoe-log" / "public" / "results.json"

#: 過去日を振り返れるよう、日付付きの控えも残す（アプリの /archive/ 配信用）
APP_ARCHIVE_DIR = APP_RESULTS_PATH.parent / "archive"

RESULTS_SCHEMA_VERSION = 1


def _configure_stdout() -> None:
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


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="review.py",
        description=(
            "事前の判定と実際の着順を突き合わせ、その日の読みがどうだったかを記録します。"
            "1日ぶんの結果は母数がごく小さく、分析の実力を示すものではありません。"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "競走成績は全レース終了後に確定します（住之江のナイターは21時頃）。\n"
            "レース前に実行すると「まだ確定していません」で終了します。"
        ),
    )
    parser.add_argument("--date", help="対象日 (YYYY-MM-DD)。省略時は当日")
    parser.add_argument("--local-program", help="番組表TXTを直接読む（取得をスキップ）")
    parser.add_argument("--local-result", help="成績TXTを直接読む（取得をスキップ）")
    parser.add_argument("--no-cache", action="store_true", help="キャッシュを使わず再取得する")
    parser.add_argument(
        "--no-app-data",
        dest="emit_app_data",
        action="store_false",
        help="アプリ同梱用の public/results.json を書き出さない",
    )
    return parser


def _load(
    args: argparse.Namespace, target: date, kind: str, local: str | None, log=print
) -> str:
    """番組表または成績のテキストを読む。"""
    if local:
        path = Path(local)
        if not path.is_file():
            raise SystemExit(f"ファイルが見つかりません: {path}")
        log(f"  ローカルファイル: {path}")
        return read_text(path, log=log)

    lzh = fetch_lzh(target, CACHE_DIR, use_cache=not args.no_cache, kind=kind, log=log)
    cached_txt = CACHE_DIR / f"{kind}{target:%y%m%d}.TXT"
    if not args.no_cache and cached_txt.is_file():
        log(f"  解凍済みキャッシュを使用: {cached_txt.name}")
        return read_text(cached_txt, log=log)
    txt = extract_lzh(lzh, CACHE_DIR, log=log)
    return read_text(txt, log=log)


def _results_payload(review, results) -> str:
    """アプリが読む結果データ。買い目の照合はアプリ側で行うため、素の結果を渡す。"""
    by_race = {r.race_no: r for r in review.races}
    races = []
    for result in results.races:
        entry = by_race.get(result.race_no)
        races.append(
            {
                "raceNo": result.race_no,
                "name": result.name,
                "ok": result.ok,
                "order": list(result.order),
                "kimarite": result.kimarite,
                "weather": result.weather,
                "windDir": result.wind_dir,
                "windM": result.wind_m,
                "waveCm": result.wave_cm,
                "wakunari": result.wakunari,
                "verdict": entry.verdict if entry else None,
                "anchor": entry.anchor if entry else None,
                "anchorWon": entry.anchor_won if entry else None,
                "notes": list(entry.notes) if entry else [],
                "entries": [
                    {
                        "teiban": e.teiban,
                        "name": e.name,
                        "rankRaw": e.rank_raw,
                        "rank": e.rank,
                        "course": e.course,
                        "st": e.st,
                        "tenji": e.tenji,
                    }
                    for e in result.entries
                ],
                "payouts": [
                    {
                        "betType": p.bet_type,
                        "appKey": BET_TYPE_TO_APP_KEY.get(p.bet_type),
                        "combo": list(p.combo),
                        "amount": p.amount,
                        "popularity": p.popularity,
                    }
                    for p in result.payouts
                ],
            }
        )

    payload = {
        "schemaVersion": RESULTS_SCHEMA_VERSION,
        "date": results.date,
        "place": results.place,
        "title": results.title,
        "dayLabel": results.day_label,
        "courseRates": {str(k): round(v, 1) for k, v in review.course_rates.items()},
        "wakunariCount": list(review.wakunari_count),
        "races": races,
        "warnings": list(review.warnings),
    }
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def main(argv: list[str] | None = None) -> int:
    _configure_stdout()
    args = build_parser().parse_args(argv)
    target = _parse_date(args.date)

    print(f"住之江 事前の読みと結果の照合  対象日 {target:%Y-%m-%d}")
    print()

    # --- 番組表（事前の判定を再現するため） ---
    print("[1/4] 番組表を読み込み")
    try:
        program_text = _load(args, target, KIND_PROGRAM, args.local_program)
        program = parse_program(program_text, f"{target:%Y-%m-%d}")
    except (FetchError, ExtractError) as exc:
        print(f"エラー: {exc}", file=sys.stderr)
        return 1
    except ParseError as exc:
        print(f"エラー: 番組表をパースできません: {exc}", file=sys.stderr)
        return 1
    # main.py と同じ前処理（過去成績の実測を混ぜる）を通さないと事前の判定を再現できない。
    # enrich の有無で判定が変わった実例: 2026-08-08 9R が 勝負→標準 にずれた
    history = load_history(HISTORY_DIR)
    if history.day_count:
        program, _, _ = enrich_program(program, history)
        print(f"  過去成績を反映: {history.day_count} 開催日 / {history.race_count} レース")
    analyses, _ = analyze_program(program)
    print(f"  {len(program.races)} レースの事前判定を再現しました")

    # --- 競走成績 ---
    print("[2/4] 競走成績を読み込み")
    try:
        result_text = _load(args, target, KIND_RESULT, args.local_result)
        results = parse_results(result_text, f"{target:%Y-%m-%d}")
    except (FetchError, ExtractError) as exc:
        print()
        print(f"エラー: {exc}", file=sys.stderr)
        return 3
    except ResultParseError as exc:
        print(f"エラー: 成績をパースできません: {exc}", file=sys.stderr)
        return 1
    print(f"  {len(results.races)} レースの結果を読み込みました")

    # --- 照合 ---
    print("[3/4] 照合")
    review = review_day(program, analyses, results)
    print(f"  照合できたレース: {review.total}")
    print(
        f"  1号艇が1着: {review.inside_won_total} / {review.total} "
        f"（{review.inside_won_total / review.total * 100:.1f}%）"
    )
    for summary in review.by_verdict:
        rate = summary.inside_rate or 0
        print(
            f"    {summary.verdict}: {summary.total}レース中 1号艇1着 {summary.inside_won} "
            f"({rate:.0f}%) / 軸が1着 {summary.anchor_won}"
        )
    won, judged = review.wakunari_count
    if judged:
        print(f"  枠なり進入: {won} / {judged}")

    # --- 出力 ---
    print("[4/4] 出力")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    md_path = OUTPUT_DIR / f"review_{target:%Y%m%d}.md"
    md_path.write_text(render_review_markdown(review), encoding="utf-8")
    print(f"  出力: {md_path}")

    if args.emit_app_data:
        if APP_RESULTS_PATH.parent.is_dir():
            payload = _results_payload(review, results)
            APP_RESULTS_PATH.write_text(payload, encoding="utf-8")
            print(f"  出力: {APP_RESULTS_PATH}")
            APP_ARCHIVE_DIR.mkdir(exist_ok=True)
            archive_path = APP_ARCHIVE_DIR / f"results-{target:%Y%m%d}.json"
            archive_path.write_text(payload, encoding="utf-8")
            print(f"  出力: {archive_path}")
            print("    → デプロイするとアプリの買い目タブに結果が並びます")
        else:
            print(f"  警告: {APP_RESULTS_PATH.parent} が無いため、アプリ用データは書き出しませんでした")

    if review.warnings:
        print()
        print(f"⚠ 警告 {len(review.warnings)} 件:")
        for warning in review.warnings:
            print(f"  - {warning}")

    print()
    print(
        "1日ぶんの結果は母数がごく小さく、分析の実力を示すものではありません。"
        "当たっても外れても、それだけで判断を変えないでください。"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
