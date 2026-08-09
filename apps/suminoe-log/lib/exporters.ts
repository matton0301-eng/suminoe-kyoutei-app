/**
 * 記録の書き出し（人が読むテキスト / CSV）。
 */

import { aggregate, formatRate, formatResult } from './aggregate';
import { formatBet } from './bets';
import { BASELINE_PERIOD } from './baseline';
import { formatDateSlash } from './raceDate';
import type { RaceLog } from './types';

function sortByRaceNo(logs: RaceLog[]): RaceLog[] {
  return [...logs].sort((a, b) => a.raceNo - b.raceNo || a.savedAt.localeCompare(b.savedAt));
}

/** 人が読める整形テキスト。そのままメモやSNSに貼れる形にする。 */
export function toPlainText(logs: RaceLog[], date: string): string {
  const lines: string[] = [`■ 住之江 ${formatDateSlash(date)} 観戦ログ`, ''];

  if (logs.length === 0) {
    lines.push('（記録なし）');
    return lines.join('\n');
  }

  for (const log of sortByRaceNo(logs)) {
    const parts = [
      `→ 結果:${formatResult(log)}`,
      `決まり手:${log.kimarite ?? '—'}`,
      `水面:${log.suimen ?? '—'}`,
    ];
    lines.push(`${log.raceNo}R  ${parts.join('  ')}`);

    const extras: string[] = [];
    if (log.memo.trim()) extras.push(`メモ:${log.memo.trim()}`);
    if (extras.length > 0) lines.push(`    ${extras.join(' / ')}`);
  }

  const stats = aggregate(logs);
  lines.push('', '【集計】');
  lines.push(
  );

  const course1 = stats.courses.find((course) => course.course === 1);
  if (course1) {
    lines.push(
      `1コース1着率 ${formatRate(course1.rate)}（基準${course1.baseline}%）` +
        `※母数 ${stats.resultCount}レース`,
    );
  }

  const kimarite = stats.kimarite
    .filter((entry) => entry.count > 0)
    .map((entry) => `${entry.kimarite}${entry.count}`)
    .join(' / ');
  lines.push(`決まり手 ${kimarite || '—'}`);

  if (stats.reading.ready) lines.push(`今日の水面 ${stats.reading.text}`);
  lines.push('', `基準値は住之江公式「水面特性」${BASELINE_PERIOD} 集計。`);

  return lines.join('\n');
}

const CSV_HEADER = [
  'race_no',
  'bets',
  'bet_yen',
  'ken',
  'result_first',
  'result_second',
  'result_third',
  'kimarite',
  'suimen',
  'memo',
  'saved_at',
] as const;

function escapeCsv(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function cell(value: string | number | null): string {
  if (value === null) return '';
  return escapeCsv(String(value));
}

export function toCsv(logs: RaceLog[]): string {
  const rows: string[] = [CSV_HEADER.join(',')];
  for (const log of sortByRaceNo(logs)) {
    rows.push(
      [
        cell(log.raceNo),
        cell(log.bets.map((bet) => formatBet(bet)).join(' / ')),
        cell(log.bets.reduce((sum, bet) => sum + bet.amountYen, 0) || null),
        cell(log.ken ? '見' : null),
        cell(log.resultFirst),
        cell(log.resultSecond),
        cell(log.resultThird),
        cell(log.kimarite),
        cell(log.suimen),
        cell(log.memo),
        cell(log.savedAt),
      ].join(','),
    );
  }
  return rows.join('\r\n');
}

export type CopyResult = 'copied' | 'failed';

/**
 * クリップボードへコピーする。
 *
 * Android の一部環境では `navigator.clipboard` が使えない。
 * 失敗した場合は呼び出し側で手動コピー用の textarea を出す。
 */
export async function copyToClipboard(text: string): Promise<CopyResult> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return 'copied';
    }
  } catch {
    // フォールバックへ
  }
  return 'failed';
}
