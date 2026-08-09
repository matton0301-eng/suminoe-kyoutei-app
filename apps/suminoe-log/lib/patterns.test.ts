/**
 * 買い目パターン（堅実／勝負／穴）のテスト。
 *
 * 期待値はモデル確率とオッズの積で決まる。**モデルが正しい保証はない**ので、
 * ここで確かめるのは「計算が正しいか」と「オッズが無いときに数字を作らないか」。
 */

import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import type { BetSuggestion } from './betting';
import type { RaceOddsData } from './odds';
import { buildPatterns } from './patterns';
import { buildProbabilities } from './probability';
import type { BoatScore } from './betting';
import type { Boat } from './types';

const SCORES: BoatScore[] = [
  { teiban: 1, firstScore: 8.0, placeScore: 6.5 },
  { teiban: 2, firstScore: 6.2, placeScore: 5.6 },
  { teiban: 3, firstScore: 5.8, placeScore: 5.3 },
  { teiban: 4, firstScore: 5.5, placeScore: 5.1 },
  { teiban: 5, firstScore: 5.0, placeScore: 4.8 },
  { teiban: 6, firstScore: 4.2, placeScore: 4.3 },
];

const PROBABILITY = buildProbabilities(SCORES, 2);

const SUGGESTION = {
  anchor: 1 as Boat,
  partners: [2, 3, 4, 5, 6] as Boat[],
  scores: SCORES,
  plans: [],
  actualWeight: 0,
  anchorNote: null,
  tenjiFast: null,
} as unknown as BetSuggestion;

/** 市場の取り分（控除率25%） */
const TAKE_OUT = 0.75;

/**
 * 市場がモデルとまったく同じ見立てをしている状態のオッズ。
 *
 * このとき全点の期待値は 0.75（＝控除率ぶんだけ負ける）で、モデルと市場の
 * 乖離はゼロ。一律オッズだと「市場が全120通りを等確率と見ている」という
 * ありえない設定になり、乖離の上限にかかってしまう。
 */
function fairOdds(scale = 1): RaceOddsData {
  const trifecta = new Map<string, number>();
  for (const [key, p] of PROBABILITY.trifecta) trifecta.set(key, (TAKE_OUT / p) * scale);
  const trio = new Map<string, number>();
  for (const [key, p] of PROBABILITY.trio) trio.set(key, (TAKE_OUT / p) * scale);
  return { raceNo: 1, fetchedAt: '2026-08-09T15:05:00+09:00', trifecta, trio };
}

const patternsOf = (odds: RaceOddsData | null) => {
  const list = buildPatterns(SUGGESTION, PROBABILITY, odds);
  return {
    all: list,
    steady: list.find((p) => p.key === 'steady')!,
    challenge: list.find((p) => p.key === 'challenge')!,
    longshot: list.find((p) => p.key === 'longshot'),
  };
};

describe('堅実', () => {
  it('3連複の確率上位3点を出す', () => {
    const { steady } = patternsOf(fairOdds());
    assert.equal(steady.betTypeName, '3連複');
    assert.equal(steady.points, 3);
    // 確率降順に並んでいる
    const probabilities = steady.tickets.map((t) => t.probability);
    assert.deepEqual(probabilities, [...probabilities].sort((a, b) => b - a));
  });

  it('的中率は選んだ点の確率合計になる', () => {
    const { steady } = patternsOf(fairOdds());
    const sum = steady.tickets.reduce((total, t) => total + t.probability, 0);
    assert.ok(Math.abs(steady.hitProbability - sum) < 1e-12);
  });

  it('市場と見立てが同じなら、期待値は控除率ぶん（0.75）になる', () => {
    const { steady } = patternsOf(fairOdds());
    assert.ok(Math.abs(steady.expectedValue! - 0.75) < 1e-9);
  });

  it('期待値は Σ(確率×オッズ)÷点数 で計算する', () => {
    const odds = fairOdds();
    const { steady } = patternsOf(odds);
    const manual =
      steady.tickets.reduce((sum, t) => sum + t.probability * (t.odds ?? 0), 0) / steady.points;
    assert.ok(Math.abs(steady.expectedValue! - manual) < 1e-9);
  });
});

describe('勝負', () => {
  it('3連単で軸を1着に固定する', () => {
    const { challenge } = patternsOf(fairOdds());
    assert.equal(challenge.betTypeName, '3連単');
    assert.ok(challenge.tickets.length > 0);
    for (const ticket of challenge.tickets) {
      assert.equal(ticket.boats[0], 1, '1着はすべて軸');
    }
  });

  it('期待値の高い順に並ぶ', () => {
    // 1-2-3 だけオッズを2倍にすると、そこだけ妙味が出て先頭に来る
    const odds = fairOdds();
    odds.trifecta.set('1-2-3', odds.trifecta.get('1-2-3')! * 2);
    const { challenge } = patternsOf(odds);
    assert.deepEqual(challenge.tickets[0].boats, [1, 2, 3]);
  });

  it('市場と食い違いすぎる買い目は選ばない', () => {
    // モデルが市場の10倍強気な組み合わせ（＝オッズが10倍高い）は拾わない。
    // 市場は数千万円の投票の集約で、こちらは63開催日のモデル
    const odds = fairOdds();
    odds.trifecta.set('1-2-3', odds.trifecta.get('1-2-3')! * 10);
    const { challenge } = patternsOf(odds);
    assert.ok(!challenge.tickets.some((t) => t.boats.join('-') === '1-2-3'));
  });

  it('オッズが無い組み合わせは選ばない', () => {
    const odds = fairOdds();
    // 軸1着の20通りのうち、2点だけ残して消す
    for (const key of [...odds.trifecta.keys()]) {
      if (key.startsWith('1-') && key !== '1-2-3' && key !== '1-3-2') {
        odds.trifecta.delete(key);
      }
    }
    const { challenge } = patternsOf(odds);
    assert.equal(challenge.points, 2);
    for (const ticket of challenge.tickets) {
      assert.ok(ticket.odds !== null);
    }
  });
});

describe('穴', () => {
  it('高オッズかつ期待値1.0以上のものだけを拾う', () => {
    const odds = fairOdds();
    // 低確率の組み合わせに、乖離の上限内（2倍）で妙味を付ける
    const key = [...PROBABILITY.trifecta.entries()]
      .filter(([, p]) => 0.75 / p >= 60)
      .sort((a, b) => b[1] - a[1])[0][0];
    odds.trifecta.set(key, odds.trifecta.get(key)! * 2);
    const { longshot } = patternsOf(odds);
    assert.ok(longshot);
    assert.ok(longshot.tickets.length > 0);
    for (const ticket of longshot.tickets) {
      assert.ok(ticket.odds !== null && ticket.odds >= 50, '50倍以上');
      assert.ok(ticket.probability * ticket.odds >= 1, '1点あたり期待値1.0以上');
    }
  });

  it('該当が無ければ買い目を作らない', () => {
    // 市場と同じ見立てなら、どの点も期待値0.75で「割に合う」にはならない
    const { longshot } = patternsOf(fairOdds());
    assert.ok(longshot);
    assert.equal(longshot.points, 0);
    assert.match(longshot.reason, /該当なし|ありません/);
  });
});

describe('オッズが無いとき', () => {
  it('期待値を出さず、確率だけを出す', () => {
    const { all, steady, challenge } = patternsOf(null);
    for (const pattern of all) {
      assert.equal(pattern.expectedValue, null, `${pattern.label} の期待値`);
      assert.equal(pattern.oddsRange, null);
    }
    // 買い目自体は確率で組める
    assert.equal(steady.points, 3);
    assert.ok(challenge.points > 0);
    assert.ok(steady.hitProbability > 0);
  });

  it('穴はオッズが無ければ提示しない', () => {
    const { longshot } = patternsOf(null);
    assert.ok(longshot);
    assert.equal(longshot.points, 0);
    assert.match(longshot.caution ?? '', /オッズ/);
  });
});

describe('期待値が低いとき', () => {
  it('低いままの数字を出し、注意を添える', () => {
    // オッズが全体に半分なら、期待値は 0.375 まで落ちる
    const { steady } = patternsOf(fairOdds(0.5));
    assert.ok(steady.expectedValue !== null);
    assert.ok(steady.expectedValue < 1);
    assert.match(steady.caution ?? '', /割に合いません/);
  });

  it('期待値が1.0以上なら注意を出さない', () => {
    // オッズが全体に1.5倍（＝市場が過小評価している状態）なら 1.125
    const { steady } = patternsOf(fairOdds(1.5));
    assert.ok(steady.expectedValue! >= 1);
    assert.equal(steady.caution, null);
  });
});
