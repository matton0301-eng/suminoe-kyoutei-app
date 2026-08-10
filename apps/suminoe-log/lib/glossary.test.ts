/**
 * 用語辞典のテスト。
 *
 * **素人に誤解させないこと**が目的なので、
 * 「増える」と読める書き方をしていないか、控除率の説明が抜けていないかを固定する。
 */

import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  BET_TYPE_GUIDE,
  describeRecovery,
  betTypeGuide,
  explain,
  GLOSSARY,
} from './glossary';

describe('賭式の案内', () => {
  it('7賭式すべてある', () => {
    assert.equal(BET_TYPE_GUIDE.length, 7);
  });

  it('当てやすい順に並んでいる', () => {
    const ease = BET_TYPE_GUIDE.map((entry) => entry.ease);
    assert.deepEqual(ease, [...ease].sort((a, b) => a - b));
  });

  it('通り数が実際と一致する', () => {
    const byKey = Object.fromEntries(BET_TYPE_GUIDE.map((e) => [e.key, e.combinations]));
    assert.deepEqual(byKey, {
      win: 6,
      place: 6,
      wide: 15,
      quinella: 15,
      trio: 20,
      exacta: 30,
      trifecta: 120,
    });
  });

  it('通りが多いほど後ろにある（当てにくい）', () => {
    const combos = BET_TYPE_GUIDE.map((entry) => entry.combinations);
    assert.deepEqual(combos, [...combos].sort((a, b) => a - b));
  });

  it('賭式を引ける', () => {
    assert.equal(betTypeGuide('trifecta')?.term, '3連単');
    assert.equal(betTypeGuide('unknown'), null);
  });
});

describe('用語辞典', () => {
  it('説明はすべて1行に収まる長さ', () => {
    for (const entry of GLOSSARY) {
      assert.ok(entry.short.length <= 50, `${entry.term} の説明が長すぎる: ${entry.short}`);
    }
  });

  it('引けない言葉には説明を作らない', () => {
    assert.equal(explain('存在しない用語'), null);
  });

  it('賭式も同じ辞書から引ける', () => {
    assert.equal(explain('3連単')?.term, '3連単');
  });
});

describe('お金の説明で誤解させない', () => {
  it('控除率の説明に「25%」と「減る」が入っている', () => {
    const entry = explain('控除率')!;
    const text = `${entry.short}${entry.more ?? ''}`;
    assert.match(text, /25%/);
    assert.match(text, /減る|75%/);
  });

  it('回収率の説明に実測（75%）が入っている', () => {
    const entry = explain('回収率')!;
    assert.match(`${entry.short}${entry.more ?? ''}`, /75%/);
  });

  it('期待値の説明に「保証ではない」旨が入っている', () => {
    const entry = explain('期待値')!;
    assert.match(`${entry.short}${entry.more ?? ''}`, /保証|前提/);
  });
});

describe('describeRecovery', () => {
  it('パーセントを金額に直す', () => {
    assert.equal(
      describeRecovery(170, 300),
      '300円ぶん買うと、平均で約510円戻る見立てです',
    );
  });

  it('100%未満なら減ることが金額で分かる', () => {
    assert.equal(
      describeRecovery(75, 10000),
      '10,000円ぶん買うと、平均で約7,500円戻る見立てです',
    );
  });
});
