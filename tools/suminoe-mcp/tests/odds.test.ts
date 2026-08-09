import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseOdds3f, parseOdds3t } from '../lib/odds.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const filled = readFileSync(join(HERE, 'fixtures', 'odds3t.html'), 'utf-8');
const empty = readFileSync(join(HERE, 'fixtures', 'odds3t-empty.html'), 'utf-8');
/** 2026-08-08 1R の3連複。着順は 1-4-6 で、確定配当は 1,450円 */
const trio = readFileSync(join(HERE, 'fixtures', 'odds3f.html'), 'utf-8');

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

describe('parseOdds3f', () => {
  const trioOddsOf = (combo: [number, number, number]): number | null | undefined =>
    parseOdds3f(trio, '2026-08-08', 1)?.entries.find(
      (entry) => entry.combo.join('-') === combo.join('-'),
    )?.odds;

  it('3連複の全20通りを読む', () => {
    const parsed = parseOdds3f(trio, '2026-08-08', 1);
    expect(parsed?.entries).toHaveLength(20);
    expect(parsed?.betType).toBe('trio');
  });

  it('実際の払戻と一致する', () => {
    // 8/8 1R の着順は 1-4-6、3連複の確定配当は 1,450円 = オッズ 14.5
    expect(trioOddsOf([1, 4, 6])).toBe(14.5);
  });

  it('組み合わせとオッズが正しく対応する', () => {
    expect(trioOddsOf([1, 2, 3])).toBe(8.2);
    expect(trioOddsOf([1, 2, 4])).toBe(3.9);
    expect(trioOddsOf([2, 3, 4])).toBe(9.4);
    expect(trioOddsOf([3, 4, 5])).toBe(37.8);
    expect(trioOddsOf([4, 5, 6])).toBe(15.8);
  });

  it('組み合わせは昇順に均され、重複しない', () => {
    const parsed = parseOdds3f(trio, '2026-08-08', 1);
    const keys = new Set<string>();
    for (const entry of parsed?.entries ?? []) {
      expect([...entry.combo].sort((a, b) => a - b)).toEqual(entry.combo);
      expect(new Set(entry.combo).size).toBe(3);
      keys.add(entry.combo.join('-'));
    }
    expect(keys.size).toBe(20);
  });

  it('まだ売れていない組み合わせ（0.0）は null にする', () => {
    // 0倍という払戻は存在しない。0 のまま通すと期待値が 0 になり、
    // 「買ってはいけない買い目」と誤って扱われる
    const parsed = parseOdds3f(trio, '2026-08-08', 1);
    for (const entry of parsed?.entries ?? []) {
      expect(entry.odds === null || entry.odds > 0).toBe(true);
    }
  });

  it('20通り揃わなければ null', () => {
    // 欠けたまま返すと「買えない」のか「読めていない」のか区別できなくなる
    expect(parseOdds3f(empty, '2026-08-09', 1)).toBeNull();
    expect(parseOdds3f('', '2026-08-08', 1)).toBeNull();
    expect(parseOdds3f(filled, '2026-08-08', 12)).toBeNull();
  });
});
