/**
 * 住之江のベースライン（ハードコード）。
 *
 * 出典: ボートレース住之江公式サイト「水面特性・進入コース別情報」
 * 集計期間: 2026/5/1〜2026/7/31
 *
 * 住之江は進入がほぼ枠なり（1枠→1コース 100.0%、2枠→2コース 94.1%）のため、
 * 本アプリでは **枠番 = 進入コース** として扱い、コース入力は設けない。
 */

import type { Boat } from './types';

export const BASELINE_PERIOD = '2026/5/1〜7/31';

/** コース別1着率（％） */
export const COURSE_FIRST_RATE: Record<Boat, number> = {
  1: 56.2,
  2: 15.2,
  3: 13.1,
  4: 10.7,
  5: 3.5,
  6: 1.8,
};

/** 1コースの決まり手内訳（％） */
export const COURSE1_KIMARITE = {
  逃げ: 95.8,
  抜き: 3.8,
  恵まれ: 0.3,
} as const;

/** この差を超えたら差分を強調表示する（ポイント） */
export const EMPHASIS_DIFF_PT = 10;

/** 傾向判定を出すのに必要な最小記録数。これ未満では断定しない。 */
export const MIN_LOGS_FOR_READING = 3;

// 保存キーと日付の扱いは lib/raceDate.ts。
// このアプリは特定の1日の専用ではなく、開催日ごとに中身が入れ替わる。

