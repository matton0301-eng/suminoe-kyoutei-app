import { describe, expect, it } from 'vitest';

import {
  computeTally,
  listDays,
  readCard,
  readResults,
  readReviewMarkdown,
} from '../lib/data.js';

describe('listDays', () => {
  it('アーカイブにある開催日を新しい順で返す', () => {
    const days = listDays();
    expect(days.length).toBeGreaterThanOrEqual(2);
    expect(days[0].date >= days[1].date).toBe(true);
    const day = days.find((entry) => entry.date === '2026-08-08');
    expect(day).toEqual({ date: '2026-08-08', hasCard: true, hasResults: true, hasReview: true });
  });
});

describe('readCard', () => {
  it('出走表を12レース読める', () => {
    expect(readCard('2026-08-08')?.races).toHaveLength(12);
  });

  it('存在しない日付は null', () => {
    expect(readCard('1999-01-01')).toBeNull();
  });

  it('日付形式でない入力は null（パスを組み立てない）', () => {
    expect(readCard('../../../etc/passwd')).toBeNull();
    expect(readCard('20260808')).toBeNull();
    expect(readCard('')).toBeNull();
  });
});

describe('readResults', () => {
  it('結果を12レース読める', () => {
    const results = readResults('2026-08-08');
    expect(results?.races).toHaveLength(12);
    expect(results?.races[11].order).toEqual([1, 5, 3]);
  });

  it('日付形式でない入力は null', () => {
    expect(readResults('..')).toBeNull();
  });
});

describe('computeTally', () => {
  it('アプリと同じ収支計算になる（8/8 は投資27,600円・払戻15,610円）', () => {
    const tally = computeTally('2026-08-08');
    expect(tally?.investedYen).toBe(27600);
    expect(tally?.returnedYen).toBe(15610);
    expect(tally?.racesFinished).toBe(12);
  });

  it('結果の無い日は null', () => {
    expect(computeTally('1999-01-01')).toBeNull();
  });
});

describe('readReviewMarkdown', () => {
  it('照合レポートの全文を読める', () => {
    const md = readReviewMarkdown('2026-08-08');
    expect(md).toContain('2026-08-08');
    expect(md).toContain('判定ごとの結果');
  });

  it('存在しない日付は null', () => {
    expect(readReviewMarkdown('1999-01-01')).toBeNull();
  });
});
