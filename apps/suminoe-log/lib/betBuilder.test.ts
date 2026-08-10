/**
 * 買い目の組み立てのテスト。
 *
 * ここは金額と並んで「記録として残る」側。**中途半端な買い目を確定させない**ことと、
 * 着順あり／順不同で挙動が変わることを固定する。
 */

import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  BET_TYPE_SPECS,
  formatSelection,
  isComplete,
  normalizeCombo,
  placeOf,
  specOf,
  toggleBoat,
} from './betBuilder';
import type { Boat } from './types';

const trifecta = specOf('trifecta');
const trio = specOf('trio');
const win = specOf('win');

describe('賭式の定義', () => {
  it('7賭式すべてある', () => {
    assert.equal(BET_TYPE_SPECS.length, 7);
  });

  it('必要な艇数が正しい', () => {
    assert.equal(specOf('trifecta').size, 3);
    assert.equal(specOf('trio').size, 3);
    assert.equal(specOf('exacta').size, 2);
    assert.equal(specOf('quinella').size, 2);
    assert.equal(specOf('wide').size, 2);
    assert.equal(specOf('win').size, 1);
    assert.equal(specOf('place').size, 1);
  });

  it('着順が意味を持つのは3連単・2連単・単勝だけ', () => {
    const ordered = BET_TYPE_SPECS.filter((s) => s.ordered).map((s) => s.key);
    assert.deepEqual(ordered.sort(), ['exacta', 'trifecta', 'win']);
  });
});

describe('toggleBoat（着順あり）', () => {
  it('押した順に積む', () => {
    let selected: Boat[] = [];
    selected = toggleBoat(selected, 1, trifecta);
    selected = toggleBoat(selected, 4, trifecta);
    selected = toggleBoat(selected, 6, trifecta);
    assert.deepEqual(selected, [1, 4, 6]);
  });

  it('もう一度押すと外れ、後ろが繰り上がる', () => {
    const selected = toggleBoat([1, 4, 6], 4, trifecta);
    assert.deepEqual(selected, [1, 6], '4を外すと6が2着目になる');
  });

  it('必要数を超えて足さない', () => {
    const selected = toggleBoat([1, 4, 6], 2, trifecta);
    assert.deepEqual(selected, [1, 4, 6], '3艇そろっていれば増えない');
  });

  it('同じ艇を2回入れない', () => {
    const selected = toggleBoat([1], 1, trifecta);
    assert.deepEqual(selected, [], '押し直しは解除');
  });
});

describe('toggleBoat（順不同）', () => {
  it('押した順は保たれるが、意味を持たない', () => {
    let selected: Boat[] = [];
    selected = toggleBoat(selected, 6, trio);
    selected = toggleBoat(selected, 1, trio);
    selected = toggleBoat(selected, 4, trio);
    assert.deepEqual(normalizeCombo(selected, trio), [1, 4, 6]);
  });

  it('上限で止まる', () => {
    assert.deepEqual(toggleBoat([1, 2, 3], 4, trio), [1, 2, 3]);
  });
});

describe('isComplete', () => {
  it('艇数がちょうど揃ったときだけ追加できる', () => {
    assert.equal(isComplete([1, 4], trifecta), false, '2艇では足りない');
    assert.equal(isComplete([1, 4, 6], trifecta), true);
    assert.equal(isComplete([1], win), true);
    assert.equal(isComplete([], win), false);
  });
});

describe('normalizeCombo', () => {
  it('着順ありはそのまま', () => {
    assert.deepEqual(normalizeCombo([6, 1, 4], trifecta), [6, 1, 4]);
  });

  it('順不同は昇順にする（同じ買い目を二重に持たないため）', () => {
    assert.deepEqual(normalizeCombo([6, 1, 4], trio), [1, 4, 6]);
  });
});

describe('formatSelection', () => {
  it('着順ありは「-」、順不同は「=」でつなぐ', () => {
    assert.equal(formatSelection([1, 4, 6], trifecta), '1-4-6');
    assert.equal(formatSelection([6, 1, 4], trio), '1=4=6');
  });

  it('揃っていない分は ? で埋める（何艇足りないか分かる）', () => {
    assert.equal(formatSelection([1], trifecta), '1-?-?');
    assert.equal(formatSelection([], trio), '?=?=?');
  });
});

describe('placeOf', () => {
  it('着順ありなら何着目かを返す', () => {
    assert.equal(placeOf([1, 4, 6], 1, trifecta), 1);
    assert.equal(placeOf([1, 4, 6], 6, trifecta), 3);
    assert.equal(placeOf([1, 4, 6], 2, trifecta), null);
  });

  it('順不同では着順を出さない（意味が無いため）', () => {
    assert.equal(placeOf([1, 4, 6], 1, trio), null);
  });
});
