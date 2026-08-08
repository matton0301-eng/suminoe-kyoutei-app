/**
 * 蓄積済みデータの読み取り。
 *
 * 収支の計算は**アプリの lib をそのまま使う**（`tallyDay`）。
 * ここで別実装を持つと、アプリの表示と MCP の答えが食い違う。
 *
 * 日付は必ず `isSafeDate` を通してからファイル名に使う。
 * 外から来た文字列でパスを組み立てない（ディレクトリを遡られないため）。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { parseRaceCard, type RaceCard } from '../../../apps/suminoe-log/lib/raceCard';
import { parseResults, type ResultDay } from '../../../apps/suminoe-log/lib/results';
import { tallyDay, type DayTally } from '../../../apps/suminoe-log/lib/tally';
import { ARCHIVE_DIR, EXPORTED_LOGS_DIR, REVIEW_DIR } from './paths.js';

export interface DayFiles {
  date: string;
  hasCard: boolean;
  hasResults: boolean;
  hasReview: boolean;
}

/** "2026-08-08" の形だけを通す */
function isSafeDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

function compact(date: string): string {
  return date.replaceAll('-', '');
}

function readIfExists(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, 'utf-8') : null;
  } catch {
    return null;
  }
}

export function listDays(): DayFiles[] {
  const days = new Map<string, DayFiles>();

  const touch = (date: string): DayFiles => {
    const current = days.get(date) ?? { date, hasCard: false, hasResults: false, hasReview: false };
    days.set(date, current);
    return current;
  };

  let archiveNames: string[] = [];
  try {
    archiveNames = readdirSync(ARCHIVE_DIR);
  } catch {
    archiveNames = [];
  }
  for (const name of archiveNames) {
    const match = /^(racecard|results)-(\d{8})\.json$/.exec(name);
    if (!match) continue;
    const raw = match[2];
    const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    const entry = touch(date);
    if (match[1] === 'racecard') entry.hasCard = true;
    else entry.hasResults = true;
  }

  let reviewNames: string[] = [];
  try {
    reviewNames = readdirSync(REVIEW_DIR);
  } catch {
    reviewNames = [];
  }
  for (const name of reviewNames) {
    const match = /^review_(\d{8})\.md$/.exec(name);
    if (!match) continue;
    const raw = match[1];
    const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    touch(date).hasReview = true;
  }

  return [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export function readCard(date: string): RaceCard | null {
  if (!isSafeDate(date)) return null;
  const raw = readIfExists(join(ARCHIVE_DIR, `racecard-${compact(date)}.json`));
  return raw === null ? null : parseRaceCard(raw).card;
}

export function readResults(date: string): ResultDay | null {
  if (!isSafeDate(date)) return null;
  const raw = readIfExists(join(ARCHIVE_DIR, `results-${compact(date)}.json`));
  return raw === null ? null : parseResults(raw);
}

export function readReviewMarkdown(date: string): string | null {
  if (!isSafeDate(date)) return null;
  return readIfExists(join(REVIEW_DIR, `review_${compact(date)}.md`));
}

/** その日の収支。出走表か結果が欠けていれば null */
export function computeTally(date: string): DayTally | null {
  const card = readCard(date);
  const results = readResults(date);
  return card && results ? tallyDay(card, results) : null;
}

/** アプリの書き出しタブから保存した観戦記録（CSV）。置かれていなければ null */
export function readExportedLogs(date: string): string | null {
  if (!isSafeDate(date)) return null;
  return readIfExists(join(EXPORTED_LOGS_DIR, `suminoe-log-${compact(date)}.csv`));
}
