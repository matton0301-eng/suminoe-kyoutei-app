import { describe, expect, it } from 'vitest';

import { aggregateDays, summarizeDay, type DayInput } from './multiTally';
import type { DayTally } from './tally';
import type { Boat, RaceLog } from './types';

function fakeTally(overrides: Partial<DayTally>): DayTally {
  return {
    date: '2026-08-07',
    racesTotal: 12,
    racesFinished: 12,
    insideWon: 7,
    insideWonRate: 58.3,
    byBetType: [],
    byVerdict: [],
    perRace: [],
    investedYen: 27600,
    returnedYen: 18170,
    balanceYen: -9430,
    recoveryRate: 65.8,
    unitYen: 2300,
    ...overrides,
  };
}

function fakeLog(raceNo: number, predicted: Boat | null, resultFirst: Boat | null): RaceLog {
  return {
    id: `log-${raceNo}`,
    raceNo,
    predictedFirst: predicted,
    tenjiFast: null,
    resultFirst,
    resultSecond: null,
    resultThird: null,
    kimarite: null,
    suimen: null,
    memo: '',
    savedAt: '2026-08-07T12:00:00.000Z',
  };
}

describe('summarizeDay', () => {
  it('tally が null なら null（結果の無い日は通算に入れない）', () => {
    expect(summarizeDay({ date: '2026-08-09', tally: null, logs: [] })).toBeNull();
  });

  it('記録が無い日は予想指標を null にする', () => {
    const summary = summarizeDay({ date: '2026-08-07', tally: fakeTally({}), logs: [] });
    expect(summary?.predictionHit).toBeNull();
    expect(summary?.predictionTotal).toBeNull();
    expect(summary?.investedYen).toBe(27600);
    expect(summary?.racesFinished).toBe(12);
  });

  it('記録がある日は予想の的中を数える', () => {
    const logs = [fakeLog(1, 1, 1), fakeLog(2, 1, 2), fakeLog(3, null, 1)];
    const summary = summarizeDay({ date: '2026-08-07', tally: fakeTally({}), logs });
    expect(summary?.predictionHit).toBe(1); // 1R のみ的中
    expect(summary?.predictionTotal).toBe(2); // 3R は予想が無いので母数に入れない
  });

  it('予想が全部欠けている記録なら母数 0 として扱い、的中も 0', () => {
    const summary = summarizeDay({
      date: '2026-08-07',
      tally: fakeTally({}),
      logs: [fakeLog(1, null, 1)],
    });
    expect(summary?.predictionTotal).toBe(0);
    expect(summary?.predictionHit).toBe(0);
  });
});

describe('aggregateDays', () => {
  const day1: DayInput = {
    date: '2026-08-07',
    tally: fakeTally({
      byBetType: [
        {
          key: 'win',
          name: '単勝',
          races: 12,
          hitRaces: 7,
          hitRate: 58.3,
          tickets: 12,
          investedYen: 1200,
          returnedYen: 1460,
          balanceYen: 260,
          recoveryRate: 121.7,
          best: { raceNo: 5, ticket: [3], amount: 890 },
        },
      ],
      byVerdict: [
        {
          verdict: '勝負',
          races: 2,
          insideWon: 2,
          anchorWon: 2,
          investedYen: 4600,
          returnedYen: 4000,
          balanceYen: -600,
        },
      ],
    }),
    logs: [],
  };

  const day2: DayInput = {
    date: '2026-08-08',
    tally: fakeTally({
      date: '2026-08-08',
      investedYen: 27600,
      returnedYen: 15610,
      balanceYen: -11990,
      insideWon: 8,
      byBetType: [
        {
          key: 'win',
          name: '単勝',
          races: 12,
          hitRaces: 7,
          hitRate: 58.3,
          tickets: 12,
          investedYen: 1200,
          returnedYen: 990,
          balanceYen: -210,
          recoveryRate: 82.5,
          best: { raceNo: 8, ticket: [1], amount: 190 },
        },
      ],
      byVerdict: [
        {
          verdict: '勝負',
          races: 6,
          insideWon: 5,
          anchorWon: 5,
          investedYen: 13800,
          returnedYen: 6960,
          balanceYen: -6840,
        },
      ],
    }),
    logs: [],
  };

  it('全体を合算し recoveryRate を出し直す', () => {
    const total = aggregateDays([day1, day2]);
    expect(total.totalDays).toBe(2);
    expect(total.racesFinished).toBe(24);
    expect(total.investedYen).toBe(55200);
    expect(total.returnedYen).toBe(33780);
    expect(total.balanceYen).toBe(-21420);
    expect(total.insideWon).toBe(15);
    expect(total.recoveryRate).toBeCloseTo((33780 / 55200) * 100, 5);
    expect(total.insideWonRate).toBeCloseTo((15 / 24) * 100, 5);
  });

  it('賭式別を key ごとにマージし、best は金額の大きい方を日付つきで残す', () => {
    const total = aggregateDays([day1, day2]);
    const win = total.byBetType.find((entry) => entry.key === 'win');
    expect(win?.races).toBe(24);
    expect(win?.hitRaces).toBe(14);
    expect(win?.tickets).toBe(24);
    expect(win?.investedYen).toBe(2400);
    expect(win?.returnedYen).toBe(2450);
    expect(win?.balanceYen).toBe(50);
    expect(win?.hitRate).toBeCloseTo((14 / 24) * 100, 5);
    expect(win?.recoveryRate).toBeCloseTo((2450 / 2400) * 100, 5);
    expect(win?.best).toEqual({ raceNo: 5, ticket: [3], amount: 890 });
    expect(win?.bestDate).toBe('2026-08-07');
  });

  it('判定別を verdict ごとにマージする', () => {
    const total = aggregateDays([day1, day2]);
    const shobu = total.byVerdict.find((entry) => entry.verdict === '勝負');
    expect(shobu?.races).toBe(8);
    expect(shobu?.insideWon).toBe(7);
    expect(shobu?.anchorWon).toBe(7);
    expect(shobu?.investedYen).toBe(18400);
    expect(shobu?.returnedYen).toBe(10960);
    expect(shobu?.balanceYen).toBe(-7440);
  });

  it('tally の無い日は無視し、days は日付降順', () => {
    const total = aggregateDays([{ date: '2026-08-09', tally: null, logs: [] }, day1, day2]);
    expect(total.totalDays).toBe(2);
    expect(total.days.map((day) => day.date)).toEqual(['2026-08-08', '2026-08-07']);
  });

  it('賭式別は回収率の高い順に並べる', () => {
    const withTwo: DayInput = {
      date: '2026-08-08',
      tally: fakeTally({
        byBetType: [
          {
            key: 'win',
            name: '単勝',
            races: 12,
            hitRaces: 7,
            hitRate: 58.3,
            tickets: 12,
            investedYen: 1200,
            returnedYen: 600,
            balanceYen: -600,
            recoveryRate: 50,
            best: null,
          },
          {
            key: 'place',
            name: '複勝',
            races: 12,
            hitRaces: 10,
            hitRate: 83.3,
            tickets: 12,
            investedYen: 1200,
            returnedYen: 1800,
            balanceYen: 600,
            recoveryRate: 150,
            best: null,
          },
        ],
      }),
      logs: [],
    };
    const total = aggregateDays([withTwo]);
    expect(total.byBetType.map((entry) => entry.key)).toEqual(['place', 'win']);
  });

  it('対象が1日も無ければ空の集計を返す', () => {
    const total = aggregateDays([{ date: '2026-08-09', tally: null, logs: [] }]);
    expect(total.totalDays).toBe(0);
    expect(total.days).toEqual([]);
    expect(total.recoveryRate).toBeNull();
    expect(total.insideWonRate).toBeNull();
    expect(total.byBetType).toEqual([]);
  });

  it('記録のある日だけを集めて通算の予想的中を出す', () => {
    const dayWithLogs: DayInput = {
      ...day1,
      logs: [fakeLog(1, 1, 1), fakeLog(2, 2, 2), fakeLog(3, 1, 3)],
    };
    const total = aggregateDays([dayWithLogs, day2]);
    expect(total.predictionHit).toBe(2);
    expect(total.predictionTotal).toBe(3);
    expect(total.predictionRate).toBeCloseTo((2 / 3) * 100, 5);
  });

  it('どの日にも記録が無ければ通算の予想指標は null', () => {
    const total = aggregateDays([day1, day2]);
    expect(total.predictionHit).toBeNull();
    expect(total.predictionTotal).toBeNull();
    expect(total.predictionRate).toBeNull();
  });
});
