/**
 * 開催予定の読み取りのテスト。
 *
 * **「予定が無い」と「開催が無い」を混ぜない。** 取得に失敗したときに
 * 「今日は開催なし」と表示してしまうと、開催日に何も出ないアプリになる。
 */

import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  addDays,
  daysUntil,
  hasRaceOn,
  nextRaceDayFrom,
  parseSchedule,
  seriesDays,
  seriesOn,
  weekdayIndex,
  type Schedule,
} from './calendar';

/** schedule.py が実際に書き出した形（2026-08-10 取得） */
const RAW = JSON.stringify({
  schemaVersion: 1,
  venue: '住之江',
  updatedAt: '2026-08-10T09:45:00+09:00',
  raceDays: [
    '2026-08-04',
    '2026-08-05',
    '2026-08-06',
    '2026-08-07',
    '2026-08-08',
    '2026-08-09',
    '2026-08-13',
    '2026-08-14',
    '2026-08-15',
    '2026-08-16',
    '2026-08-17',
    '2026-08-18',
  ],
  nextRaceDay: '2026-08-13',
  series: [
    {
      name: 'にっぽん未来プロジェクト競走ｉｎ住之江',
      grade: '一般',
      start: '2026-08-04',
      end: '2026-08-09',
      days: 6,
    },
    {
      name: '大阪ダービー第４３回摂河泉競走',
      grade: '一般',
      start: '2026-08-13',
      end: '2026-08-18',
      days: 6,
    },
  ],
});

const SCHEDULE = parseSchedule(RAW) as Schedule;

describe('parseSchedule', () => {
  it('実際の出力を読める', () => {
    assert.equal(SCHEDULE.venue, '住之江');
    assert.equal(SCHEDULE.raceDays.length, 12);
    assert.equal(SCHEDULE.series.length, 2);
    assert.equal(SCHEDULE.nextRaceDay, '2026-08-13');
  });

  it('壊れた入力では null を返す（空の予定を作らない）', () => {
    assert.equal(parseSchedule('{'), null);
    assert.equal(parseSchedule('null'), null);
    assert.equal(parseSchedule('{"raceDays":[]}'), null, '開催日が空なら予定として扱わない');
  });

  it('日付の形式が違うものは落とす', () => {
    const parsed = parseSchedule(
      JSON.stringify({ raceDays: ['2026-08-13', '8/14', '', '2026-08-15'] }),
    );
    assert.deepEqual(parsed?.raceDays, ['2026-08-13', '2026-08-15']);
  });
});

describe('hasRaceOn', () => {
  it('開催日と非開催日を見分ける', () => {
    assert.equal(hasRaceOn(SCHEDULE, '2026-08-13'), true);
    assert.equal(hasRaceOn(SCHEDULE, '2026-08-10'), false);
  });

  it('予定が無ければ null。false（＝開催なし）にしない', () => {
    assert.equal(hasRaceOn(null, '2026-08-13'), null);
  });
});

describe('nextRaceDayFrom', () => {
  it('今日が開催日ならその日を返す', () => {
    assert.equal(nextRaceDayFrom(SCHEDULE, '2026-08-13'), '2026-08-13');
  });

  it('非開催日なら次の開催日', () => {
    assert.equal(nextRaceDayFrom(SCHEDULE, '2026-08-10'), '2026-08-13');
    assert.equal(nextRaceDayFrom(SCHEDULE, '2026-08-01'), '2026-08-04');
  });

  it('予定の先まで来ていれば null', () => {
    assert.equal(nextRaceDayFrom(SCHEDULE, '2026-08-19'), null);
  });
});

describe('seriesOn', () => {
  it('その日を含む節を返す', () => {
    assert.equal(seriesOn(SCHEDULE, '2026-08-09')?.name, 'にっぽん未来プロジェクト競走ｉｎ住之江');
    assert.equal(seriesOn(SCHEDULE, '2026-08-15')?.name, '大阪ダービー第４３回摂河泉競走');
  });

  it('節の外なら null', () => {
    assert.equal(seriesOn(SCHEDULE, '2026-08-11'), null);
  });
});

describe('daysUntil', () => {
  it('日数の差を返す', () => {
    assert.equal(daysUntil('2026-08-10', '2026-08-13'), 3);
    assert.equal(daysUntil('2026-08-13', '2026-08-13'), 0);
    assert.equal(daysUntil('2026-08-14', '2026-08-13'), -1);
  });

  it('月をまたいでも正しい', () => {
    assert.equal(daysUntil('2026-08-30', '2026-09-01'), 2);
  });

  it('夏時間や時差の影響を受けない（UTC基準で計算している）', () => {
    assert.equal(daysUntil('2026-03-01', '2026-03-31'), 30);
  });
});

describe('日付の計算（1日ずれを防ぐ）', () => {
  it('節の日付が初日から始まる', () => {
    // 画面に「1日目 8/3」と出す不具合を出した。初日は 8/4
    const days = seriesDays(SCHEDULE.series[0]);
    assert.equal(days[0], '2026-08-04');
    assert.equal(days.at(-1), '2026-08-09');
    assert.equal(days.length, 6);
  });

  it('addDays が日付をまたいでも正しい', () => {
    assert.equal(addDays('2026-08-31', 1), '2026-09-01');
    assert.equal(addDays('2026-01-01', -1), '2025-12-31');
    assert.equal(addDays('2026-08-04', 0), '2026-08-04');
  });

  it('曜日が正しい（2026-08-13 は木曜）', () => {
    assert.equal(weekdayIndex('2026-08-13'), 4);
    assert.equal(weekdayIndex('2026-08-09'), 0, '日曜');
  });

  it('うるう年をまたいでも正しい', () => {
    assert.equal(addDays('2028-02-28', 1), '2028-02-29');
    assert.equal(addDays('2028-02-29', 1), '2028-03-01');
  });
});
