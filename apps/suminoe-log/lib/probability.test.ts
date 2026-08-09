/**
 * 確率モデルのテスト。
 *
 * ここで確かめるのは「確率として破綻していないか」だけ。
 * 当たるかどうか（較正）は過去データで別に検証する（scripts/calibrate.ts）。
 */

import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import type { BoatScore } from './betting';
import {
  DEFAULT_TEMPERATURE,
  buildProbabilities,
  firstProbabilities,
  trifectaKey,
  trioKey,
} from './probability';
import { BOATS, type Boat } from './types';

/** 住之江の実データに近い並び（1号艇が頭一つ抜ける） */
const SCORES: BoatScore[] = [
  { teiban: 1, firstScore: 8.0, placeScore: 6.5 },
  { teiban: 2, firstScore: 6.2, placeScore: 5.6 },
  { teiban: 3, firstScore: 5.8, placeScore: 5.3 },
  { teiban: 4, firstScore: 5.5, placeScore: 5.1 },
  { teiban: 5, firstScore: 5.0, placeScore: 4.8 },
  { teiban: 6, firstScore: 4.2, placeScore: 4.3 },
];

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

describe('firstProbabilities', () => {
  it('合計が1になる', () => {
    const first = firstProbabilities(SCORES, DEFAULT_TEMPERATURE);
    assert.ok(Math.abs(sum(BOATS.map((b) => first[b])) - 1) < 1e-9);
  });

  it('スコアの順位と確率の順位が一致する', () => {
    const first = firstProbabilities(SCORES, DEFAULT_TEMPERATURE);
    const ordered = [...BOATS].sort((a, b) => first[b] - first[a]);
    assert.deepEqual(ordered, [1, 2, 3, 4, 5, 6]);
  });

  it('温度が低いほど1位に集中する', () => {
    const sharp = firstProbabilities(SCORES, 0.5);
    const flat = firstProbabilities(SCORES, 3);
    assert.ok(sharp[1] > flat[1]);
    assert.ok(flat[6] > sharp[6]);
  });

  it('スコアが同じなら等確率になる', () => {
    const flat: BoatScore[] = BOATS.map((teiban) => ({
      teiban,
      firstScore: 5,
      placeScore: 5,
    }));
    const first = firstProbabilities(flat, DEFAULT_TEMPERATURE);
    for (const boat of BOATS) {
      assert.ok(Math.abs(first[boat] - 1 / 6) < 1e-9, `${boat}号艇`);
    }
  });

  it('極端なスコア差でも数値が壊れない', () => {
    // exp のオーバーフローで NaN になっていないこと
    const extreme: BoatScore[] = BOATS.map((teiban) => ({
      teiban,
      firstScore: teiban === 1 ? 5000 : -5000,
      placeScore: 0,
    }));
    const first = firstProbabilities(extreme, DEFAULT_TEMPERATURE);
    assert.ok(Number.isFinite(first[1]));
    assert.ok(Math.abs(sum(BOATS.map((b) => first[b])) - 1) < 1e-9);
    assert.ok(first[1] > 0.99);
  });

  it('温度に0以下を渡しても壊れない', () => {
    const first = firstProbabilities(SCORES, 0);
    assert.ok(Math.abs(sum(BOATS.map((b) => first[b])) - 1) < 1e-9);
  });
});

describe('buildProbabilities', () => {
  const probability = buildProbabilities(SCORES, DEFAULT_TEMPERATURE);

  it('3連単は120通りで合計1', () => {
    assert.equal(probability.trifecta.size, 120);
    assert.ok(Math.abs(sum([...probability.trifecta.values()]) - 1) < 1e-9);
  });

  it('3連複は20通りで合計1', () => {
    assert.equal(probability.trio.size, 20);
    assert.ok(Math.abs(sum([...probability.trio.values()]) - 1) < 1e-9);
  });

  it('3連複は対応する3連単6通りの合計になる', () => {
    const orders: Boat[][] = [
      [1, 2, 3],
      [1, 3, 2],
      [2, 1, 3],
      [2, 3, 1],
      [3, 1, 2],
      [3, 2, 1],
    ];
    const expected = sum(orders.map((o) => probability.trifecta.get(trifectaKey(o))!));
    assert.ok(Math.abs(probability.trio.get(trioKey([1, 2, 3]))! - expected) < 1e-12);
  });

  it('評価が高い並びほど確率が高い', () => {
    const strong = probability.trifecta.get(trifectaKey([1, 2, 3]))!;
    const weak = probability.trifecta.get(trifectaKey([6, 5, 4]))!;
    assert.ok(strong > weak);
  });

  it('1着確率は3連単を集約したものと一致する', () => {
    // Harville で条件付き確率を掛けているので、周辺確率が保たれていること
    let total = 0;
    for (const [key, value] of probability.trifecta) {
      if (key.startsWith('1-')) total += value;
    }
    assert.ok(Math.abs(total - probability.first[1]) < 1e-9);
  });

  it('同じ艇が2回出る組み合わせを作らない', () => {
    for (const key of probability.trifecta.keys()) {
      const boats = key.split('-');
      assert.equal(new Set(boats).size, 3, key);
    }
  });
});

describe('キー', () => {
  it('3連単は順番どおり', () => {
    assert.equal(trifectaKey([3, 1, 2]), '3-1-2');
  });

  it('3連複は昇順に均す', () => {
    assert.equal(trioKey([3, 1, 2]), '1-2-3');
    assert.equal(trioKey([2, 3, 1]), '1-2-3');
  });
});
