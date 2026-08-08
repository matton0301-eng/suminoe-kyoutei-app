"""pytest 共通設定。

- `tools/suminoe-read/` をインポートパスに追加し、`python -m pytest` でも
  `from suminoe...` が解決できるようにする。
- 日本語のアサーションメッセージが Windows コンソールで文字化けしないよう UTF-8 にする。
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
    except (AttributeError, ValueError):
        pass
