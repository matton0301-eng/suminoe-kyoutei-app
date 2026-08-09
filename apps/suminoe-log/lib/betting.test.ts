/**
 * 買い目生成のテスト。
 *
 *   npm test
 *
 * vitest は devDependency のみ。本番のバンドルには含まれない。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { COURSE_FIRST_RATE } from './baseline';
import { blendCourseRates, buildSuggestion, ORDERED_KEYS, type BetPlan } from './betting';
import type { CardBoat, CardRace, Verdict } from './raceCard';
import type { Boat } from './types';

function makeBoat(teiban: Boat, overrides: Partial<CardBoat> = {}): CardBoat {
  return {
    teiban,
    name: `選手${teiban}`,
    kyubetsu: 'B1',
    age: 35,
    branch: '大阪',
    zenkokuShoritsu: 4.5,
    zenkokuNiritsu: 25,
    touchiShoritsu: 4.5,
    touchiNiritsu: 25,
    noTouchiData: false,
    evalShoritsu: 4.5,
    motorNo: teiban * 10,
    motorNiritsu: 30,
    boatNo: teiban * 10,
    boatNiritsu: 30,
    konsetsu: '123',
    ...overrides,
  };
}

function makeRace(boats: CardBoat[], verdict: Verdict = '標準'): CardRace {
  return {
    raceNo: 1,
    name: '予選',
    distanceM: 1800,
    deadline: '18:00',
    ok: true,
    inConfidence: '中',
    inReason: null,
    upsetRisk: '中',
    upsetReason: null,
    verdict,
    verdictReason: null,
    betShape: null,
    motorPicks: [],
    notes: [],
    boats,
  };
}

/** 全艇同じ勝率のレース。差はコース補正だけになる */
function evenRace(verdict: Verdict = '標準'): CardRace {
  return makeRace(
    ([1, 2, 3, 4, 5, 6] as Boat[]).map((teiban) => makeBoat(teiban)),
    verdict,
  );
}

describe('blendCourseRates', () => {
  it('母数が3件未満なら基準値をそのまま使う', () => {
    const { rates, weight } = blendCourseRates({ 1: 100, 2: 0 }, 2);
    assert.equal(weight, 0);
    assert.equal(rates[1], COURSE_FIRST_RATE[1]);
    assert.equal(rates[2], COURSE_FIRST_RATE[2]);
  });

  it('母数が増えると実測を混ぜるが、上限50%を超えない', () => {
    const { weight: w6 } = blendCourseRates({ 1: 100 }, 6);
    const { weight: w12 } = blendCourseRates({ 1: 100 }, 12);
    const { weight: w48 } = blendCourseRates({ 1: 100 }, 48);
    assert.ok(w6 > 0 && w6 < w12, `w6=${w6} w12=${w12}`);
    assert.equal(w48, 0.5);
  });

  it('実測が高いコースは基準値より高く補正される', () => {
    const { rates } = blendCourseRates({ 1: 100 }, 12);
    assert.ok(rates[1] > COURSE_FIRST_RATE[1]);
    // 実測がない（null）コースは基準値のまま
    assert.equal(rates[5], COURSE_FIRST_RATE[5]);
  });

  it('実測が null のコースは基準値を保つ', () => {
    const { rates } = blendCourseRates({ 1: null, 2: undefined }, 24);
    assert.equal(rates[1], COURSE_FIRST_RATE[1]);
    assert.equal(rates[2], COURSE_FIRST_RATE[2]);
  });
});

describe('買い目の書き方', () => {
  it('集合の記法を使わない（マークシートと並びを揃える）', () => {
    const suggestion = buildSuggestion(evenRace(), {}, 0)!;
    for (const plan of suggestion.plans) {
      assert.doesNotMatch(plan.formation, /[{}]/, `${plan.name}: ${plan.formation}`);
    }
  });

  it('3連単は着順が分かる向きで並べる', () => {
    const suggestion = buildSuggestion(evenRace(), {}, 0)!;
    const formation = suggestion.plans.find((p) => p.key === 'trifecta-formation')!.formation;
    assert.match(formation, /→/);
  });

  it('順不同の賭式は = でつなぐ', () => {
    const suggestion = buildSuggestion(evenRace(), {}, 0)!;
    for (const key of ['trio', 'quinella', 'wide'] as const) {
      const formation = suggestion.plans.find((p) => p.key === key)!.formation;
      assert.match(formation, /=/, key);
    }
  });
});

describe('buildSuggestion', () => {
  it('出走表がそろっていないレースでは何も返さない', () => {
    const broken: CardRace = { ...evenRace(), ok: false, boats: [] };
    assert.equal(buildSuggestion(broken, {}, 0), null);
  });

  it('勝率が同じなら1号艇が軸になる（住之江の1コース1着率56.2%を反映）', () => {
    const suggestion = buildSuggestion(evenRace(), {}, 0);
    assert.ok(suggestion);
    assert.equal(suggestion.anchor, 1);
    assert.equal(suggestion.anchorNote, null);
  });

  it('勝率が同じなら相手は内側の枠から並ぶ', () => {
    const suggestion = buildSuggestion(evenRace(), {}, 0);
    assert.ok(suggestion);
    assert.deepEqual(suggestion.partners.slice(0, 3), [2, 3, 4]);
  });

  it('外枠に圧倒的な実力者がいれば軸が移り、注意文が付く', () => {
    const race = makeRace([
      makeBoat(1, { evalShoritsu: 3.0, touchiShoritsu: 3.0 }),
      makeBoat(2),
      makeBoat(3),
      makeBoat(4),
      makeBoat(5),
      makeBoat(6, { kyubetsu: 'A1', evalShoritsu: 7.9, touchiShoritsu: 7.9 }),
    ]);
    const suggestion = buildSuggestion(race, {}, 0);
    assert.ok(suggestion);
    assert.equal(suggestion.anchor, 6);
    assert.ok(suggestion.anchorNote?.includes('1号艇を切る判断は慎重に'));
  });

  it('1号艇がB級で2号艇にA1トップがいれば2号艇が軸になる', () => {
    // 2026-08-06 の1Rと同じ構図（1号艇 B1 当地3.59 / 2号艇 A1 当地7.29）
    const race = makeRace([
      makeBoat(1, { kyubetsu: 'B1', evalShoritsu: 3.59, touchiShoritsu: 3.59 }),
      makeBoat(2, { kyubetsu: 'A1', evalShoritsu: 7.29, touchiShoritsu: 7.29 }),
      makeBoat(3, { evalShoritsu: 5.22, touchiShoritsu: 5.22 }),
      makeBoat(4),
      makeBoat(5),
      makeBoat(6),
    ]);
    const suggestion = buildSuggestion(race, {}, 0);
    assert.ok(suggestion);
    assert.equal(suggestion.anchor, 2);
  });

  it('1号艇が平均的で2号艇がやや上程度なら1号艇の軸を維持する', () => {
    const race = makeRace([
      makeBoat(1, { evalShoritsu: 5.0, touchiShoritsu: 5.0 }),
      makeBoat(2, { kyubetsu: 'A1', evalShoritsu: 7.2, touchiShoritsu: 7.2 }),
      makeBoat(3),
      makeBoat(4),
      makeBoat(5),
      makeBoat(6),
    ]);
    const suggestion = buildSuggestion(race, {}, 0);
    assert.ok(suggestion);
    assert.equal(suggestion.anchor, 1, '住之江の1コース優位を過小評価している');
  });

  it('全賭式を出し、点数は組み合わせの数と一致する', () => {
    const suggestion = buildSuggestion(evenRace(), {}, 0);
    assert.ok(suggestion);
    assert.equal(suggestion.plans.length, 8);
    for (const plan of suggestion.plans) {
      assert.equal(plan.points, plan.tickets.length, `${plan.name} の点数がずれている`);
      assert.ok(plan.points > 0, `${plan.name} の買い目が空`);
      assert.ok(plan.hitCondition.length > 0, `${plan.name} に的中条件の説明がない`);
    }
  });

  it('各賭式の点数が競艇の賭式として正しい', () => {
    const suggestion = buildSuggestion(evenRace(), {}, 0);
    assert.ok(suggestion);
    const points = new Map(suggestion.plans.map((plan) => [plan.key, plan.points]));
    // 3連単フォーメーション: 軸固定 × 2着2艇 × 3着4艇（2着と3着の重複を除く）= 2*4-2
    assert.equal(points.get('trifecta-formation'), 6);
    // 3連単ボックス: 3艇の並べ替え = 3! = 6
    assert.equal(points.get('trifecta-box'), 6);
    // 3連複: 軸 + 相手3艇から2艇 = 3C2 = 3
    assert.equal(points.get('trio'), 3);
    assert.equal(points.get('exacta'), 2);
    assert.equal(points.get('quinella'), 2);
    assert.equal(points.get('wide'), 2);
    assert.equal(points.get('win'), 1);
    assert.equal(points.get('place'), 1);
  });

  it('順番が意味を持つ賭式では、同じ艇が重複しない', () => {
    const suggestion = buildSuggestion(evenRace(), {}, 0);
    assert.ok(suggestion);
    for (const plan of suggestion.plans) {
      for (const ticket of plan.tickets) {
        assert.equal(
          new Set(ticket).size,
          ticket.length,
          `${plan.name} に同じ艇を含む買い目がある: ${ticket.join('-')}`,
        );
      }
    }
  });

  it('順不同の賭式は昇順に整えられ、重複した組がない', () => {
    const suggestion = buildSuggestion(evenRace(), {}, 0);
    assert.ok(suggestion);
    for (const plan of suggestion.plans) {
      if (ORDERED_KEYS.has(plan.key)) continue;
      const seen = new Set<string>();
      for (const ticket of plan.tickets) {
        assert.deepEqual(ticket, [...ticket].sort((a, b) => a - b), `${plan.name} が昇順でない`);
        const key = ticket.join('-');
        assert.ok(!seen.has(key), `${plan.name} に同じ組が2回ある: ${key}`);
        seen.add(key);
      }
    }
  });

  it('順不同の賭式には必ず軸が含まれる', () => {
    const suggestion = buildSuggestion(evenRace(), {}, 0);
    assert.ok(suggestion);
    for (const plan of suggestion.plans) {
      if (ORDERED_KEYS.has(plan.key)) continue;
      for (const ticket of plan.tickets) {
        assert.ok(
          ticket.includes(suggestion.anchor),
          `${plan.name} の ${ticket.join('=')} に軸が入っていない`,
        );
      }
    }
  });

  it('3連単・2連単は必ず軸が1着に置かれる', () => {
    const suggestion = buildSuggestion(evenRace(), {}, 0);
    assert.ok(suggestion);
    for (const key of ['trifecta-formation', 'exacta'] as const) {
      // assert.ok の型述語で推論が循環するため、型を明示する
      const plan: BetPlan | undefined = suggestion.plans.find((entry) => entry.key === key);
      assert.ok(plan);
      for (const ticket of plan.tickets) {
        assert.equal(ticket[0], suggestion.anchor, `${plan.name} の1着が軸でない`);
      }
    }
  });

  it('判定に応じて定石の賭式が変わる', () => {
    const primaryOf = (verdict: Verdict) => {
      const suggestion = buildSuggestion(evenRace(verdict), {}, 0);
      assert.ok(suggestion);
      return suggestion.plans.filter((plan) => plan.primary).map((plan) => plan.key);
    };
    assert.deepEqual(primaryOf('勝負'), ['trifecta-formation']);
    assert.deepEqual(primaryOf('標準').sort(), ['exacta', 'trio']);
    // 見送りは当たりやすい賭式だけを前に出す
    assert.deepEqual(primaryOf('見送り').sort(), ['place', 'wide']);
  });

  it('当日インが強く出ていれば1号艇の軸がより強固になる', () => {
    // 1号艇がやや劣るが、当日1コースが全勝しているケース
    const race = makeRace([
      makeBoat(1, { evalShoritsu: 5.0, touchiShoritsu: 5.0 }),
      makeBoat(2, { evalShoritsu: 5.6, touchiShoritsu: 5.6 }),
      makeBoat(3),
      makeBoat(4),
      makeBoat(5),
      makeBoat(6),
    ]);
    const baseline = buildSuggestion(race, {}, 0);
    const withActual = buildSuggestion(race, { 1: 100, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }, 12);
    assert.ok(baseline && withActual);
    assert.equal(baseline.anchor, 1);
    assert.equal(withActual.anchor, 1);
    assert.ok(withActual.actualWeight > 0);
  });

  it('当地データがない艇は全国勝率で評価される（0扱いにしない）', () => {
    const race = makeRace([
      makeBoat(1, {
        kyubetsu: 'A1',
        touchiShoritsu: 0,
        touchiNiritsu: 0,
        noTouchiData: true,
        zenkokuShoritsu: 7.5,
        evalShoritsu: 7.5,
      }),
      makeBoat(2),
      makeBoat(3),
      makeBoat(4),
      makeBoat(5),
      makeBoat(6),
    ]);
    const suggestion = buildSuggestion(race, {}, 0);
    assert.ok(suggestion);
    assert.equal(suggestion.anchor, 1);
    const score1 = suggestion.scores.find((score) => score.teiban === 1);
    assert.ok(score1 && score1.firstScore > 7.5, '全国勝率が評価に反映されていない');
  });

  it('買い目の説明に断定的な表現を含めない', () => {
    const suggestion = buildSuggestion(evenRace('勝負'), {}, 0);
    assert.ok(suggestion);
    for (const plan of suggestion.plans) {
      const blob = `${plan.name}${plan.hitCondition}${plan.suitedFor}`;
      for (const banned of ['必ず当た', '確実', '儲か', '勝てる', '的中率']) {
        assert.ok(!blob.includes(banned), `${plan.name} に断定的表現: ${banned}`);
      }
    }
  });
});
