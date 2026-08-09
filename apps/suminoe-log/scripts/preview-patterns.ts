/**
 * 当日の全レースについて、堅実／勝負／穴の3パターンを一覧で確認する。
 *
 *   tools/suminoe-mcp/node_modules/.bin/tsx apps/suminoe-log/scripts/preview-patterns.ts
 *
 * 画面を開かずに「いま各レースがどう見えているか」を確かめるための道具。
 * アプリと同じ関数を通すので、ここで見える数字と画面の数字は一致する。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSuggestion } from '../lib/betting';
import { findRaceOdds, formatFetchedAt, parseOdds } from '../lib/odds';
import { buildPatterns, formatPatternTicket } from '../lib/patterns';
import { buildProbabilities, DEFAULT_TEMPERATURE } from '../lib/probability';
import { parseRaceCard } from '../lib/raceCard';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(HERE, '..', 'public');

function readTemperatures(): { temperature: number; placeTemperature: number } {
  try {
    const raw = JSON.parse(readFileSync(join(PUBLIC_DIR, 'calibration.json'), 'utf8')) as {
      temperature?: number;
      placeTemperature?: number;
    };
    const temperature = typeof raw.temperature === 'number' ? raw.temperature : DEFAULT_TEMPERATURE;
    return {
      temperature,
      placeTemperature:
        typeof raw.placeTemperature === 'number' ? raw.placeTemperature : temperature,
    };
  } catch {
    return { temperature: DEFAULT_TEMPERATURE, placeTemperature: DEFAULT_TEMPERATURE };
  }
}

const { card } = parseRaceCard(readFileSync(join(PUBLIC_DIR, 'racecard.json'), 'utf8'));
if (!card) {
  console.error('racecard.json を読めませんでした。');
  process.exit(1);
}

let oddsDay = null;
try {
  oddsDay = parseOdds(readFileSync(join(PUBLIC_DIR, 'odds.json'), 'utf8'));
} catch {
  console.log('odds.json がありません。確率だけで表示します。');
}

const { temperature, placeTemperature } = readTemperatures();
console.log(`${card.date} ${card.title}  （較正温度 1着 ${temperature} / 2-3着 ${placeTemperature}）`);
console.log();

let positive = 0;
let evaluated = 0;

for (const race of card.races) {
  const suggestion = buildSuggestion(race, {}, 0);
  if (!suggestion) {
    console.log(`${race.raceNo}R: 出走表を読めていません`);
    continue;
  }
  const probability = buildProbabilities(suggestion.scores, temperature, placeTemperature);
  const odds = findRaceOdds(oddsDay, race.raceNo, card.date);
  const patterns = buildPatterns(suggestion, probability, odds);

  const at = formatFetchedAt(odds?.fetchedAt ?? null);
  console.log(
    `${String(race.raceNo).padStart(2)}R ${race.verdict ?? '—'}  軸${suggestion.anchor}  ` +
      `締切${race.deadline}${at ? `  オッズ${at}時点` : '  オッズなし'}`,
  );

  for (const pattern of patterns) {
    if (pattern.points === 0) {
      console.log(`   ${pattern.label}: 該当なし`);
      continue;
    }
    const tickets = pattern.tickets
      .map((ticket) => formatPatternTicket(ticket, pattern.ordered))
      .join(' ');
    const ev = pattern.expectedValue;
    if (ev !== null) {
      evaluated += 1;
      if (ev >= 1) positive += 1;
    }
    console.log(
      `   ${pattern.label}: ${pattern.betTypeName} ${pattern.points}点  ` +
        `的中率${(pattern.hitProbability * 100).toFixed(1)}%  ` +
        `期待値${ev === null ? '—' : ev.toFixed(2)}  ${tickets}`,
    );
  }
  console.log();
}

console.log(
  `期待値を出せた ${evaluated} 通りのうち、1.00 以上は ${positive} 通り。` +
    '（1.00 未満は「モデル上は割に合わない」という意味）',
);
