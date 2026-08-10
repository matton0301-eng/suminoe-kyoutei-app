"""開催予定の判定。収集スクリプト（collect.sh）から呼ぶ小道具。

    python schedule_status.py --stale schedule.json     # 取り直すべきなら終了コード0
    python schedule_status.py --check schedule.json 2026-08-13
        → "race" / "no-race:2026-08-13" / "unknown" を出力

**判定できないときは必ず "unknown" を返す。** 呼び出し側はそのとき収集を続ける。
予定が読めないことを理由に収集を止めると、開催日のオッズを丸ごと失う。
オッズは過去に遡って取得できないので、無駄に1回走るほうが安い。
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

JST = timezone(timedelta(hours=9))
#: 開催予定を取り直す間隔。日程はこの頻度では変わらない
MAX_AGE = timedelta(hours=24)


def _load(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 - 無い・壊れているは同じ扱いでよい
        return None


def is_stale(path: Path) -> bool:
    data = _load(path)
    if not data:
        return True
    raw = data.get("updatedAt")
    if not isinstance(raw, str):
        return True
    try:
        updated = datetime.fromisoformat(raw)
    except ValueError:
        return True
    if updated.tzinfo is None:
        updated = updated.replace(tzinfo=JST)
    return datetime.now(JST) - updated > MAX_AGE


def check(path: Path, target: str) -> str:
    data = _load(path)
    if not data:
        return "unknown"
    days = data.get("raceDays")
    if not isinstance(days, list) or not days:
        return "unknown"
    if target in days:
        return "race"
    upcoming = sorted(day for day in days if isinstance(day, str) and day >= target)
    return f"no-race:{upcoming[0] if upcoming else '未定'}"


def main(argv: list[str]) -> int:
    if len(argv) >= 3 and argv[1] == "--stale":
        return 0 if is_stale(Path(argv[2])) else 1
    if len(argv) >= 4 and argv[1] == "--check":
        print(check(Path(argv[2]), argv[3]))
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
