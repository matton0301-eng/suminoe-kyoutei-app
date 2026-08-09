/**
 * 記録フォームの状態遷移のテスト。
 *
 * **主眼はレースを移るとき。** 2026-08-09 の現地で、3R で「見」を押してから
 * レース番号を送ると 4R も「見」になる不具合を踏んだ。原因は raceNo だけを
 * 差し替えて中身を持ち越していたこと。ここで固定しておく。
 */

import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import type { Bet } from './bets';
import { formHasContent, formReducer, nextRaceNo, toRaceLog } from './formReducer';
import { EMPTY_FORM, type Boat, type FormState, type RaceLog } from './types';

const bet = (combo: number[]): Bet => ({
  betType: 'trio',
  combo: combo as Boat[],
  amountYen: 100,
});

/** 3R を「見」にしたフォーム */
const kenAt3: FormState = { ...EMPTY_FORM, raceNo: 3, ken: true };

const logOf = (form: FormState, id: string): RaceLog => toRaceLog(form, id);

describe('selectRace（レースを移る）', () => {
  it('「見」を次のレースに持ち越さない', () => {
    const next = formReducer(kenAt3, { type: 'selectRace', raceNo: 4, log: null });
    assert.equal(next.raceNo, 4);
    assert.equal(next.ken, false, '4R は見送りにしていない');
  });

  it('着順・決まり手・水面・メモも持ち越さない', () => {
    const filled: FormState = {
      ...EMPTY_FORM,
      raceNo: 3,
      resultFirst: 1,
      resultSecond: 4,
      resultThird: 6,
      kimarite: '逃げ',
      suimen: '静か',
      memo: '1号艇が終始先頭',
    };
    const next = formReducer(filled, { type: 'selectRace', raceNo: 4, log: null });
    assert.deepEqual(
      {
        first: next.resultFirst,
        second: next.resultSecond,
        third: next.resultThird,
        kimarite: next.kimarite,
        suimen: next.suimen,
        memo: next.memo,
      },
      { first: null, second: null, third: null, kimarite: null, suimen: null, memo: '' },
    );
  });

  it('買った舟券も持ち越さない', () => {
    const bought: FormState = { ...EMPTY_FORM, raceNo: 3, bets: [bet([1, 3, 5])] };
    const next = formReducer(bought, { type: 'selectRace', raceNo: 4, log: null });
    assert.deepEqual(next.bets, []);
  });

  it('移った先に記録があれば読み込む', () => {
    const saved = logOf({ ...EMPTY_FORM, raceNo: 5, bets: [bet([1, 2, 4])], memo: '本命' }, 'x1');
    const next = formReducer(kenAt3, { type: 'selectRace', raceNo: 5, log: saved });
    assert.equal(next.raceNo, 5);
    assert.equal(next.ken, false);
    assert.deepEqual(next.bets, [bet([1, 2, 4])]);
    assert.equal(next.memo, '本命');
    assert.equal(next.editingId, 'x1', '既存記録を編集する状態になる');
  });

  it('移った先に記録が無ければ新規入力になる', () => {
    const next = formReducer(kenAt3, { type: 'selectRace', raceNo: 6, log: null });
    assert.equal(next.editingId, null);
  });

  it('1R より前、12R より後には行かない', () => {
    assert.equal(formReducer(EMPTY_FORM, { type: 'selectRace', raceNo: 0, log: null }).raceNo, 1);
    assert.equal(formReducer(EMPTY_FORM, { type: 'selectRace', raceNo: 13, log: null }).raceNo, 12);
  });

  it('元の state を書き換えない', () => {
    formReducer(kenAt3, { type: 'selectRace', raceNo: 4, log: null });
    assert.equal(kenAt3.ken, true);
    assert.equal(kenAt3.raceNo, 3);
  });
});

describe('formHasContent', () => {
  it('空のフォームは中身なし', () => {
    assert.equal(formHasContent(EMPTY_FORM), false);
  });

  it('レース番号を変えただけでは中身ありにしない', () => {
    assert.equal(formHasContent({ ...EMPTY_FORM, raceNo: 7 }), false);
  });

  it('見送り・舟券・着順・メモがあれば中身あり', () => {
    assert.equal(formHasContent({ ...EMPTY_FORM, ken: true }), true);
    assert.equal(formHasContent({ ...EMPTY_FORM, bets: [bet([1, 2, 3])] }), true);
    assert.equal(formHasContent({ ...EMPTY_FORM, resultFirst: 1 }), true);
    assert.equal(formHasContent({ ...EMPTY_FORM, kimarite: '差し' }), true);
    assert.equal(formHasContent({ ...EMPTY_FORM, suimen: '荒れてる' }), true);
    assert.equal(formHasContent({ ...EMPTY_FORM, memo: 'メモ' }), true);
  });

  it('空白だけのメモは中身なし', () => {
    assert.equal(formHasContent({ ...EMPTY_FORM, memo: '   ' }), false);
  });
});

describe('toggleKen', () => {
  it('見送りにすると買い目を捨てる（記録の意味が食い違うため）', () => {
    const bought: FormState = { ...EMPTY_FORM, bets: [bet([1, 2, 3])] };
    const next = formReducer(bought, { type: 'toggleKen' });
    assert.equal(next.ken, true);
    assert.deepEqual(next.bets, []);
  });

  it('舟券を足すと見送りは解除される', () => {
    const next = formReducer({ ...EMPTY_FORM, ken: true }, { type: 'addBets', bets: [bet([1, 2, 3])] });
    assert.equal(next.ken, false);
  });
});

describe('nextRaceNo', () => {
  it('12R の次は 12R で止まる', () => {
    assert.equal(nextRaceNo(11), 12);
    assert.equal(nextRaceNo(12), 12);
  });
});
