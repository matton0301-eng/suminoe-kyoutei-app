"""住之江の開催予定を公式の月間スケジュールから取得する CLI。

    python schedule.py                       # 今月＋来月
    python schedule.py --months 3            # 今月から3か月ぶん
    python schedule.py --local-file tests/fixtures/monthlyschedule_202608.html --ym 202608

**これが要る理由は2つ。**

1. 開催のない日にデータ収集を回さないため。住之江は月に12日ほどしか開催がない。
   非開催日に取りに行っても404が返るだけで、実行時間を捨てるだけになる
2. アプリに「次はいつ開催か」を出すため

出力:
    apps/suminoe-log/public/schedule.json

終了コード:
    0  書き出した
    1  エラー
    3  前回と中身が同じ（デプロイ不要）
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from suminoe.schedule_parser import (
    SUMINOE_JCD,
    ScheduleParseError,
    SchedulePendingError,
    Series,
    parse_month,
)

sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]

HERE = Path(__file__).resolve().parent
PUBLIC_DIR = HERE.parent.parent / "apps" / "suminoe-log" / "public"
OUT_PATH = PUBLIC_DIR / "schedule.json"

SCHEMA_VERSION = 1
URL = "https://www.boatrace.jp/owpc/pc/race/monthlyschedule?ym={ym}"
JST = timezone(timedelta(hours=9))

EXIT_UNCHANGED = 3


def _fetch(ym: str) -> str:
    import requests  # 遅延 import（--local-file だけなら不要）

    response = requests.get(
        URL.format(ym=ym),
        timeout=30,
        headers={"User-Agent": "suminoe-read/1.0 (personal use)"},
    )
    response.raise_for_status()
    response.encoding = response.apparent_encoding or "utf-8"
    return response.text


def _months_from(start: date, count: int) -> list[tuple[int, int]]:
    months: list[tuple[int, int]] = []
    year, month = start.year, start.month
    for _ in range(count):
        months.append((year, month))
        month += 1
        if month > 12:
            year, month = year + 1, 1
    return months


def _payload(all_series: list[Series], days: list[date]) -> dict:
    today = datetime.now(JST).date()
    upcoming = [day for day in days if day >= today]
    return {
        "schemaVersion": SCHEMA_VERSION,
        "venue": "住之江",
        "updatedAt": datetime.now(JST).isoformat(timespec="seconds"),
        "raceDays": [day.isoformat() for day in days],
        "nextRaceDay": upcoming[0].isoformat() if upcoming else None,
        "series": [
            {
                "name": entry.name,
                "grade": entry.grade,
                "start": entry.start.isoformat(),
                "end": entry.end.isoformat(),
                "days": (entry.end - entry.start).days + 1,
            }
            for entry in all_series
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--months", type=int, default=2, help="取得する月数（既定 2）")
    parser.add_argument("--local-file", help="HTML をファイルから読む（テスト用）")
    parser.add_argument("--ym", help="--local-file と併用する対象年月 (YYYYMM)")
    parser.add_argument("--jcd", type=int, default=SUMINOE_JCD)
    args = parser.parse_args()

    if args.local_file:
        if not args.ym:
            print("--local-file を使うときは --ym も指定してください", file=sys.stderr)
            return 1
        targets = [(int(args.ym[:4]), int(args.ym[4:6]))]
    else:
        targets = _months_from(datetime.now(JST).date(), args.months)

    all_series: list[Series] = []
    all_days: set[date] = set()

    for year, month in targets:
        ym = f"{year}{month:02d}"
        print(f"{year}年{month}月のスケジュールを読みます")
        try:
            html = (
                Path(args.local_file).read_text(encoding="utf-8")
                if args.local_file
                else _fetch(ym)
            )
            series = parse_month(html, year, month, jcd=args.jcd)
        except SchedulePendingError as exc:
            # 先の月が未公開なのは異常ではない。取れた月まで捨てない
            print(f"  {exc}")
            continue
        except ScheduleParseError as exc:
            # **黙って「開催なし」にしない。** 取れなかったことを明示して終わる
            print(f"  読み取れません: {exc}", file=sys.stderr)
            return 1
        except Exception as exc:  # noqa: BLE001 - 通信・文字コードなど種別は不定
            print(f"  取得に失敗: {exc}", file=sys.stderr)
            return 1

        for entry in series:
            if entry.start in {existing.start for existing in all_series}:
                continue  # 月をまたぐ節が両方の月に出てくるので重複を避ける
            all_series.append(entry)
            print(f"  {entry.start} 〜 {entry.end} ({entry.grade or '—'}) {entry.name}")
            all_days.update(entry.days)

    days = sorted(all_days)
    if not days:
        print("開催が1日も見つかりませんでした。書き出しません。", file=sys.stderr)
        return 1

    payload = _payload(sorted(all_series, key=lambda s: s.start), days)
    text = json.dumps(payload, ensure_ascii=False)

    if OUT_PATH.exists() and OUT_PATH.read_text(encoding="utf-8") == text:
        print("前回と中身が同じです。書き換えません。")
        return EXIT_UNCHANGED

    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(text, encoding="utf-8")
    print(f"\n出力: {OUT_PATH}（開催 {len(days)}日 / 次は {payload['nextRaceDay'] or 'なし'}）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
