/**
 * 買い目の組み立てのテスト。
 *
 * **公式のマークシートと同じ形になっているか**が主眼。
 * ボックスの点数は、フォーメーション／ボックス用カードに刷ってある点数表を
 * そのまま答え合わせに使う（ここを間違えると買った点数と金額がずれる）。
 */

import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  BET_TYPE_SPECS,
  boxPoints,
  emptySlots,
  expandBox,
  expandFormation,
  formatSelection,
  isComplete,
  normalizeCombo,
  setSlot,
  slotLabel,
  specOf,
} from './betBuilder';
import type { Boat } from './types';

const trifecta = specOf('trifecta');
const trio = specOf('trio');
const exacta = specOf('exacta');
const quinella = specOf('quinella');
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

describe('着順の欄（マークシートと同じ形）', () => {
  it('欄に艇を入れる', () => {
    let slots = emptySlots(trifecta);
    slots = setSlot(slots, 0, 1);
    slots = setSlot(slots, 1, 4);
    slots = setSlot(slots, 2, 6);
    assert.deepEqual(slots, [1, 4, 6]);
  });

  it('同じ艇を2つの欄に入れられない（カードでも2か所は塗れない）', () => {
    let slots = emptySlots(trifecta);
    slots = setSlot(slots, 0, 1);
    slots = setSlot(slots, 1, 1);
    assert.deepEqual(slots, [null, 1, null], '前の欄から外れる');
  });

  it('同じ欄の同じ艇をもう一度押すと取り消し', () => {
    assert.deepEqual(setSlot([1, 4, 6], 1, 4), [1, null, 6]);
  });

  it('空の欄は賭式ぶんだけ作られる', () => {
    assert.equal(emptySlots(trifecta).length, 3);
    assert.equal(emptySlots(exacta).length, 2);
    assert.equal(emptySlots(win).length, 1);
  });

  it('欄の見出しはカードと同じ「◯着」', () => {
    assert.equal(slotLabel(0, trifecta), '1着');
    assert.equal(slotLabel(2, trifecta), '3着');
    assert.equal(slotLabel(0, trio), '1着', '順不同でもカードは着順欄を使う');
  });
});

describe('isComplete', () => {
  it('全部の欄が埋まって初めて追加できる', () => {
    assert.equal(isComplete([1, 4, null], trifecta), false);
    assert.equal(isComplete([1, 4, 6], trifecta), true);
    assert.equal(isComplete([1], win), true);
    assert.equal(isComplete([null], win), false);
  });
});

describe('normalizeCombo', () => {
  it('着順ありは欄の順のまま', () => {
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

  it('空欄は ? で出す（どこが足りないか分かる）', () => {
    assert.equal(formatSelection([1, null, null], trifecta), '1-?-?');
    assert.equal(formatSelection([null, null, null], trio), '?=?=?');
  });
});

/**
 * 公式のフォーメーション／ボックス用カードに刷ってある点数表:
 *
 *   マーク数   3艇  4艇  5艇  6艇
 *   3連単       6   24   60  120
 *   3連複       1    4   10   20
 *   2連単       6   12   20   30
 *   2連複       3    6   10   15
 */
describe('ボックスの点数（公式カードの表と一致すること）', () => {
  const table: [ReturnType<typeof specOf>, number[]][] = [
    [trifecta, [6, 24, 60, 120]],
    [trio, [1, 4, 10, 20]],
    [exacta, [6, 12, 20, 30]],
    [quinella, [3, 6, 10, 15]],
  ];

  it('点数が公式の表と一致する', () => {
    for (const [spec, expected] of table) {
      for (const [index, count] of [3, 4, 5, 6].entries()) {
        assert.equal(
          boxPoints(count, spec),
          expected[index],
          `${spec.label} ${count}艇は${expected[index]}点のはず`,
        );
      }
    }
  });

  it('展開した買い目の数が点数と一致する', () => {
    for (const [spec, expected] of table) {
      for (const [index, count] of [3, 4, 5, 6].entries()) {
        const boats = [1, 2, 3, 4, 5, 6].slice(0, count) as Boat[];
        assert.equal(expandBox(boats, spec).length, expected[index], `${spec.label} ${count}艇`);
      }
    }
  });

  it('艇が足りなければ0点。買い目も作らない', () => {
    assert.equal(boxPoints(2, trifecta), 0);
    assert.deepEqual(expandBox([1, 2] as Boat[], trifecta), []);
  });

  it('順不同は同じ組を二重に作らない', () => {
    const combos = expandBox([1, 2, 3, 4] as Boat[], trio);
    const keys = combos.map((combo) => combo.join('-'));
    assert.equal(new Set(keys).size, keys.length);
    assert.ok(combos.every((combo) => combo[0] < combo[1] && combo[1] < combo[2]));
  });

  it('着順ありは並びの違うものを別々に作る', () => {
    const combos = expandBox([1, 2, 3] as Boat[], trifecta);
    const keys = combos.map((combo) => combo.join('-'));
    assert.ok(keys.includes('1-2-3'));
    assert.ok(keys.includes('3-2-1'));
    assert.equal(new Set(keys).size, 6);
  });

  it('同じ艇を重ねて渡しても数えない', () => {
    assert.equal(expandBox([1, 1, 2, 3] as Boat[], trio).length, 1);
  });
});

/**
 * フォーメーション投票の展開。
 *
 * 公式カードの注記「各着、何個でもマークできます。重複する組合せは1点として計算します」
 * を、実物のフォーメーション券（びわこ 3連単 1着-45 / 2着-45 / 3着-126 → 組合せ数6）で
 * 答え合わせしてある。
 */
describe('フォーメーションの展開', () => {
  it('実物の券と同じ点数になる（1着45 / 2着45 / 3着126 → 6点）', () => {
    const rows = new Map<number, Boat[]>([
      [1, [4, 5]],
      [2, [4, 5]],
      [3, [1, 2, 6]],
    ]);
    const combos = expandFormation(rows, trifecta);
    assert.equal(combos.length, 6);
  });

  it('同じ艇を2か所に使わない', () => {
    const rows = new Map<number, Boat[]>([
      [1, [1, 2]],
      [2, [1, 2]],
      [3, [1, 2]],
    ]);
    assert.deepEqual(expandFormation(rows, trifecta), [], '3艇必要だが2艇しかない');
  });

  it('着順ありは並びの違うものを別々に数える', () => {
    const rows = new Map<number, Boat[]>([
      [1, [1, 2]],
      [2, [1, 2]],
      [3, [3]],
    ]);
    const combos = expandFormation(rows, trifecta).map((c) => c.join('-'));
    assert.deepEqual(combos.sort(), ['1-2-3', '2-1-3']);
  });

  it('順不同は1点にまとめる（公式カードの注記どおり）', () => {
    const rows = new Map<number, Boat[]>([
      [1, [1, 2]],
      [2, [1, 2]],
      [3, [3, 4]],
    ]);
    const combos = expandFormation(rows, trio).map((c) => c.join('='));
    assert.deepEqual(combos.sort(), ['1=2=3', '1=2=4']);
  });

  it('着の欄が欠けていれば作らない', () => {
    const rows = new Map<number, Boat[]>([
      [1, [1]],
      [2, [2]],
    ]);
    assert.deepEqual(expandFormation(rows, trifecta), []);
  });

  it('2連単では1着・2着だけを使う', () => {
    const rows = new Map<number, Boat[]>([
      [1, [1, 2]],
      [2, [3, 4]],
    ]);
    assert.equal(expandFormation(rows, exacta).length, 4);
  });
});
