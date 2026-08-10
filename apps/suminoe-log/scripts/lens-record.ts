/**
 * 視点ごとの的中実績を過去データで測る。
 *
 *   tools/suminoe-mcp/node_modules/.bin/tsx apps/suminoe-log/scripts/lens-record.ts
 *
 * **測れるのは3視点だけ。** セオリー・当地実績・モーターは番組表から作れるので
 * 62開催日ぶんを遡れる。展示と市場は過去データが無い
 * （展示は保存を始めたのが 8/8、オッズは 8/9 から）。
 *
 * **測れないものに数字を作らない。** 出せない視点は出せないと書き出し、
 * 画面でも「検証なし」と出す。
 *
 * 出力: apps/suminoe-log/public/lens-record.json
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildLenses, LENS_SPECS, type LensKey } from '../lib/lenses';
import { parseRaceCard } from '../lib/raceCard';
import type { Boat } from '../lib/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const READ_ROOT = join(HERE, '..', '..', '..', 'tools', 'suminoe-read', 'cache');
const CARDS_DIR = join(READ_ROOT, 'cards');
const HISTORY_DIR = join(READ_ROOT, 'history');
const OUT_PATH = join(HERE, '..', 'public', 'lens-record.json');

/** 過去データから作れる視点。展示と市場は遡れない */
const MEASURABLE: LensKey[] = ['theory', 'local', 'motor'];

interface Tally {
  races: number;
  first: number;
  top3: number;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** 競走成績から、そのレースの着順（1〜3着の艇番）を取り出す */
function ordersOf(history: unknown): Map<number, Boat[]> {
  const map = new Map<number, Boat[]>();
  const record = history as { races?: { raceNo?: number; order?: number[] }[] };
  for (const race of record.races ?? []) {
    if (typeof race.raceNo !== 'number' || !Array.isArray(race.order)) continue;
    const order = race.order.filter((n): n is Boat => Number.isInteger(n) && n >= 1 && n <= 6);
    if (order.length >= 3) map.set(race.raceNo, order);
  }
  return map;
}

function main(): void {
  const tallies = new Map<LensKey, Tally>(
    MEASURABLE.map((key) => [key, { races: 0, first: 0, top3: 0 }]),
  );
  let days = 0;
  let races = 0;

  const files = readdirSync(CARDS_DIR).filter((name) => /^\d{8}\.json$/.test(name));

  for (const name of files) {
    let orders: Map<number, Boat[]>;
    try {
      orders = ordersOf(readJson(join(HISTORY_DIR, name)));
    } catch {
      continue; // 成績が無い日は測れない
    }
    if (orders.size === 0) continue;

    const { card } = parseRaceCard(readFileSync(join(CARDS_DIR, name), 'utf8'));
    if (!card) continue;
    days += 1;

    for (const race of card.races) {
      const order = orders.get(race.raceNo);
      if (!order) continue;
      races += 1;

      // 展示とオッズは渡さない。過去には存在しないので、あるふりをしない
      const verdict = buildLenses(race, null, null);
      for (const pick of verdict.picks) {
        const tally = tallies.get(pick.key);
        if (!tally || pick.anchor === null) continue;
        tally.races += 1;
        if (order[0] === pick.anchor) tally.first += 1;
        if (order.slice(0, 3).includes(pick.anchor)) tally.top3 += 1;
      }
    }
  }

  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    days,
    races,
    lenses: LENS_SPECS.map((spec) => {
      const tally = tallies.get(spec.key);
      if (!tally || tally.races === 0) {
        return { key: spec.key, label: spec.label, measured: false as const };
      }
      return {
        key: spec.key,
        label: spec.label,
        measured: true as const,
        races: tally.races,
        firstRate: Number((tally.first / tally.races).toFixed(4)),
        top3Rate: Number((tally.top3 / tally.races).toFixed(4)),
      };
    }),
  };

  writeFileSync(OUT_PATH, JSON.stringify(payload), 'utf8');

  console.log(`${days}開催日 / ${races}レースで測定`);
  console.log('視点        母数    1着的中   3着以内');
  for (const lens of payload.lenses) {
    if (!lens.measured) {
      console.log(`${lens.label.padEnd(6)}  過去データなし（遡れない）`);
      continue;
    }
    console.log(
      `${lens.label.padEnd(6)}  ${String(lens.races).padStart(4)}  ` +
        `${(lens.firstRate * 100).toFixed(1).padStart(6)}%  ${(lens.top3Rate * 100).toFixed(1).padStart(6)}%`,
    );
  }
  console.log(`\n出力: ${OUT_PATH}`);
}

main();
