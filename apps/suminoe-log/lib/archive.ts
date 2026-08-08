/**
 * 過去日アーカイブ（/archive/）の取り込み。
 *
 * リードが日付付きの出走表・結果を書き出し、ビルド時に index.json が生成される。
 * ここはその読み取り側。外から来るデータなので境界で厳密に検証する。
 * 過去日の閲覧はオンライン前提（SW は /archive/ を precache しない）。
 */

import { parseRaceCard, type RaceCard } from './raceCard';
import { compactDate, isIsoDate } from './raceDate';
import { parseResults, type ResultDay } from './results';

const SUPPORTED_SCHEMA_VERSION = 1;

export interface ArchiveDay {
  date: string;
  hasCard: boolean;
  hasResults: boolean;
  /** 直前情報（展示タイム）が残っているか */
  hasTenji: boolean;
}

/** 日付リストの1行。アーカイブの有無と、その日の観戦記録の件数 */
export interface DayEntry extends ArchiveDay {
  logCount: number;
}

export const ARCHIVE_INDEX_URL = '/archive/index.json';

export function archiveCardUrl(iso: string): string {
  return `/archive/racecard-${compactDate(iso)}.json`;
}

export function archiveResultsUrl(iso: string): string {
  return `/archive/results-${compactDate(iso)}.json`;
}

export function parseArchiveIndex(raw: string): ArchiveDay[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) return [];
  const record = parsed as Record<string, unknown>;
  if (record.schemaVersion !== SUPPORTED_SCHEMA_VERSION) return [];
  if (!Array.isArray(record.days)) return [];

  const days: ArchiveDay[] = [];
  for (const rawDay of record.days) {
    if (typeof rawDay !== 'object' || rawDay === null) continue;
    const day = rawDay as Record<string, unknown>;
    if (typeof day.date !== 'string' || !isIsoDate(day.date)) continue;
    days.push({
      date: day.date,
      hasCard: day.hasCard === true,
      hasResults: day.hasResults === true,
      hasTenji: day.hasTenji === true,
    });
  }
  return days;
}

/** アーカイブの日付と「記録が端末に残っている日付」を統合し、新しい日付から並べる */
export function mergeDayEntries(
  archive: ArchiveDay[],
  logCounts: Record<string, number>,
): DayEntry[] {
  const byDate = new Map<string, DayEntry>();
  for (const day of archive) {
    byDate.set(day.date, { ...day, logCount: logCounts[day.date] ?? 0 });
  }
  for (const [date, count] of Object.entries(logCounts)) {
    if (!isIsoDate(date) || byDate.has(date)) continue;
    byDate.set(date, {
      date,
      hasCard: false,
      hasResults: false,
      hasTenji: false,
      logCount: count,
    });
  }
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export async function fetchArchiveIndex(): Promise<ArchiveDay[]> {
  try {
    const response = await fetch(ARCHIVE_INDEX_URL);
    if (!response.ok) return [];
    return parseArchiveIndex(await response.text());
  } catch {
    return [];
  }
}

/** 過去日の出走表と結果を取り込む。取れない・壊れているものは null */
export async function fetchArchiveDay(
  iso: string,
): Promise<{ card: RaceCard | null; results: ResultDay | null }> {
  const [card, results] = await Promise.all([
    (async () => {
      try {
        const response = await fetch(archiveCardUrl(iso));
        if (!response.ok) return null;
        return parseRaceCard(await response.text()).card;
      } catch {
        return null;
      }
    })(),
    (async () => {
      try {
        const response = await fetch(archiveResultsUrl(iso));
        if (!response.ok) return null;
        return parseResults(await response.text());
      } catch {
        return null;
      }
    })(),
  ]);
  return { card, results };
}
