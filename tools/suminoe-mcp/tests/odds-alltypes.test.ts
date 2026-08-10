/**
 * 3連単・3連複以外の賭式のオッズ解析。
 *
 * fixture は 2026-08-09 1R の実ページ。ネット接続なしで通る。
 *
 * **拡連複と複勝は幅（1.8-2.1）で出る。** 1つの数字に潰すと嘘になるので、
 * 両端をそのまま持てているかをここで固定する。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  parseOdds2f,
  parseOdds2t,
  parseOddsPlace,
  parseOddsWide,
  parseOddsWin,
} from '../lib/odds.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (name: string) => readFileSync(join(HERE, 'fixtures', name), 'utf8');

const H2TF = read('odds2tf.html');
const HK = read('oddsk.html');
const HTF = read('oddstf.html');

const find = (entries: { combo: number[]; odds: number | null; oddsMax?: number | null }[], combo: number[]) =>
  entries.find((e) => e.combo.join('-') === combo.join('-'));

describe('2連単', () => {
  const parsed = parseOdds2t(H2TF, '2026-08-09', 1)!;

  it('30通りすべて取れる', () => {
    expect(parsed.entries).toHaveLength(30);
  });

  it('着順が意味を持つ（1-2 と 2-1 は別）', () => {
    expect(find(parsed.entries, [1, 2])).toBeDefined();
    expect(find(parsed.entries, [2, 1])).toBeDefined();
    expect(find(parsed.entries, [1, 2])!.odds).not.toBe(find(parsed.entries, [2, 1])!.odds);
  });

  it('実ページの値と一致する（1-2 は 4.0倍）', () => {
    expect(find(parsed.entries, [1, 2])!.odds).toBe(4.0);
  });

  it('同じ艇の組み合わせは作らない', () => {
    expect(parsed.entries.every((e) => e.combo[0] !== e.combo[1])).toBe(true);
  });
});

describe('2連複', () => {
  const parsed = parseOdds2f(H2TF, '2026-08-09', 1)!;

  it('15通り。順不同なので重複しない', () => {
    expect(parsed.entries).toHaveLength(15);
  });

  it('組み合わせは昇順に正規化される', () => {
    expect(parsed.entries.every((e) => e.combo[0] < e.combo[1])).toBe(true);
  });
});

describe('拡連複', () => {
  const parsed = parseOddsWide(HK, '2026-08-09', 1)!;

  it('15通り取れる', () => {
    expect(parsed.entries).toHaveLength(15);
  });

  it('オッズが幅として取れる（1-2 は 1.8-2.1）', () => {
    const entry = find(parsed.entries, [1, 2])!;
    expect(entry.odds).toBe(1.8);
    expect(entry.oddsMax).toBe(2.1);
  });

  it('下限が上限を超えない', () => {
    for (const entry of parsed.entries) {
      if (entry.odds !== null && entry.oddsMax != null) {
        expect(entry.odds).toBeLessThanOrEqual(entry.oddsMax);
      }
    }
  });
});

describe('単勝・複勝', () => {
  it('単勝は6艇ぶん。1号艇は 2.0倍', () => {
    const parsed = parseOddsWin(HTF, '2026-08-09', 1)!;
    expect(parsed.entries).toHaveLength(6);
    expect(find(parsed.entries, [1])!.odds).toBe(2.0);
    expect(parsed.entries.every((e) => e.oddsMax === null)).toBe(true);
  });

  it('複勝は6艇ぶんで、幅を持つ', () => {
    const parsed = parseOddsPlace(HTF, '2026-08-09', 1)!;
    expect(parsed.entries).toHaveLength(6);
    expect(parsed.entries.some((e) => e.oddsMax !== null)).toBe(true);
  });
});

describe('発売前・空のページ', () => {
  it('中身が無ければ null（空の結果を作らない）', () => {
    expect(parseOdds2t('', '2026-08-09', 1)).toBeNull();
    expect(parseOddsWide('<html><body></body></html>', '2026-08-09', 1)).toBeNull();
  });
});
