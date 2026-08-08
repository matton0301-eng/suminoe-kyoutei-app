/**
 * 通算収支のためにアーカイブ全日分を読み込む。
 *
 * 「通算」を開いたときにだけ呼ぶ（起動時には呼ばない）。開催日が増えるほど
 * 取得件数も増えるので、当日の表示を待たせないための線引き。
 * 結果は呼び出し側（page.tsx）が保持するので、ここではキャッシュしない。
 *
 * 過去日データは Service Worker が precache しないため、オフラインでは取得できない。
 * その場合は null を返し、呼び出し側が案内を出す。
 */

import { fetchArchiveDay, fetchArchiveIndex } from './archive';
import { aggregateDays, type MultiTally } from './multiTally';
import { loadLogs } from './storage';
import { tallyDay } from './tally';

export async function loadMultiTally(): Promise<MultiTally | null> {
  const index = await fetchArchiveIndex();
  // 結果の無い日は収支を出せないので対象から外す
  const targets = index.filter((day) => day.hasCard && day.hasResults);
  if (targets.length === 0) return null;

  const inputs = await Promise.all(
    targets.map(async (day) => {
      const { card, results } = await fetchArchiveDay(day.date);
      const tally = card && results ? tallyDay(card, results) : null;
      return { date: day.date, tally, logs: loadLogs(day.date).logs };
    }),
  );

  const total = aggregateDays(inputs);
  return total.totalDays > 0 ? total : null;
}
