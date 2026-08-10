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
import { buildPatterns, heatOf, losesOnHit } from './patterns';
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
  // 買い目は3連単・3連複しか使わない。他の賭式は空で足りる
  return {
    raceNo: 1,
    fetchedAt: '2026-08-09T15:05:00+09:00',
    trifecta,
    trio,
    exacta: new Map(),
    quinella: new Map(),
    win: new Map(),
    wide: new Map(),
    place: new Map(),
  };
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

describe('期待度', () => {
  it('3連単は的中率に応じて段が上がる', () => {
    assert.equal(heatOf(0.05, '3連単').level, 0, '低いうちは印を出さない');
    assert.equal(heatOf(0.08, '3連単').level, 1);
    assert.equal(heatOf(0.13, '3連単').level, 2);
    assert.equal(heatOf(0.2, '3連単').level, 3);
    assert.equal(heatOf(0.28, '3連単').level, 4);
    assert.equal(heatOf(0.38, '3連単').level, 5);
    assert.equal(heatOf(0.95, '3連単').level, 5, '上限は虹どまり');
  });

  it('3連複は基準が高い（構造的に当たりやすいため）', () => {
    // 同じ的中率でも、3連複なら段が下がる
    assert.equal(heatOf(0.3, '3連複').level, 0);
    assert.equal(heatOf(0.3, '3連単').level, 4);
    assert.equal(heatOf(0.48, '3連複').level, 3);
    assert.equal(heatOf(0.62, '3連複').level, 5);
  });

  it('実データの分布で階調が出る', () => {
    // 2026-08-09 の12レース（3連複3点）の実測値。全部が同じ段に潰れないこと
    const actual = [0.54, 0.537, 0.533, 0.47, 0.445, 0.443, 0.417, 0.395, 0.381, 0.38, 0.311, 0.27];
    const levels = new Set(actual.map((p) => heatOf(p, '3連複').level));
    assert.ok(levels.size >= 4, `段が ${levels.size} 種類しか出ていない`);
  });

  it('言葉には必ず基準の的中率がある（煽りにしないため）', () => {
    for (const p of [0.1, 0.2, 0.35, 0.5, 0.7]) {
      for (const bet of ['3連単', '3連複'] as const) {
        const heat = heatOf(p, bet);
        if (heat.level === 0) continue;
        assert.notEqual(heat.label, '');
        assert.ok(heat.threshold > 0, `${heat.label} に基準がない`);
        assert.ok(p >= heat.threshold, `${heat.label} の基準を満たしていない`);
      }
    }
  });

  it('境界のすぐ下では段が上がらない', () => {
    assert.equal(heatOf(0.199, '3連単').level, 2);
    assert.equal(heatOf(0.619, '3連複').level, 4);
  });
});

/**
 * 2026-08-09 の現地で見つかった2つの誤りを固定する。
 *
 * 1. 「勝負」を期待値順で選んでいた（未検証の選び方だった。当日 0/7）
 * 2. 「堅実」に乖離の上限が掛かっていなかった（1点で的中率と期待値が水増しされた）
 */
describe('選び方の基準（8/9 の修正）', () => {
  /** 特定の1点だけオッズを跳ね上げ、市場が薄く見ている状態を作る */
  function withInflated(key: string, odds: number): RaceOddsData {
    const base = fairOdds();
    const trio = new Map(base.trio);
    const trifecta = new Map(base.trifecta);
    if (trio.has(key)) trio.set(key, odds);
    if (trifecta.has(key)) trifecta.set(key, odds);
    return { ...base, trio, trifecta };
  }

  it('勝負は確率の高い順に選ぶ（期待値順にしない）', () => {
    // 確率3位の点のオッズだけを跳ね上げても、並び順は変わらない
    const anchorFirst = [...PROBABILITY.trifecta.entries()]
      .filter(([key]) => key.startsWith('1-'))
      .sort((a, b) => b[1] - a[1]);
    const third = anchorFirst[2][0];

    const { challenge } = patternsOf(fairOdds());
    const before = challenge.tickets.map((t) => t.boats.join('-'));

    // オッズを2倍にすると期待値順なら先頭に来るが、確率順なら3番目のまま
    const bumped = patternsOf(withInflated(third, (fairOdds().trifecta.get(third) ?? 1) * 2));
    const after = bumped.challenge.tickets.map((t) => t.boats.join('-'));

    assert.deepEqual(after, before, 'オッズが動いても並びは確率順のまま');
    assert.equal(after[2], third);
  });

  it('勝負の並びは常に確率降順', () => {
    const { challenge } = patternsOf(fairOdds());
    const probabilities = challenge.tickets.map((t) => t.probability);
    assert.deepEqual(probabilities, [...probabilities].sort((a, b) => b - a));
  });

  it('堅実は市場と3倍を超えて食い違う点を外す', () => {
    const top = [...PROBABILITY.trio.entries()].sort((a, b) => b[1] - a[1])[0][0];
    // オッズを10倍にすると市場の暗黙確率が1/10になり、乖離が上限を超える
    const inflated = withInflated(top, (fairOdds().trio.get(top) ?? 1) * 10);
    const { steady } = patternsOf(inflated);
    const keys = steady.tickets.map((t) => t.boats.join('-'));
    assert.ok(!keys.includes(top), '乖離が大きい点は堅実に入れない');
    assert.equal(steady.points, 3, '外したぶんは次の候補で埋める');
  });

  it('乖離で外しても、残った点は確率降順のまま', () => {
    const top = [...PROBABILITY.trio.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const { steady } = patternsOf(withInflated(top, (fairOdds().trio.get(top) ?? 1) * 10));
    const probabilities = steady.tickets.map((t) => t.probability);
    assert.deepEqual(probabilities, [...probabilities].sort((a, b) => b - a));
  });

  it('オッズが無ければ乖離で外せないので、確率上位がそのまま残る', () => {
    const { steady } = patternsOf(null);
    assert.equal(steady.points, 3);
    assert.equal(steady.expectedValue, null);
  });
});

describe('losesOnHit（当たっても負ける買い目）', () => {
  const ticket = (odds: number | null) => ({
    boats: [1, 2, 3] as Boat[],
    probability: 0.1,
    odds,
    marketProbability: null,
  });

  it('オッズが点数以下なら、当たっても取り戻せない', () => {
    assert.equal(losesOnHit(ticket(2.5), 3), true, '2.5倍を3点買い → 当たって−0.5点ぶん');
    assert.equal(losesOnHit(ticket(3.0), 3), true, 'ちょうど同額でもプラスにはならない');
  });

  it('オッズが点数を超えていればプラスになる', () => {
    assert.equal(losesOnHit(ticket(3.1), 3), false);
    assert.equal(losesOnHit(ticket(7.0), 3), false);
  });

  it('点数が増えるほど、必要なオッズも上がる', () => {
    assert.equal(losesOnHit(ticket(5.0), 3), false);
    assert.equal(losesOnHit(ticket(5.0), 6), true, '6点買いなら5倍では足りない');
  });

  it('オッズが取れていなければ判定しない', () => {
    assert.equal(losesOnHit(ticket(null), 3), false);
  });
});
