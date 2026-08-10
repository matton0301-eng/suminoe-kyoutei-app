/**
 * 5つの視点のテスト。
 *
 * いちばん守りたいのは2つ。
 *   - **視点が混ざらないこと。** 当地の視点がモーターを見た時点で「1つのスコア」に戻る
 *   - **割れているときに「揃っている」と言わないこと**
 */

import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import type { TenjiRace } from './beforeInfo';
import { buildLenses, consensusLabel, parseLensRecord, statOf } from './lenses';
import type { RaceOddsData } from './odds';
import type { CardBoat, CardRace } from './raceCard';
import type { Boat } from './types';

function boat(over: Partial<CardBoat> & { teiban: Boat }): CardBoat {
  return {
    name: '選手',
    kyubetsu: 'B1',
    age: 30,
    branch: '大阪',
    zenkokuShoritsu: 5,
    zenkokuNiritsu: 30,
    touchiShoritsu: 5,
    touchiNiritsu: 30,
    noTouchiData: false,
    evalShoritsu: 5,
    motorNo: 10,
    motorNiritsu: 30,
    boatNo: 20,
    boatNiritsu: 30,
    konsetsu: '',
    ...over,
  };
}

/** 1号艇がセオリー、3号艇が当地最強、5号艇がモーター最強、という作り */
const RACE: CardRace = {
  raceNo: 1,
  name: '一般戦',
  distanceM: 1800,
  deadline: '15:17',
  ok: true,
  parseError: null,
  inConfidence: null,
  inReason: null,
  upsetRisk: null,
  upsetReason: null,
  verdict: null,
  verdictReason: null,
  betShape: null,
  motorPicks: [],
  notes: [],
  boats: [
    boat({ teiban: 1, kyubetsu: 'A1', touchiShoritsu: 5.0, motorNiritsu: 30 }),
    boat({ teiban: 2 }),
    boat({ teiban: 3, touchiShoritsu: 8.5, touchiNiritsu: 60 }),
    boat({ teiban: 4 }),
    boat({ teiban: 5, motorNo: 77, motorNiritsu: 55 }),
    boat({ teiban: 6 }),
  ],
} as unknown as CardRace;

const pick = (race: CardRace, key: string) =>
  buildLenses(race, null, null).picks.find((entry) => entry.key === key)!;

describe('視点ごとの独立', () => {
  it('セオリーはコースと級別だけを見る', () => {
    assert.equal(pick(RACE, 'theory').anchor, 1);
  });

  it('当地実績は当地勝率だけを見る（コースを見ない）', () => {
    assert.equal(pick(RACE, 'local').anchor, 3, '3号艇が当地8.5で最高');
  });

  it('モーターは2連率だけを見る', () => {
    assert.equal(pick(RACE, 'motor').anchor, 5, '5号艇が55%で最高');
  });

  it('理由には必ず数字が入る', () => {
    for (const key of ['local', 'motor']) {
      assert.match(pick(RACE, key).reason ?? '', /\d/);
    }
  });
});

describe('材料が無いとき', () => {
  it('当地データが無ければ推さない（全国で代替しない）', () => {
    const race = {
      ...RACE,
      boats: RACE.boats.map((entry) => ({ ...entry, noTouchiData: true })),
    } as CardRace;
    const local = pick(race, 'local');
    assert.equal(local.anchor, null);
    assert.match(local.missing ?? '', /当地/);
  });

  it('展示が未公開なら推さず、理由を出す', () => {
    const verdict = buildLenses(RACE, null, null);
    const tenji = verdict.picks.find((entry) => entry.key === 'tenji')!;
    assert.equal(tenji.anchor, null);
    assert.match(tenji.missing ?? '', /展示/);
  });

  it('オッズが無ければ市場は推さない', () => {
    const market = pick(RACE, 'market');
    assert.equal(market.anchor, null);
  });
});

describe('展示の視点', () => {
  it('展示タイムは小さいほど速い', () => {
    const tenji: TenjiRace = {
      raceNo: 1,
      available: true,
      weather: null,
      entries: [
        { teiban: 1, name: '', weight: null, tenjiTime: 6.9, tilt: null, propeller: null, partsChanged: [], stCourse: 1, stTime: 0.15 },
        { teiban: 4, name: '', weight: null, tenjiTime: 6.7, tilt: null, propeller: null, partsChanged: [], stCourse: 4, stTime: 0.2 },
      ],
    };
    const verdict = buildLenses(RACE, tenji, null);
    assert.equal(verdict.picks.find((p) => p.key === 'tenji')!.anchor, 4, '6.70秒のほうが速い');
  });
});

describe('市場の視点', () => {
  it('3連単オッズから1着の暗黙確率がいちばん高い艇を採る', () => {
    const trifecta = new Map<string, number>([
      ['1-2-3', 5],
      ['1-3-2', 6],
      ['2-1-3', 50],
      ['3-1-2', 80],
    ]);
    const odds = {
      raceNo: 1,
      fetchedAt: null,
      trifecta,
      trio: new Map(),
      exacta: new Map(),
      quinella: new Map(),
      win: new Map(),
      wide: new Map(),
      place: new Map(),
    } as RaceOddsData;
    const verdict = buildLenses(RACE, null, odds);
    assert.equal(verdict.picks.find((p) => p.key === 'market')!.anchor, 1);
  });
});

describe('一致の判定', () => {
  it('割れているときに「揃っている」と言わない', () => {
    // セオリー1・当地3・モーター5 でバラバラ
    const verdict = buildLenses(RACE, null, null);
    assert.equal(verdict.consensus, 'split');
    assert.match(consensusLabel(verdict), /割れて/);
  });

  it('材料が揃って一致すれば strong', () => {
    const race = {
      ...RACE,
      boats: RACE.boats.map((entry) =>
        entry.teiban === 1
          ? { ...entry, touchiShoritsu: 9, motorNiritsu: 60 }
          : { ...entry, touchiShoritsu: 3, motorNiritsu: 20 },
      ),
    } as CardRace;
    const tenji: TenjiRace = {
      raceNo: 1,
      available: true,
      weather: null,
      entries: [
        { teiban: 1, name: '', weight: null, tenjiTime: 6.6, tilt: null, propeller: null, partsChanged: [], stCourse: 1, stTime: 0.1 },
        { teiban: 2, name: '', weight: null, tenjiTime: 6.9, tilt: null, propeller: null, partsChanged: [], stCourse: 2, stTime: 0.2 },
      ],
    };
    const verdict = buildLenses(race, tenji, null);
    assert.equal(verdict.leading, 1);
    assert.equal(verdict.agree, 4);
    assert.equal(verdict.consensus, 'strong');
    assert.match(consensusLabel(verdict), /揃って/);
  });

  it('材料が1つも無ければ unknown', () => {
    const empty = { ...RACE, boats: [] } as unknown as CardRace;
    const verdict = buildLenses(empty, null, null);
    assert.equal(verdict.consensus, 'unknown');
    assert.equal(verdict.leading, null);
  });
});

describe('視点ごとの実測', () => {
  const RECORD = JSON.stringify({
    schemaVersion: 1,
    generatedAt: '2026-08-10T10:00:00Z',
    days: 62,
    races: 743,
    lenses: [
      { key: 'theory', label: 'セオリー', measured: true, races: 743, firstRate: 0.555, top3Rate: 0.808 },
      { key: 'tenji', label: '展示', measured: false },
    ],
  });

  it('測った視点の数字を引ける', () => {
    const record = parseLensRecord(RECORD)!;
    const stat = statOf(record, 'theory')!;
    assert.equal(stat.measured, true);
    assert.equal(record.races, 743);
  });

  it('測っていない視点に数字を当てはめない', () => {
    const record = parseLensRecord(RECORD)!;
    assert.equal(statOf(record, 'tenji')!.measured, false);
  });

  it('壊れた入力では null', () => {
    assert.equal(parseLensRecord('{'), null);
    assert.equal(parseLensRecord('{"lenses":[]}'), null);
  });
});
