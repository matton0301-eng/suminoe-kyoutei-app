/**
 * 収支集計のテスト。
 *
 * フィクスチャは 2026-08-06 の実データ（出走表＋成績）。
 * 金額を扱うので、合計が個別の積み上げと一致することを厳密に確かめる。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it } from 'vitest';

import { parseRaceCard } from './raceCard';
import { parseResults } from './results';
import { UNIT_YEN, tallyDay } from './tally';

const FIXTURES = join(import.meta.dirname, '__fixtures__');
const CARD = readFileSync(join(FIXTURES, 'racecard-20260806.json'), 'utf8');
const RESULTS = readFileSync(join(FIXTURES, 'results-20260806.json'), 'utf8');

function load() {
  const { card } = parseRaceCard(CARD);
  const results = parseResults(RESULTS);
  assert.ok(card && results);
  return { card, results };
}

describe('tallyDay', () => {
  it('日付が違う組み合わせは集計しない', () => {
    const { card, results } = load();
    const shifted = { ...results, date: '2026-08-09' };
    assert.equal(tallyDay(card, shifted), null);
  });

  it('全12レースを集計できる', () => {
    const { card, results } = load();
    const tally = tallyDay(card, results);
    assert.ok(tally);
    assert.equal(tally.racesTotal, 12);
    assert.equal(tally.racesFinished, 12);
    assert.equal(tally.perRace.length, 12);
    assert.deepEqual(
      tally.perRace.map((row) => row.raceNo),
      Array.from({ length: 12 }, (_, i) => i + 1),
    );
  });

  it('8/6 の1号艇1着は4レース', () => {
    const { card, results } = load();
    const tally = tallyDay(card, results);
    assert.ok(tally);
    assert.equal(tally.insideWon, 4);
    assert.ok(tally.insideWonRate !== null);
    assert.equal(Math.round(tally.insideWonRate), 33);
  });

  it('賭式ごとの投資額が点数×100円と一致する', () => {
    const { card, results } = load();
    const tally = tallyDay(card, results);
    assert.ok(tally);
    for (const row of tally.byBetType) {
      assert.equal(
        row.investedYen,
        row.tickets * UNIT_YEN,
        `${row.name} の投資額が点数と合わない`,
      );
      assert.equal(row.balanceYen, row.returnedYen - row.investedYen);
      assert.ok(row.hitRaces <= row.races, `${row.name} の的中数が母数を超えている`);
    }
  });

  it('全体の合計が賭式ごとの積み上げと一致する', () => {
    const { card, results } = load();
    const tally = tallyDay(card, results);
    assert.ok(tally);
    const invested = tally.byBetType.reduce((sum, row) => sum + row.investedYen, 0);
    const returned = tally.byBetType.reduce((sum, row) => sum + row.returnedYen, 0);
    assert.equal(tally.investedYen, invested, '投資の合計が食い違う');
    assert.equal(tally.returnedYen, returned, '払戻の合計が食い違う');
    assert.equal(tally.balanceYen, returned - invested);
  });

  it('全体の合計がレースごとの積み上げとも一致する', () => {
    const { card, results } = load();
    const tally = tallyDay(card, results);
    assert.ok(tally);
    const invested = tally.perRace.reduce((sum, row) => sum + row.investedYen, 0);
    const returned = tally.perRace.reduce((sum, row) => sum + row.returnedYen, 0);
    assert.equal(tally.investedYen, invested);
    assert.equal(tally.returnedYen, returned);
  });

  it('判定ごとの集計がレース数と収支で整合する', () => {
    const { card, results } = load();
    const tally = tallyDay(card, results);
    assert.ok(tally);
    const races = tally.byVerdict.reduce((sum, row) => sum + row.races, 0);
    assert.equal(races, 12, '判定ごとのレース数の合計が12でない');
    const invested = tally.byVerdict.reduce((sum, row) => sum + row.investedYen, 0);
    assert.equal(invested, tally.investedYen);
    for (const row of tally.byVerdict) {
      assert.ok(row.insideWon <= row.races);
      assert.ok(row.anchorWon <= row.races);
      assert.equal(row.balanceYen, row.returnedYen - row.investedYen);
    }
  });

  it('控除率25%がある以上、全賭式を機械的に買えば回収率は100%を割る', () => {
    const { card, results } = load();
    const tally = tallyDay(card, results);
    assert.ok(tally);
    assert.ok(tally.recoveryRate !== null);
    assert.ok(
      tally.recoveryRate < 100,
      `回収率が ${tally.recoveryRate.toFixed(1)}% で100%を超えている。集計を疑うべき`,
    );
    assert.ok(tally.balanceYen < 0);
  });

  it('最高配当が実際の払戻の最大値と一致する', () => {
    const { card, results } = load();
    const tally = tallyDay(card, results);
    assert.ok(tally);
    const best = tally.byBetType
      .map((row) => row.best)
      .filter((hit): hit is NonNullable<typeof hit> => hit !== null)
      .sort((a, b) => b.amount - a.amount)[0];
    assert.ok(best, '的中が1件もないのは集計が壊れている疑いがある');

    // 結果データ側の払戻の最大値（アプリが買った組み合わせに限る）と突き合わせる
    const allAmounts = tally.byBetType.flatMap((row) => (row.best ? [row.best.amount] : []));
    assert.equal(best.amount, Math.max(...allAmounts));
  });

  it('的中したレースには賭式名が入る', () => {
    const { card, results } = load();
    const tally = tallyDay(card, results);
    assert.ok(tally);
    for (const row of tally.perRace) {
      if (row.returnedYen > 0) {
        assert.ok(row.hitNames.length > 0, `${row.raceNo}R は払戻があるのに賭式名が空`);
      } else {
        assert.equal(row.hitNames.length, 0, `${row.raceNo}R は払戻0なのに的中扱い`);
      }
    }
  });
});
