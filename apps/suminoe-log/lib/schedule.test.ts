/**
 * 締切スケジュールと展示反映のテスト。
 *
 * 締切時刻は現地の操作を減らすために使う。判定を間違えると
 * 「終わったレースの買い目を見ている」ことになるので、境界を厳密に確かめる。
 */

import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import type { CardRace } from './raceCard';
import {
  formatMinutesLeft,
  isUrgent,
  minutesUntil,
  parseDeadlineMinutes,
  resolveSchedule,
} from './schedule';


function makeRace(raceNo: number, deadline: string): CardRace {
  return {
    raceNo,
    name: '予選',
    distanceM: 1800,
    deadline,
    ok: true,
    inConfidence: '中',
    inReason: null,
    upsetRisk: '中',
    upsetReason: null,
    verdict: '標準',
    verdictReason: null,
    betShape: null,
    motorPicks: [],
    notes: [],
    boats: [],
  };
}

/** 住之江のナイターに近い締切の並び */
const RACES = [
  makeRace(1, '15:17'),
  makeRace(2, '15:45'),
  makeRace(3, '16:10'),
  makeRace(11, '19:56'),
  makeRace(12, '20:30'),
];

function at(hours: number, minutes: number): Date {
  const d = new Date(2026, 7, 7, hours, minutes, 0);
  return d;
}

describe('parseDeadlineMinutes', () => {
  it('時刻を分に直す', () => {
    assert.equal(parseDeadlineMinutes('15:17'), 15 * 60 + 17);
    assert.equal(parseDeadlineMinutes('9:05'), 9 * 60 + 5);
    assert.equal(parseDeadlineMinutes('00:00'), 0);
  });

  it('読めない値は null', () => {
    assert.equal(parseDeadlineMinutes(''), null);
    assert.equal(parseDeadlineMinutes('—'), null);
    assert.equal(parseDeadlineMinutes('25:00'), null);
    assert.equal(parseDeadlineMinutes('15:70'), null);
  });
});

describe('resolveSchedule', () => {
  it('開催前は最初のレースを指す', () => {
    const s = resolveSchedule(RACES, at(12, 0));
    assert.equal(s.currentRaceNo, 1);
    assert.equal(s.minutesLeft, 197);
    assert.equal(s.closed, false);
    assert.equal(s.finishedCount, 0);
  });

  it('締切前は次に締切が来るレースを指す', () => {
    const s = resolveSchedule(RACES, at(15, 40));
    assert.equal(s.currentRaceNo, 2, '1Rの締切を過ぎたら2Rを指すべき');
    assert.equal(s.minutesLeft, 5);
    assert.equal(s.finishedCount, 1);
  });

  it('締切と同じ分はもう締め切られたものとして次に進む', () => {
    const s = resolveSchedule(RACES, at(15, 17));
    assert.equal(s.currentRaceNo, 2);
    assert.equal(s.finishedCount, 1);
  });

  it('全部終わったあとは最後のレースを指し、closed になる', () => {
    const s = resolveSchedule(RACES, at(21, 0));
    assert.equal(s.currentRaceNo, 12);
    assert.equal(s.closed, true);
    assert.equal(s.finishedCount, 5);
    assert.ok(s.minutesLeft !== null && s.minutesLeft < 0);
  });

  it('締切が読めないレースだけなら先頭を返す', () => {
    const s = resolveSchedule([makeRace(1, '—')], at(15, 0));
    assert.equal(s.currentRaceNo, 1);
    assert.equal(s.minutesLeft, null);
  });

  it('レースが無ければ null', () => {
    const s = resolveSchedule([], at(15, 0));
    assert.equal(s.currentRaceNo, null);
  });
});

describe('formatMinutesLeft / isUrgent', () => {
  it('残り時間を読める形にする', () => {
    assert.equal(formatMinutesLeft(0), 'まもなく締切');
    assert.equal(formatMinutesLeft(12), '締切まで12分');
    assert.equal(formatMinutesLeft(60), '締切まで1時間');
    assert.equal(formatMinutesLeft(95), '締切まで1時間35分');
    assert.equal(formatMinutesLeft(-3), '締切済み');
    assert.equal(formatMinutesLeft(null), null);
  });

  it('5分以内を急ぎと見なす', () => {
    assert.equal(isUrgent(5), true);
    assert.equal(isUrgent(6), false);
    assert.equal(isUrgent(-1), false, '締切済みは急ぎ扱いしない');
    assert.equal(isUrgent(null), false);
  });
});

// --- 展示反映 ---



/**
 * 出走表の日付を見ずに時刻だけで比べると、前日のレースが「まもなく締切」になる。
 * 2026-08-10 の 16:18 に、前日（8/9）の4R（16:28締切）が
 * 「締切10分」と表示された。実機で踏んだ不具合。
 */
describe('前日の出走表を今日のものとして扱わない', () => {
  const races = [
    { raceNo: 1, deadline: '15:17' },
    { raceNo: 4, deadline: '16:28' },
    { raceNo: 12, deadline: '20:30' },
  ] as CardRace[];

  /** 8/10 16:18 */
  const now = new Date(2026, 7, 10, 16, 18);

  it('前日の出走表なら、すべて締切済みになる', () => {
    const schedule = resolveSchedule(races, now, '2026-08-09');
    assert.equal(schedule.closed, true);
    assert.equal(schedule.finishedCount, 3);
    assert.ok((schedule.minutesLeft ?? 0) < 0);
  });

  it('前日のレースの残り時間は必ず負になる', () => {
    assert.ok((minutesUntil('16:28', now, '2026-08-09') ?? 0) < 0, '「あと10分」にしない');
    assert.equal(minutesUntil('16:28', now, '2026-08-09'), 10 - 1440);
  });

  it('当日なら従来どおり', () => {
    assert.equal(minutesUntil('16:28', now, '2026-08-10'), 10);
    const schedule = resolveSchedule(races, now, '2026-08-10');
    assert.equal(schedule.currentRaceNo, 4);
    assert.equal(schedule.closed, false);
  });

  it('翌日の出走表なら、まだ全部これから', () => {
    const schedule = resolveSchedule(races, now, '2026-08-11');
    assert.equal(schedule.currentRaceNo, 1);
    assert.equal(schedule.finishedCount, 0);
    assert.ok((schedule.minutesLeft ?? 0) > 0);
  });

  it('日付を渡さなければ今日として扱う（従来の呼び出しを壊さない）', () => {
    assert.equal(minutesUntil('16:28', now), 10);
  });

  it('締切済みの表示になる', () => {
    assert.equal(formatMinutesLeft(minutesUntil('16:28', now, '2026-08-09')), '締切済み');
  });
});
