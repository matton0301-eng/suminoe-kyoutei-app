/**
 * 取り込み（parseRaceCard）と、実データでの買い目生成の統合テスト。
 *
 * フィクスチャは スミノエ・リード が実際に出力した JSON（2026-08-06 の実番組表）。
 * 2ツール間のデータ契約をここで固定する。リード側の出力形式が変わればここが落ちる。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it } from 'vitest';

import { ORDERED_KEYS, buildSuggestion } from './betting';
import { parseRaceCard } from './raceCard';
import { BOATS } from './types';

const FIXTURE = readFileSync(
  join(import.meta.dirname, '__fixtures__', 'racecard-20260806.json'),
  'utf8',
);

describe('parseRaceCard', () => {
  it('スミノエ・リードの実出力を取り込める', () => {
    const { card, error } = parseRaceCard(FIXTURE);
    assert.equal(error, null);
    assert.ok(card);
    assert.equal(card.date, '2026-08-06');
    assert.equal(card.place, 'ボートレース住之江');
    assert.equal(card.races.length, 12);
    assert.ok(card.motorLine !== null && card.motorLine > 0);
  });

  it('全12レースに6艇そろい、判定が入っている', () => {
    const { card } = parseRaceCard(FIXTURE);
    assert.ok(card);
    for (const race of card.races) {
      assert.equal(race.boats.length, 6, `${race.raceNo}R の艇数がおかしい`);
      assert.deepEqual(
        race.boats.map((boat) => boat.teiban),
        [...BOATS],
        `${race.raceNo}R の枠番が1〜6でない`,
      );
      assert.equal(race.ok, true, `${race.raceNo}R が ok でない`);
      assert.ok(race.verdict, `${race.raceNo}R に総合判定がない`);
      assert.ok(race.inConfidence, `${race.raceNo}R にイン信頼度がない`);
      assert.ok(race.upsetRisk, `${race.raceNo}R に波乱リスクがない`);
      assert.ok(race.deadline.match(/^\d{1,2}:\d{2}$/), `${race.raceNo}R の締切時刻が変`);
    }
  });

  it('当地データなしの艇は評価勝率が全国勝率で埋まっている', () => {
    const { card } = parseRaceCard(FIXTURE);
    assert.ok(card);
    const noData = card.races.flatMap((race) => race.boats).filter((boat) => boat.noTouchiData);
    for (const boat of noData) {
      assert.equal(boat.touchiShoritsu, 0);
      assert.equal(boat.evalShoritsu, boat.zenkokuShoritsu, `${boat.name} の評価勝率が0扱い`);
    }
  });

  it('壊れた入力は理由付きで拒否する', () => {
    assert.match(parseRaceCard('').error ?? '', /空/);
    assert.match(parseRaceCard('これはJSONではない').error ?? '', /JSON/);
    assert.match(parseRaceCard('[1,2,3]').error ?? '', /形/);
    assert.match(parseRaceCard('{"schemaVersion":99,"races":[]}').error ?? '', /schemaVersion=99/);
    assert.match(parseRaceCard('{"schemaVersion":1,"races":[]}').error ?? '', /レース/);
  });

  it('レース番号が範囲外の要素は捨てる', () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      races: [
        { raceNo: 0, boats: [] },
        { raceNo: 13, boats: [] },
        { raceNo: 5, boats: [] },
      ],
    });
    const { card, error } = parseRaceCard(raw);
    assert.equal(error, null);
    assert.ok(card);
    assert.deepEqual(
      card.races.map((race) => race.raceNo),
      [5],
    );
  });
});

describe('実データでの買い目生成', () => {
  it('全12レースで買い目が組める', () => {
    const { card } = parseRaceCard(FIXTURE);
    assert.ok(card);
    for (const race of card.races) {
      const suggestion = buildSuggestion(race, {}, 0);
      assert.ok(suggestion, `${race.raceNo}R で買い目が作れない`);
      assert.equal(suggestion.plans.length, 8);
      assert.equal(suggestion.partners.length, 5, `${race.raceNo}R の相手が5艇でない`);
      assert.ok(
        !suggestion.partners.includes(suggestion.anchor),
        `${race.raceNo}R の相手に軸が混ざっている`,
      );
      for (const plan of suggestion.plans) {
        assert.ok(plan.points > 0, `${race.raceNo}R の${plan.name}が空`);
        for (const ticket of plan.tickets) {
          assert.equal(
            new Set(ticket).size,
            ticket.length,
            `${race.raceNo}R の${plan.name}に同一艇の重複: ${ticket.join('-')}`,
          );
          for (const boat of ticket) {
            assert.ok(boat >= 1 && boat <= 6, `${race.raceNo}R に不正な艇番 ${boat}`);
          }
        }
      }
    }
  });

  it('順不同の賭式は昇順・重複なしで、必ず軸を含む', () => {
    const { card } = parseRaceCard(FIXTURE);
    assert.ok(card);
    for (const race of card.races) {
      const suggestion = buildSuggestion(race, {}, 0);
      assert.ok(suggestion);
      for (const plan of suggestion.plans) {
        if (ORDERED_KEYS.has(plan.key)) continue;
        const seen = new Set<string>();
        for (const ticket of plan.tickets) {
          assert.deepEqual(ticket, [...ticket].sort((a, b) => a - b));
          assert.ok(ticket.includes(suggestion.anchor));
          const key = ticket.join('-');
          assert.ok(!seen.has(key), `${race.raceNo}R の${plan.name}に重複組 ${key}`);
          seen.add(key);
        }
      }
    }
  });

  it('1号艇が明確に弱いレースだけ軸が外に出る', () => {
    const { card } = parseRaceCard(FIXTURE);
    assert.ok(card);

    const moved: { raceNo: number; anchor: number }[] = [];
    for (const race of card.races) {
      const suggestion = buildSuggestion(race, {}, 0);
      assert.ok(suggestion);
      if (suggestion.anchor !== 1) {
        moved.push({ raceNo: race.raceNo, anchor: suggestion.anchor });
        // 軸が移ったレースでは必ず注意文を出す
        assert.ok(suggestion.anchorNote, `${race.raceNo}R に軸移動の注意文がない`);
      }
    }

    // 8/6 は1号艇がB級中心の一般戦。全レースが1号艇軸になるのも、
    // 全レースで外に出るのも不自然なので、その両極でないことを確認する
    assert.ok(moved.length > 0, '1レースも軸が動かないのはコース補正が強すぎる');
    assert.ok(
      moved.length < card.races.length,
      '全レースで軸が動くのはコース補正が弱すぎる',
    );
  });

  it('リードが示した軸と、アプリが選ぶ軸が一致する', () => {
    /**
     * 同じデータから2つのツールが違う軸を出すと利用者が混乱する。
     * リード側の `betShape`（買い目の型の文字列）から軸を読み取り、
     * アプリ側の軸選定と突き合わせる。
     *
     * ずれた場合はコース補正の係数を確認する:
     *   tools/suminoe-read/suminoe/analyzer.py の COURSE_WEIGHT_FIRST
     *   apps/suminoe-log/lib/betting.ts の COURSE_WEIGHT_FIRST
     * 両者は同じ値でなければならない。
     */
    const { card } = parseRaceCard(FIXTURE);
    assert.ok(card);

    for (const race of card.races) {
      const suggestion = buildSuggestion(race, {}, 0);
      assert.ok(suggestion);
      const shape = race.betShape ?? '';
      const matched =
        shape.match(/買うなら(\d)号艇軸/) ??
        shape.match(/複勝 (\d)号艇/) ??
        shape.match(/3連単フォーメーション (\d)-/);
      assert.ok(matched, `${race.raceNo}R のリード側の型から軸を読み取れない: ${shape}`);
      assert.equal(
        Number(matched[1]),
        suggestion.anchor,
        `${race.raceNo}R の軸がリードとアプリで食い違っている（型: ${shape}）`,
      );
    }
  });

  it('当日実測を混ぜても買い目の整合性が崩れない', () => {
    const { card } = parseRaceCard(FIXTURE);
    assert.ok(card);
    // 当日インが全勝している極端なケース
    const actual = { 1: 100, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 } as const;
    for (const race of card.races) {
      const suggestion = buildSuggestion(race, actual, 24);
      assert.ok(suggestion);
      assert.equal(suggestion.actualWeight, 0.5);
      // インが全勝している日は、どのレースも1号艇が軸になる
      assert.equal(suggestion.anchor, 1, `${race.raceNo}R の軸が1号艇でない`);
    }
  });
});
