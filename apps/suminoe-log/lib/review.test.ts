/**
 * 買い目の型と結果の照合テスト。
 *
 * フィクスチャはスミノエ・リードの `review.py` が 2026-08-06 の実データから出したもの。
 * 2ツール間のデータ契約テストになっている。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it } from 'vitest';

import { buildSuggestion } from './betting';
import { parseRaceCard } from './raceCard';
import { parseResults } from './results';
import { UNIT_YEN, reviewPlan, reviewPlans, summarizeOutcomes } from './review';
import type { Boat } from './types';

const FIXTURES = join(import.meta.dirname, '__fixtures__');
const CARD = readFileSync(join(FIXTURES, 'racecard-20260806.json'), 'utf8');
const RESULTS = readFileSync(join(FIXTURES, 'results-20260806.json'), 'utf8');

describe('parseResults', () => {
  it('リードの実出力を取り込める', () => {
    const day = parseResults(RESULTS);
    assert.ok(day);
    assert.equal(day.date, '2026-08-06');
    assert.equal(day.races.length, 12);
    assert.equal(day.wakunariCount[1], 12, '枠なり判定の母数が12レースでない');
  });

  it('全レースに着順3艇と払戻が入っている', () => {
    const day = parseResults(RESULTS);
    assert.ok(day);
    for (const race of day.races) {
      assert.equal(race.order.length, 3, `${race.raceNo}R の着順が3艇でない`);
      assert.ok(race.payouts.length > 0, `${race.raceNo}R に払戻がない`);
      // 3連単の払戻は着順と一致するはず
      const trifecta = race.payouts.find((payout) => payout.key === 'trifecta');
      assert.ok(trifecta, `${race.raceNo}R に3連単の払戻がない`);
      assert.deepEqual(trifecta.combo, race.order, `${race.raceNo}R の3連単が着順と違う`);
    }
  });

  it('壊れた入力は null を返す', () => {
    assert.equal(parseResults(''), null);
    assert.equal(parseResults('これはJSONではない'), null);
    assert.equal(parseResults('{"schemaVersion":99,"races":[]}'), null);
    assert.equal(parseResults('{"schemaVersion":1,"races":[]}'), null);
  });
});

describe('reviewPlan', () => {
  it('着順どおりの3連単だけを的中と数える', () => {
    const day = parseResults(RESULTS);
    assert.ok(day);
    // 1R は 1-3-2
    const race = day.races.find((entry) => entry.raceNo === 1);
    assert.ok(race);
    assert.deepEqual(race.order, [1, 3, 2]);

    const hit = reviewPlan(
      {
        key: 'trifecta-formation',
        name: '3連単',
        hitCondition: '',
        formation: '',
        tickets: [[1, 3, 2] as Boat[]],
        points: 1,
        suitedFor: '',
        primary: false,
      },
      race,
    );
    assert.equal(hit.hits.length, 1);
    assert.equal(hit.hits[0].amount, 1650);
    assert.equal(hit.investedYen, UNIT_YEN);
    assert.equal(hit.returnedYen, 1650);

    // 並びが違えば外れ
    const miss = reviewPlan(
      {
        key: 'trifecta-formation',
        name: '3連単',
        hitCondition: '',
        formation: '',
        tickets: [[1, 2, 3] as Boat[]],
        points: 1,
        suitedFor: '',
        primary: false,
      },
      race,
    );
    assert.equal(miss.hits.length, 0);
    assert.equal(miss.returnedYen, 0);
  });

  it('順不同の賭式は並びが違っても的中と数える', () => {
    const day = parseResults(RESULTS);
    assert.ok(day);
    const race = day.races.find((entry) => entry.raceNo === 1);
    assert.ok(race);
    // 1R の3連複は 1-2-3 で 250円
    const outcome = reviewPlan(
      {
        key: 'trio',
        name: '3連複',
        hitCondition: '',
        formation: '',
        tickets: [[3, 1, 2] as Boat[]],
        points: 1,
        suitedFor: '',
        primary: false,
      },
      race,
    );
    assert.equal(outcome.hits.length, 1);
    assert.equal(outcome.hits[0].amount, 250);
  });

  it('該当する賭式の払戻が無ければ unknown になる', () => {
    const day = parseResults(RESULTS);
    assert.ok(day);
    const race = { ...day.races[0], payouts: [] };
    const outcome = reviewPlan(
      {
        key: 'win',
        name: '単勝',
        hitCondition: '',
        formation: '',
        tickets: [[1] as Boat[]],
        points: 1,
        suitedFor: '',
        primary: false,
      },
      race,
    );
    assert.equal(outcome.unknown, true);
    assert.equal(outcome.returnedYen, 0);
  });
});

describe('実データでの通し照合', () => {
  it('全12レースで、提示した型を結果と突き合わせられる', () => {
    const { card } = parseRaceCard(CARD);
    const day = parseResults(RESULTS);
    assert.ok(card && day);

    let hitPlans = 0;
    let invested = 0;
    let returned = 0;

    for (const race of card.races) {
      const suggestion = buildSuggestion(race, {}, 0);
      assert.ok(suggestion, `${race.raceNo}R の買い目が作れない`);
      const resultRace = day.races.find((entry) => entry.raceNo === race.raceNo);
      assert.ok(resultRace, `${race.raceNo}R の結果がない`);

      const outcomes = reviewPlans(suggestion.plans, resultRace);
      assert.equal(outcomes.length, 8, `${race.raceNo}R の賭式が8種でない`);
      // 払戻データが揃っているので unknown は出ないはず（複勝・ワイドも明細にある）
      const unknown = outcomes.filter((outcome) => outcome.unknown).map((o) => o.plan.name);
      assert.deepEqual(unknown, [], `${race.raceNo}R に払戻の取れない賭式: ${unknown.join(',')}`);

      const summary = summarizeOutcomes(outcomes);
      hitPlans += summary.hitPlans;
      invested += summary.investedYen;
      returned += summary.returnedYen;
    }

    // 12レース×8賭式 = 96通りのうち、いくつかは当たっているはず
    assert.ok(hitPlans > 0, '1つも的中していないのは照合が壊れている疑いがある');
    assert.ok(invested > 0);
    // 控除率25%がある以上、全賭式を機械的に買えば負ける。それが確認できること自体が正しい情報
    assert.ok(
      returned < invested,
      `全賭式を買って増える結果になっている（投資${invested} / 払戻${returned}）。照合を疑うべき`,
    );
  });
});
