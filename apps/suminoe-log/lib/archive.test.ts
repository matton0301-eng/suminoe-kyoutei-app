import { describe, expect, it } from 'vitest';

import { archiveCardUrl, archiveResultsUrl, mergeDayEntries, parseArchiveIndex } from './archive';

const VALID_INDEX = JSON.stringify({
  schemaVersion: 1,
  days: [
    { date: '2026-08-08', hasCard: true, hasResults: true, hasTenji: true },
    { date: '2026-08-07', hasCard: true, hasResults: false, hasTenji: false },
  ],
});

describe('parseArchiveIndex', () => {
  it('正常な index を読める', () => {
    const days = parseArchiveIndex(VALID_INDEX);
    expect(days).toHaveLength(2);
    expect(days[0]).toEqual({
      date: '2026-08-08',
      hasCard: true,
      hasResults: true,
      hasTenji: true,
    });
  });

  it('JSON として壊れていれば空を返す', () => {
    expect(parseArchiveIndex('{oops')).toEqual([]);
  });

  it('schemaVersion が違えば空を返す', () => {
    expect(parseArchiveIndex(JSON.stringify({ schemaVersion: 2, days: [] }))).toEqual([]);
  });

  it('日付形式が不正な要素は捨てる', () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      days: [
        { date: '2026/08/07', hasCard: true, hasResults: true },
        { date: '2026-08-08', hasCard: true, hasResults: true, hasTenji: true },
        { date: 20260806, hasCard: true, hasResults: true },
      ],
    });
    expect(parseArchiveIndex(raw)).toEqual([
      { date: '2026-08-08', hasCard: true, hasResults: true, hasTenji: true },
    ]);
  });

  it('hasTenji の無い古い index も読める', () => {
    // 直前情報を足す前に生成された index.json が端末に残っていることがある
    const raw = JSON.stringify({
      schemaVersion: 1,
      days: [{ date: '2026-08-07', hasCard: true, hasResults: true }],
    });
    expect(parseArchiveIndex(raw)).toEqual([
      { date: '2026-08-07', hasCard: true, hasResults: true, hasTenji: false },
    ]);
  });
});

describe('mergeDayEntries', () => {
  it('アーカイブと記録の日付を統合して降順に並べる', () => {
    const archive = [
      { date: '2026-08-07', hasCard: true, hasResults: true, hasTenji: false },
      { date: '2026-08-08', hasCard: true, hasResults: true, hasTenji: true },
    ];
    const entries = mergeDayEntries(archive, { '2026-08-09': 3 });
    expect(entries.map((entry) => entry.date)).toEqual(['2026-08-09', '2026-08-08', '2026-08-07']);
    expect(entries[0]).toEqual({
      date: '2026-08-09',
      hasCard: false,
      hasResults: false,
      hasTenji: false,
      logCount: 3,
    });
  });

  it('同じ日付は1行にまとめて記録件数を付ける', () => {
    const archive = [{ date: '2026-08-08', hasCard: true, hasResults: true, hasTenji: true }];
    const entries = mergeDayEntries(archive, { '2026-08-08': 5 });
    expect(entries).toEqual([
      { date: '2026-08-08', hasCard: true, hasResults: true, hasTenji: true, logCount: 5 },
    ]);
  });

  it('記録側の不正な日付キーは捨てる', () => {
    const entries = mergeDayEntries([], { 'not-a-date': 2, '2026-08-07': 1 });
    expect(entries).toEqual([
      { date: '2026-08-07', hasCard: false, hasResults: false, hasTenji: false, logCount: 1 },
    ]);
  });
});

describe('archive URL', () => {
  it('日付付きのパスを組み立てる', () => {
    expect(archiveCardUrl('2026-08-07')).toBe('/archive/racecard-20260807.json');
    expect(archiveResultsUrl('2026-08-07')).toBe('/archive/results-20260807.json');
  });
});
