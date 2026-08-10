/**
 * 「いつ祝うか」のテスト。
 *
 * 着順の手入力を外したので、**結果が入った瞬間が祝うタイミング**になった。
 * 二度祝わないこと、外れたレースを繰り返し拾わないことが要。
 */

import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import type { Bet } from './bets';
import { findCelebration } from './celebration';
import type { ResultDay, ResultPayout } from './results';
import type { Boat, RaceLog } from './types';

const payout = (key: string, combo: number[], amount: number): ResultPayout => ({
  betType: '',
  key: key as ResultPayout['key'],
  combo: combo as Boat[],
  amount,
  popularity: null,
});

/** 2026-08-09 8R 着順 1-3-5。3連複 770円 / 3連単 1150円 */
const RESULTS = {
  date: '2026-08-09',
  races: [
    {
      raceNo: 8,
      ok: true,
      order: [1, 3, 5],
      payouts: [payout('trio', [1, 3, 5], 770), payout('trifecta', [1, 3, 5], 1150)],
    },
    { raceNo: 9, ok: false, order: [], payouts: [] },
  ],
} as unknown as ResultDay;

const bet = (betType: Bet['betType'], combo: number[], amountYen: number): Bet => ({
  betType,
  combo: combo as Boat[],
  amountYen,
});

const log = (raceNo: number, bets: Bet[]): RaceLog =>
  ({ id: `l${raceNo}`, raceNo, bets, ken: false, memo: '' }) as unknown as RaceLog;

describe('結果が入ったら祝う', () => {
  it('的中していれば買い目・倍率・払戻を返す', () => {
    const found = findCelebration(RESULTS, '2026-08-09', [log(8, [bet('trio', [1, 3, 5], 1000)])], new Set())!;
    assert.equal(found.raceNo, 8);
    assert.equal(found.hits.length, 1);
    assert.equal(found.returnedYen, 7700);
    assert.equal(found.multiples[0], 7.7);
  });

  it('倍率は金額によらない（演出の段が金額で変わらない）', () => {
    const small = findCelebration(RESULTS, '2026-08-09', [log(8, [bet('trio', [1, 3, 5], 100)])], new Set())!;
    const big = findCelebration(RESULTS, '2026-08-09', [log(8, [bet('trio', [1, 3, 5], 10000)])], new Set())!;
    assert.equal(small.multiples[0], big.multiples[0]);
    assert.notEqual(small.returnedYen, big.returnedYen);
  });

  it('複数点の的中をまとめて返す', () => {
    const found = findCelebration(
      RESULTS,
      '2026-08-09',
      [log(8, [bet('trio', [1, 3, 5], 1000), bet('trifecta', [1, 3, 5], 100)])],
      new Set(),
    )!;
    assert.equal(found.hits.length, 2);
    assert.equal(found.returnedYen, 7700 + 1150);
  });
});

describe('二度祝わない', () => {
  it('祝ったレースは返さない', () => {
    const logs = [log(8, [bet('trio', [1, 3, 5], 1000)])];
    assert.equal(findCelebration(RESULTS, '2026-08-09', logs, new Set(['2026-08-09-8'])), null);
  });

  it('外れたレースも「見終わった」として返す（毎回拾い続けない）', () => {
    const found = findCelebration(RESULTS, '2026-08-09', [log(8, [bet('trio', [2, 4, 6], 1000)])], new Set())!;
    assert.equal(found.raceNo, 8);
    assert.equal(found.hits.length, 0, '演出は出さないが、記録済みにするために返す');
  });

  it('若い番号から順に1レースずつ返す', () => {
    const logs = [log(8, [bet('trio', [1, 3, 5], 100)]), log(9, [bet('trio', [1, 2, 3], 100)])];
    assert.equal(findCelebration(RESULTS, '2026-08-09', logs, new Set())!.raceNo, 8);
  });
});

describe('祝わない場合', () => {
  it('結果がまだ出ていないレースは返さない', () => {
    assert.equal(findCelebration(RESULTS, '2026-08-09', [log(9, [bet('trio', [1, 2, 3], 100)])], new Set()), null);
  });

  it('買っていないレースは返さない', () => {
    assert.equal(findCelebration(RESULTS, '2026-08-09', [log(8, [])], new Set()), null);
  });

  it('日付が違う結果では祝わない（別の日の着順で祝わない）', () => {
    const logs = [log(8, [bet('trio', [1, 3, 5], 1000)])];
    assert.equal(findCelebration(RESULTS, '2026-08-10', logs, new Set()), null);
  });

  it('結果が無ければ null', () => {
    assert.equal(findCelebration(null, '2026-08-09', [log(8, [bet('trio', [1, 3, 5], 100)])], new Set()), null);
  });
});
