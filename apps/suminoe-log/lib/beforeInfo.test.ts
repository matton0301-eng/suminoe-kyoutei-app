/**
 * 直前情報（tenji.json）の取り込みテスト。
 *
 * フィクスチャは スミノエ・リード の `beforeinfo.py` が実際に出力した JSON
 * （2026-08-08 の全12R・公開済み）。2ツール間のデータ契約をここで固定する。
 * リード側のキー名が変われば、ここが落ちる。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it } from 'vitest';

import {
  fastestTenji,
  findTenjiRace,
  formatStartTiming,
  formatTenjiWeather,
  parseBeforeInfo,
  tenjiNotes,
} from './beforeInfo';

const FIXTURE = readFileSync(
  join(import.meta.dirname, '__fixtures__', 'tenji-20260808.json'),
  'utf8',
);

/** 未公開のレースを含む最小データ。全部が「まだ」の時間帯を再現する */
const PENDING_JSON = JSON.stringify({
  schemaVersion: 1,
  date: '2026-08-09',
  updatedAt: '2026-08-09T12:00:00+09:00',
  races: [
    { raceNo: 1, available: false, entries: [], weather: null },
    { raceNo: 2, available: false, entries: [], weather: null },
  ],
});

describe('parseBeforeInfo', () => {
  it('スミノエ・リードの実出力を取り込める', () => {
    const day = parseBeforeInfo(FIXTURE);
    assert.ok(day);
    assert.equal(day.date, '2026-08-08');
    assert.equal(day.races.length, 12);
    assert.ok(day.updatedAt.startsWith('2026-08-'));
  });

  it('展示タイム・チルト・スタート展示を読める', () => {
    const day = parseBeforeInfo(FIXTURE);
    const first = day!.races[0];
    assert.equal(first.raceNo, 1);
    assert.equal(first.available, true);
    assert.equal(first.entries.length, 6);
    assert.deepEqual(
      first.entries.map((e) => e.tenjiTime),
      [6.95, 6.94, 6.99, 6.91, 6.92, 6.97],
    );
    assert.equal(first.entries[0].tilt, -0.5);
    assert.equal(first.entries[0].stCourse, 1);
    assert.equal(first.entries[0].stTime, 0.19);
    assert.deepEqual(first.entries[0].partsChanged, ['リング×２']);
  });

  it('前走欄のあるレースでも6艇に収まる', () => {
    // リード側で一度 12 艇に膨らんだ不具合の回帰確認（9R は各選手に前走がある）
    const day = parseBeforeInfo(FIXTURE);
    for (const race of day!.races) {
      assert.equal(race.entries.length, 6, `${race.raceNo}R の艇数`);
      assert.deepEqual(
        race.entries.map((e) => e.teiban),
        [1, 2, 3, 4, 5, 6],
      );
    }
  });

  it('気象を読める', () => {
    const weather = parseBeforeInfo(FIXTURE)!.races[0].weather;
    assert.ok(weather);
    assert.equal(weather.tempC, 29);
    assert.equal(weather.weather, '晴');
  });

  it('未公開のレースは available=false・entries 空で残る', () => {
    const day = parseBeforeInfo(PENDING_JSON);
    assert.ok(day);
    assert.equal(day.races.length, 2);
    assert.equal(day.races[0].available, false);
    assert.deepEqual(day.races[0].entries, []);
  });

  it('schemaVersion が違うデータは受け取らない', () => {
    const raw = JSON.stringify({ ...JSON.parse(FIXTURE), schemaVersion: 2 });
    assert.equal(parseBeforeInfo(raw), null);
  });

  it('壊れた JSON は null', () => {
    assert.equal(parseBeforeInfo('{'), null);
    assert.equal(parseBeforeInfo(''), null);
    assert.equal(parseBeforeInfo('[]'), null);
  });

  it('races が空なら null', () => {
    const raw = JSON.stringify({ schemaVersion: 1, date: '2026-08-09', updatedAt: '', races: [] });
    assert.equal(parseBeforeInfo(raw), null);
  });

  it('型が崩れたエントリは落とす', () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      date: '2026-08-09',
      updatedAt: '2026-08-09T15:00:00+09:00',
      races: [
        {
          raceNo: 1,
          available: true,
          entries: [
            { teiban: 1, name: 'テスト', tenjiTime: 6.9, partsChanged: ['リング'] },
            { teiban: 7, name: '範囲外' },
            { teiban: '2', name: '文字列の艇番' },
            null,
            { teiban: 3, name: '数値でない展示', tenjiTime: '6.8', partsChanged: 'リング' },
          ],
          weather: 'これは辞書ではない',
        },
        { raceNo: 99, available: true, entries: [] },
      ],
    });
    const day = parseBeforeInfo(raw);
    assert.ok(day);
    assert.equal(day.races.length, 1, 'レース番号が範囲外のレースは落とす');
    const entries = day.races[0].entries;
    assert.equal(entries.length, 2);
    assert.equal(entries[0].tenjiTime, 6.9);
    assert.equal(entries[1].tenjiTime, null, '数値でない展示タイムは null');
    assert.deepEqual(entries[1].partsChanged, [], '配列でない部品交換は空配列');
    assert.equal(day.races[0].weather, null);
  });
});

describe('findTenjiRace', () => {
  const day = parseBeforeInfo(FIXTURE);

  it('日付が一致するときだけ返す', () => {
    assert.ok(findTenjiRace(day, 1, '2026-08-08'));
    assert.equal(findTenjiRace(day, 1, '2026-08-09'), null, '前日のデータは使わない');
  });

  it('未公開のレースは返さない', () => {
    const pending = parseBeforeInfo(PENDING_JSON);
    assert.equal(findTenjiRace(pending, 1, '2026-08-09'), null);
  });

  it('データが無ければ null', () => {
    assert.equal(findTenjiRace(null, 1, '2026-08-08'), null);
    assert.equal(findTenjiRace(day, 99, '2026-08-08'), null);
  });
});

describe('formatStartTiming', () => {
  it('公式の表記に戻す', () => {
    assert.equal(formatStartTiming(0.19), '.19');
    assert.equal(formatStartTiming(0.01), '.01');
    assert.equal(formatStartTiming(0.3), '.30');
    assert.equal(formatStartTiming(1.02), '1.02', '1秒以上は整数部も出す');
  });

  it('フライングは F 付きで出す', () => {
    assert.equal(formatStartTiming(-0.06), 'F.06');
    assert.equal(formatStartTiming(-0.01), 'F.01');
  });

  it('値が無ければ null', () => {
    assert.equal(formatStartTiming(null), null);
  });
});

describe('formatTenjiWeather', () => {
  it('観測時刻と数値を1行にまとめる', () => {
    const line = formatTenjiWeather(parseBeforeInfo(FIXTURE)!.races[0].weather);
    assert.ok(line);
    assert.match(line, /20:33現在/);
    assert.match(line, /晴/);
    assert.match(line, /気温29\.0℃/);
    assert.match(line, /水温31\.0℃/);
    assert.match(line, /波1cm/);
  });

  it('風は向きを出さない（アイコン番号でしか公開されていないため）', () => {
    const line = formatTenjiWeather(parseBeforeInfo(FIXTURE)!.races[0].weather);
    assert.match(line!, /風0m/);
    assert.doesNotMatch(line!, /17/);
  });

  it('取れた項目だけを並べる', () => {
    const line = formatTenjiWeather({
      observedAt: null,
      tempC: null,
      weather: null,
      windM: 3,
      windDirNo: null,
      waterTempC: null,
      waveCm: null,
    });
    assert.equal(line, '風3m');
  });

  it('何も無ければ null', () => {
    assert.equal(formatTenjiWeather(null), null);
    assert.equal(
      formatTenjiWeather({
        observedAt: null,
        tempC: null,
        weather: null,
        windM: null,
        windDirNo: null,
        waterTempC: null,
        waveCm: null,
      }),
      null,
    );
  });
});

describe('tenjiNotes', () => {
  it('部品交換を艇ごとに並べる', () => {
    const notes = tenjiNotes(parseBeforeInfo(FIXTURE)!.races[0]);
    assert.deepEqual(notes, ['部品交換: 1号艇 リング×２ / 3号艇 リング×２ / 5号艇 リング×２']);
  });

  it('プロペラ交換は別の行にする', () => {
    const notes = tenjiNotes({
      raceNo: 1,
      available: true,
      weather: null,
      entries: [
        {
          teiban: 1,
          name: 'A',
          weight: null,
          tenjiTime: null,
          tilt: null,
          propeller: '新',
          partsChanged: [],
          stCourse: null,
          stTime: null,
        },
        {
          teiban: 2,
          name: 'B',
          weight: null,
          tenjiTime: null,
          tilt: null,
          propeller: null,
          partsChanged: ['ギヤケース'],
          stCourse: null,
          stTime: null,
        },
      ],
    });
    assert.deepEqual(notes, ['部品交換: 2号艇 ギヤケース', 'プロペラ交換: 1号艇']);
  });

  it('交換が無ければ空', () => {
    assert.deepEqual(tenjiNotes(null), []);
  });
});

describe('fastestTenji', () => {
  it('そのレースの最速値を返す', () => {
    const race = parseBeforeInfo(FIXTURE)!.races[0];
    assert.equal(fastestTenji(race.entries), 6.91);
  });

  it('値が無ければ null', () => {
    assert.equal(fastestTenji([]), null);
    assert.equal(
      fastestTenji([{ teiban: 1, tenjiTime: null } as never]),
      null,
    );
  });
});
