"""住之江のベースライン（ハードコード）。

出典: ボートレース住之江公式サイト「水面特性・進入コース別情報」
集計期間: 2026/5/1〜2026/7/31

住之江は枠なり進入がほぼ確定しているため（1枠→1コース 100.0%）、
本ツールでは **枠番 = 進入コース** として扱う。
"""

from __future__ import annotations

BASELINE_PERIOD = "2026/5/1〜7/31"

#: コース別1着率（％）
COURSE_FIRST_RATE: dict[int, float] = {
    1: 56.2,
    2: 15.2,
    3: 13.1,
    4: 10.7,
    5: 3.5,
    6: 1.8,
}

#: 1コースの決まり手内訳（％）
COURSE1_KIMARITE: dict[str, float] = {
    "逃げ": 95.8,
    "抜き": 3.8,
    "恵まれ": 0.3,
}

#: 枠なり進入率（％）
WAKUNARI_RATE: dict[int, float] = {
    1: 100.0,
    2: 94.1,
    3: 91.8,
    4: 87.2,
}

FOOTNOTE = (
    f"基準値（住之江公式「水面特性」{BASELINE_PERIOD}）: "
    f"1コース1着率 {COURSE_FIRST_RATE[1]}% / 1コース逃げ {COURSE1_KIMARITE['逃げ']}% / "
    f"枠なり進入 1枠 {WAKUNARI_RATE[1]}%・2枠 {WAKUNARI_RATE[2]}%"
)
