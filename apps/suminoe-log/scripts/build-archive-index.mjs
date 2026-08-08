/**
 * public/archive/ を走査して index.json を生成する（`next build` の前に実行）。
 *
 * どの日のデータがあるかの一覧。手書きすると必ずズレるので、
 * Service Worker の一覧（build-sw.mjs）と同じく実ファイルから生成する。
 *
 *   node scripts/build-archive-index.mjs
 */

import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ARCHIVE_DIR = join(HERE, '..', 'public', 'archive');
const INDEX_PATH = join(ARCHIVE_DIR, 'index.json');

mkdirSync(ARCHIVE_DIR, { recursive: true });

const days = new Map();
for (const name of readdirSync(ARCHIVE_DIR)) {
  const match = /^(racecard|results)-(\d{8})\.json$/.exec(name);
  if (!match) continue;
  const compact = match[2];
  const iso = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  const day = days.get(iso) ?? { date: iso, hasCard: false, hasResults: false };
  if (match[1] === 'racecard') day.hasCard = true;
  else day.hasResults = true;
  days.set(iso, day);
}

const sorted = [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
const payload = { schemaVersion: 1, days: sorted };
writeFileSync(INDEX_PATH, JSON.stringify(payload, null, 1), 'utf8');
console.log(`[build-archive-index] ${sorted.length} 日分を index.json に書き出しました`);
for (const day of sorted) {
  console.log(`  ${day.date} card=${day.hasCard} results=${day.hasResults}`);
}
