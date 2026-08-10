/**
 * レース結果ページの解析。
 *
 * fixture は 2026-08-09 8R の実ページ（着順 1-3-5、3連複770円）と、
 * まだ行われていないレースのページ。
 *
 * **終わっていないレースをエラーにしない**ことが要。レース前は毎回そうなる。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseRaceResult, raceResultUrl } from '../lib/raceresult.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (name: string) => readFileSync(join(HERE, 'fixtures', name), 'utf8');

const DONE = parseRaceResult(read('raceresult_20260809_8r.html'), 8);
const PENDING = parseRaceResult(read('raceresult_pending.html'), 12);

describe('終わったレース', () => {
  it('着順を読める（8R は 1-3-5）', () => {
    expect(DONE.ok).toBe(true);
    expect(DONE.order).toEqual([1, 3, 5]);
  });

  it('決まり手を読める', () => {
    expect(DONE.kimarite).toBe('逃げ');
  });

  it('水面の状況を読める（手入力の代わりになる）', () => {
    expect(DONE.waveCm).toBe(1);
    expect(DONE.windM).toBe(2);
  });

  it('払戻を読める（3連複 770円 / 3連単 1150円）', () => {
    const trio = DONE.payouts.find((entry) => entry.key === 'trio');
    const trifecta = DONE.payouts.find((entry) => entry.key === 'trifecta');
    expect(trio?.amount).toBe(770);
    expect(trio?.combo).toEqual([1, 3, 5]);
    expect(trifecta?.amount).toBe(1150);
  });

  it('拡連複は1レースに3通りある', () => {
    const wide = DONE.payouts.filter((entry) => entry.key === 'wide');
    expect(wide.length).toBe(3);
  });

  it('7賭式すべての払戻がある', () => {
    const keys = new Set(DONE.payouts.map((entry) => entry.key));
    for (const key of ['trifecta', 'trio', 'exacta', 'quinella', 'wide', 'win', 'place']) {
      expect(keys.has(key as never)).toBe(true);
    }
  });
});

describe('まだ終わっていないレース', () => {
  it('エラーにせず ok: false を返す', () => {
    expect(PENDING.ok).toBe(false);
    expect(PENDING.payouts).toEqual([]);
    expect(PENDING.order).toEqual([]);
  });
});

describe('URL', () => {
  it('住之江のレース結果を指す', () => {
    expect(raceResultUrl('2026-08-09', 8)).toContain('rno=8&jcd=12&hd=20260809');
  });
});
