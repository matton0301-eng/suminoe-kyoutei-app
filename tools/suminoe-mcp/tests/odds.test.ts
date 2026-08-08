import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseOdds3t } from '../lib/odds.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const filled = readFileSync(join(HERE, 'fixtures', 'odds3t.html'), 'utf-8');
const empty = readFileSync(join(HERE, 'fixtures', 'odds3t-empty.html'), 'utf-8');

function oddsOf(html: string, combo: [number, number, number]): number | null | undefined {
  const parsed = parseOdds3t(html, '2026-08-08', 12);
  return parsed?.entries.find((entry) => entry.combo.join('-') === combo.join('-'))?.odds;
}

describe('parseOdds3t', () => {
  it('3連単の全120通りを読む', () => {
    const parsed = parseOdds3t(filled, '2026-08-08', 12);
    expect(parsed?.entries).toHaveLength(120);
    expect(parsed?.date).toBe('2026-08-08');
    expect(parsed?.raceNo).toBe(12);
    expect(parsed?.betType).toBe('trifecta');
  });

  it('組み合わせとオッズが正しく対応する', () => {
    // 1-5-3 は 8/8 12R の実際の着順。確定配当 2,180円 = オッズ 21.8 と一致する
    expect(oddsOf(filled, [1, 5, 3])).toBe(21.8);
    expect(oddsOf(filled, [1, 2, 3])).toBe(22.2);
    expect(oddsOf(filled, [2, 1, 3])).toBe(163.1);
    expect(oddsOf(filled, [6, 5, 4])).toBe(332.0);
    expect(oddsOf(filled, [3, 1, 6])).toBe(130.7);
  });

  it('同じ艇番が重複する組み合わせを作らない', () => {
    const parsed = parseOdds3t(filled, '2026-08-08', 12);
    for (const entry of parsed?.entries ?? []) {
      expect(new Set(entry.combo).size).toBe(3);
    }
  });

  it('1着艇ごとに20通りずつある', () => {
    const parsed = parseOdds3t(filled, '2026-08-08', 12);
    for (const first of [1, 2, 3, 4, 5, 6]) {
      const count = parsed?.entries.filter((entry) => entry.combo[0] === first).length;
      expect(count).toBe(20);
    }
  });

  it('発売前のページ（オッズが空）は null', () => {
    expect(parseOdds3t(empty, '2026-08-09', 1)).toBeNull();
  });

  it('HTML でないものは null', () => {
    expect(parseOdds3t('', '2026-08-08', 12)).toBeNull();
    expect(parseOdds3t('<html><body>hello</body></html>', '2026-08-08', 12)).toBeNull();
  });

  it('取得時刻を ISO で持つ', () => {
    const parsed = parseOdds3t(filled, '2026-08-08', 12);
    expect(parsed?.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
