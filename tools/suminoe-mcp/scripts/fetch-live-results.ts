/**
 * 終わったレースの結果を、その日のうちに取り込む。
 *
 *   tools/suminoe-mcp/node_modules/.bin/tsx tools/suminoe-mcp/scripts/fetch-live-results.ts [--date 2026-08-09]
 *
 * **競走成績のファイル（K）は全レース終了後にしか出ない。**
 * それだと1Rの結果が分かるのが夜になり、現地では自分が当たったかどうかも分からない。
 * レース結果ページは1レース終わるたびに更新されるので、15分おきの収集で拾える。
 *
 * これがあるおかげで、記録タブでの着順・決まり手・水面の手入力が要らなくなった。
 *
 * **夜の照合（review）が作った results.json を壊さない。**
 * あちらは事前の読みとの突き合わせ（verdict / anchor / notes）を持っているので、
 * 同じレースが既に入っていれば触らない。
 *
 * 出力: apps/suminoe-log/public/results.json
 *       apps/suminoe-log/public/archive/results-YYYYMMDD.json
 *
 * 終了コード:
 *   0  書き出した
 *   1  エラー
 *   3  新しく取れた結果が無い（デプロイ不要）
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseRaceResult, raceResultUrl, type LiveResult } from '../lib/raceresult.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(HERE, '..', '..', '..', 'apps', 'suminoe-log', 'public');
const OUT_PATH = join(PUBLIC_DIR, 'results.json');
const ARCHIVE_DIR = join(PUBLIC_DIR, 'archive');

const RACES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const MIN_INTERVAL_MS = 1_500;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const EXIT_NOTHING_NEW = 3;

interface StoredRace {
  raceNo: number;
  ok?: boolean;
  [key: string]: unknown;
}

function jstNow(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.toISOString().slice(0, 19)}+09:00`;
}

function jstToday(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** アプリが読む形（ResultRace）に合わせる。事前の読みは持っていないので null で埋める */
function toStored(result: LiveResult): StoredRace {
  return {
    raceNo: result.raceNo,
    name: '',
    ok: true,
    order: result.order,
    kimarite: result.kimarite,
    weather: result.weather,
    windDir: result.windDir,
    windM: result.windM,
    waveCm: result.waveCm,
    wakunari: null,
    verdict: null,
    anchor: null,
    anchorWon: null,
    notes: [],
    entries: [],
    payouts: result.payouts,
  };
}

async function main(): Promise<void> {
  const index = process.argv.indexOf('--date');
  const date = index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : jstToday();

  console.log(`住之江 レース結果を取得  対象日 ${date}`);

  // 既存を読む。日付が違えば作り直す（前日の結果を混ぜない）
  let existing: StoredRace[] = [];
  if (existsSync(OUT_PATH)) {
    try {
      const raw = JSON.parse(readFileSync(OUT_PATH, 'utf8')) as {
        date?: string;
        races?: StoredRace[];
      };
      if (raw.date === date && Array.isArray(raw.races)) existing = raw.races;
    } catch {
      /* 壊れていれば作り直す */
    }
  }

  const byRace = new Map(existing.map((race) => [race.raceNo, race]));
  let added = 0;

  for (const raceNo of RACES) {
    // **既に結果が入っているレースは触らない。**
    // 夜の照合が事前の読みとの突き合わせを載せているので、上書きすると失われる
    if (byRace.get(raceNo)?.ok === true) continue;

    await sleep(MIN_INTERVAL_MS);
    try {
      const response = await fetch(raceResultUrl(date, raceNo), {
        headers: { 'User-Agent': USER_AGENT },
      });
      if (!response.ok) continue;
      const parsed = parseRaceResult(await response.text(), raceNo);
      if (!parsed.ok) {
        console.log(`  ${raceNo}R: まだ`);
        continue;
      }
      byRace.set(raceNo, toStored(parsed));
      added += 1;
      const trio = parsed.payouts.find((entry) => entry.key === 'trio');
      console.log(
        `  ${raceNo}R: ${parsed.order.join('-')} ${parsed.kimarite}` +
          `${trio ? ` / 3連複 ${trio.amount.toLocaleString('ja-JP')}円` : ''}`,
      );
    } catch (error) {
      console.log(`  ${raceNo}R: 取得できません（${String(error)}）`);
    }
  }

  if (added === 0) {
    console.log('新しく取れた結果はありません。書き換えません。');
    process.exit(EXIT_NOTHING_NEW);
  }

  const races = [...byRace.values()].sort((a, b) => a.raceNo - b.raceNo);
  const payload = { schemaVersion: 1, date, updatedAt: jstNow(), races };
  const text = JSON.stringify(payload);

  writeFileSync(OUT_PATH, text, 'utf8');
  mkdirSync(ARCHIVE_DIR, { recursive: true });
  writeFileSync(join(ARCHIVE_DIR, `results-${date.replaceAll('-', '')}.json`), text, 'utf8');

  console.log(`\n${added}レース分を新しく取り込みました（合計 ${races.length} / 12）`);
}

void main();
