/**
 * 舟券1枚の状態のテスト。
 *
 * **「結果待ち」と「ハズレ」を混ぜないこと**が最重要。
 * 買った直後に「ハズレ」と出ると、記録として嘘になる。
 */

import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import type { Bet } from './bets';
import type { ResultPayout, ResultRace } from './results';
import { bestGrade, hitGrade, ticketState } from './ticketState';
import type { Boat } from './types';

const payout = (key: string, combo: number[], amount: number): ResultPayout => ({
  betType: '',
  key: key as ResultPayout['key'],
  combo: combo as Boat[],
  amount,
  popularity: null,
});

/** 2026-08-09 8R。着順 1-3-5、3連複 770円 */
const RACE = {
  raceNo: 8,
  ok: true,
  order: [1, 3, 5],
  payouts: [payout('trio', [1, 3, 5], 770), payout('trifecta', [1, 3, 5], 1150)],
} as unknown as ResultRace;

const bet = (betType: Bet['betType'], combo: number[], amountYen: number): Bet => ({
  betType,
  combo: combo as Boat[],
  amountYen,
});

describe('結果待ちとハズレを混ぜない', () => {
  it('着順も払戻も無ければ「結果待ち」', () => {
    const state = ticketState(bet('trio', [1, 3, 5], 1000), [null, null, null], null, false);
    assert.equal(state.outcome, 'pending');
    assert.equal(state.returnedYen, null, '0円にしない');
  });

  it('着順を入れれば当たり外れは分かるが、金額はまだ分からない', () => {
    const hit = ticketState(bet('trio', [1, 3, 5], 1000), [1, 3, 5], null, true);
    assert.equal(hit.outcome, 'hit');
    assert.equal(hit.returnedYen, null, '払戻が来るまで金額を作らない');

    const miss = ticketState(bet('trio', [2, 3, 4], 1000), [1, 3, 5], null, false);
    assert.equal(miss.outcome, 'miss');
  });
});

describe('公式の払戻が来たら金額が確定する', () => {
  it('的中は払戻・収支・倍率が出る', () => {
    const state = ticketState(bet('trio', [1, 3, 5], 1000), [1, 3, 5], RACE, true);
    assert.equal(state.outcome, 'hit');
    assert.equal(state.returnedYen, 7700, '770円 × 1000円 ÷ 100');
    assert.equal(state.balanceYen, 6700);
    assert.equal(state.multiple, 7.7);
  });

  it('外れは払戻0で確定する', () => {
    const state = ticketState(bet('trio', [2, 4, 6], 1000), [1, 3, 5], RACE, false);
    assert.equal(state.outcome, 'miss');
    assert.equal(state.returnedYen, 0);
    assert.equal(state.balanceYen, -1000);
  });

  it('払戻が入力した着順より優先される（公式が最終）', () => {
    // 着順の入力を間違えていても、払戻表に無ければ外れ
    const state = ticketState(bet('trio', [2, 4, 6], 1000), [2, 4, 6], RACE, true);
    assert.equal(state.outcome, 'miss');
  });

  it('金額に比例する', () => {
    const small = ticketState(bet('trio', [1, 3, 5], 100), [1, 3, 5], RACE, true);
    const big = ticketState(bet('trio', [1, 3, 5], 10000), [1, 3, 5], RACE, true);
    assert.equal(small.returnedYen, 770);
    assert.equal(big.returnedYen, 77000);
    assert.equal(small.multiple, big.multiple, '倍率は金額によらない');
  });
});

describe('当たりの段', () => {
  it('倍率で段が上がる', () => {
    assert.equal(hitGrade(2).label, '的中');
    assert.equal(hitGrade(7.7).label, '好配当');
    assert.equal(hitGrade(30).label, '高配当');
    assert.equal(hitGrade(120).label, '万舟');
  });

  it('境界ちょうどで上がる', () => {
    assert.equal(hitGrade(5).tier, 2);
    assert.equal(hitGrade(4.9).tier, 1);
    assert.equal(hitGrade(100).tier, 4);
    assert.equal(hitGrade(99.9).tier, 3);
  });

  it('倍率が分からないうちは1段目（当たったことだけ祝う）', () => {
    assert.equal(hitGrade(null).tier, 1);
  });

  it('複数枚ならいちばん高い段で出す', () => {
    assert.equal(bestGrade([2, 130, 7]).label, '万舟');
    assert.equal(bestGrade([null, 2]).tier, 1);
  });
});
