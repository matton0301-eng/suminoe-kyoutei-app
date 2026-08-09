/**
 * 買った舟券と、その配当のテスト。
 *
 * **ここは金額を扱う唯一の場所。** 1円でも間違えたら記録の意味が無くなるので、
 * 実際の払戻データ（100円あたりの金額）との突き合わせを厚めに固定する。
 */

import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { UNIT_YEN } from './review';
import {
  betKey,
  investedYen,
  isSameCombo,
  settleRace,
  summarizeBets,
  type Bet,
} from './bets';
import type { ResultPayout, ResultRace } from './results';
import type { Boat } from './types';

function payout(betType: string, key: string, combo: number[], amount: number): ResultPayout {
  return {
    betType,
    key: key as ResultPayout['key'],
    combo: combo as Boat[],
    amount,
    popularity: null,
  };
}

/** 2026-08-08 1R の実データ。着順 1-4-6 */
const RACE: ResultRace = {
  raceNo: 1,
  name: '一般戦',
  ok: true,
  order: [1, 4, 6],
  kimarite: '逃げ',
  weather: '晴',
  windDir: '北',
  windM: 1,
  waveCm: 1,
  wakunari: true,
  verdict: null,
  anchor: null,
  anchorWon: null,
  notes: [],
  entries: [],
  payouts: [
    payout('３連単', 'trifecta', [1, 4, 6], 7400),
    payout('３連複', 'trio', [1, 4, 6], 1450),
    payout('２連単', 'exacta', [1, 4], 830),
    payout('２連複', 'quinella', [1, 4], 380),
    payout('拡連複', 'wide', [1, 4], 180),
    payout('拡連複', 'wide', [1, 6], 920),
    payout('単勝', 'win', [1], 380),
    payout('複勝', 'place', [1], 140),
  ],
};

const bet = (betType: Bet['betType'], combo: number[], amountYen = UNIT_YEN): Bet => ({
  betType,
  combo: combo as Boat[],
  amountYen,
});

describe('isSameCombo', () => {
  it('3連単は順番まで一致して初めて的中', () => {
    assert.equal(isSameCombo('trifecta', [1, 4, 6], [1, 4, 6]), true);
    assert.equal(isSameCombo('trifecta', [1, 6, 4], [1, 4, 6]), false);
  });

  it('3連複は順番を問わない', () => {
    assert.equal(isSameCombo('trio', [6, 1, 4], [1, 4, 6]), true);
    assert.equal(isSameCombo('trio', [1, 2, 3], [1, 4, 6]), false);
  });

  it('2連単は順番まで、2連複とワイドは順不同', () => {
    assert.equal(isSameCombo('exacta', [1, 4], [1, 4]), true);
    assert.equal(isSameCombo('exacta', [4, 1], [1, 4]), false);
    assert.equal(isSameCombo('quinella', [4, 1], [1, 4]), true);
    assert.equal(isSameCombo('wide', [6, 1], [1, 6]), true);
  });
});

describe('settleRace', () => {
  it('3連単が当たれば 100円あたりの払戻がそのまま返る', () => {
    const result = settleRace([bet('trifecta', [1, 4, 6])], RACE);
    assert.equal(result.investedYen, 100);
    assert.equal(result.returnedYen, 7400);
    assert.equal(result.balanceYen, 7300);
    assert.equal(result.hits.length, 1);
  });

  it('金額に比例して払戻が増える（500円なら5倍）', () => {
    const result = settleRace([bet('trifecta', [1, 4, 6], 500)], RACE);
    assert.equal(result.investedYen, 500);
    assert.equal(result.returnedYen, 7400 * 5);
    assert.equal(result.balanceYen, 37000 - 500);
  });

  it('外れは払戻ゼロ。投資だけが残る', () => {
    const result = settleRace([bet('trifecta', [2, 3, 4])], RACE);
    assert.equal(result.investedYen, 100);
    assert.equal(result.returnedYen, 0);
    assert.equal(result.balanceYen, -100);
    assert.deepEqual(result.hits, []);
  });

  it('複数点を買って1点だけ当たった場合', () => {
    const bets = [
      bet('trifecta', [1, 4, 6]),
      bet('trifecta', [1, 6, 4]),
      bet('trifecta', [1, 4, 2]),
    ];
    const result = settleRace(bets, RACE);
    assert.equal(result.investedYen, 300);
    assert.equal(result.returnedYen, 7400);
    assert.equal(result.balanceYen, 7100);
    assert.equal(result.hits.length, 1);
    assert.deepEqual(result.hits[0].combo, [1, 4, 6]);
  });

  it('賭式をまたいで合算する', () => {
    const bets = [bet('trifecta', [1, 4, 6]), bet('trio', [1, 4, 6]), bet('wide', [1, 6])];
    const result = settleRace(bets, RACE);
    assert.equal(result.investedYen, 300);
    assert.equal(result.returnedYen, 7400 + 1450 + 920);
  });

  it('ワイドは同じレースに3通りの払戻がある', () => {
    assert.equal(settleRace([bet('wide', [1, 4])], RACE).returnedYen, 180);
    assert.equal(settleRace([bet('wide', [1, 6])], RACE).returnedYen, 920);
    assert.equal(settleRace([bet('wide', [4, 6])], RACE).returnedYen, 0, '4=6 は払戻表に無い');
  });

  it('単勝・複勝も金額どおりに計算する', () => {
    const result = settleRace([bet('win', [1], 1000), bet('place', [1], 200)], RACE);
    assert.equal(result.investedYen, 1200);
    assert.equal(result.returnedYen, 380 * 10 + 140 * 2);
  });

  it('買っていなければ全部ゼロ', () => {
    const result = settleRace([], RACE);
    assert.equal(result.investedYen, 0);
    assert.equal(result.returnedYen, 0);
    assert.equal(result.balanceYen, 0);
  });

  it('結果がまだ出ていないレースは払戻を確定させない', () => {
    const pending: ResultRace = { ...RACE, ok: false, payouts: [] };
    const result = settleRace([bet('trifecta', [1, 4, 6])], pending);
    assert.equal(result.settled, false);
    assert.equal(result.investedYen, 100, '投資は確定している');
    assert.equal(result.returnedYen, 0);
  });

  it('端数の出ない整数で返す（円未満を作らない）', () => {
    const result = settleRace([bet('trio', [1, 4, 6], 300)], RACE);
    assert.equal(Number.isInteger(result.returnedYen), true);
    assert.equal(result.returnedYen, 1450 * 3);
  });
});

describe('investedYen', () => {
  it('買った点の合計', () => {
    assert.equal(investedYen([bet('trifecta', [1, 2, 3]), bet('trio', [1, 2, 3], 500)]), 600);
  });
});

describe('summarizeBets', () => {
  const logs = [
    { raceNo: 1, bets: [bet('trifecta', [1, 4, 6])], ken: false },
    { raceNo: 2, bets: [bet('trifecta', [2, 3, 4], 500)], ken: false },
    { raceNo: 3, bets: [], ken: true },
  ];

  it('レースごとの収支と1日の合計を出す', () => {
    const summary = summarizeBets(logs, [RACE, { ...RACE, raceNo: 2 }]);
    // 1R は的中（7400円）、2R は外れ（500円）、3R は見送り
    assert.equal(summary.investedYen, 600);
    assert.equal(summary.returnedYen, 7400);
    assert.equal(summary.balanceYen, 6800);
    assert.equal(summary.betRaces, 2);
    assert.equal(summary.kenRaces, 1);
    assert.equal(summary.hitRaces, 1);
  });

  it('回収率は 払戻 ÷ 投資', () => {
    const summary = summarizeBets(logs, [RACE, { ...RACE, raceNo: 2 }]);
    assert.ok(Math.abs(summary.recoveryRate! - (7400 / 600) * 100) < 1e-9);
  });

  it('1円も買っていなければ回収率は出さない（0除算を作らない）', () => {
    const summary = summarizeBets([{ raceNo: 1, bets: [], ken: true }], [RACE]);
    assert.equal(summary.recoveryRate, null);
    assert.equal(summary.kenRaces, 1);
  });
});

describe('別の日の結果を混ぜない', () => {
  it('レース番号が同じでも、渡された結果が無ければ確定させない', () => {
    // 呼び出し側が日付で絞る前提。ここでは「結果が渡されなければ未確定」を守る
    const summary = summarizeBets([{ raceNo: 1, bets: [bet('trifecta', [1, 4, 6])], ken: false }], []);
    assert.equal(summary.returnedYen, 0);
    assert.equal(summary.hitRaces, 0);
    assert.equal(summary.races[0].settled, false, '結果が無いレースは未確定');
    assert.equal(summary.investedYen, 100, '投資だけは確定している');
    assert.equal(summary.races[0].raceNo, 1, 'レース番号は記録側の値を使う');
    assert.equal(summary.pendingRaces, 1);
    assert.equal(summary.recoveryRate, null, '結果待ちだけなら回収率は出さない');
  });
});

describe('betKey', () => {
  it('同じ買い目は同じキーになる（重複を弾くため）', () => {
    assert.equal(betKey(bet('trio', [1, 4, 6])), betKey(bet('trio', [6, 4, 1])));
    assert.notEqual(betKey(bet('trifecta', [1, 4, 6])), betKey(bet('trifecta', [1, 6, 4])));
    assert.notEqual(betKey(bet('trio', [1, 4, 6])), betKey(bet('trifecta', [1, 4, 6])));
  });
});
