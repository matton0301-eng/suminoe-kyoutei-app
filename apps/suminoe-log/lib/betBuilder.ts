/**
 * 買った舟券を組み立てる操作。
 *
 * 記録タブの主役。**着順が意味を持つ賭式とそうでない賭式で、押したときの挙動が違う。**
 *
 *   3連単・2連単・単勝  → 押した順がそのまま着順。同じ艇は2回選べない
 *   3連複・2連複・拡連複・複勝 → 順不同。押すたびに入り／切りが変わる
 *
 * ここは金額と同じく「記録として残る」側なので、
 * **組みかけの中途半端な買い目を確定させない**（必要な艇数が揃うまで追加できない）。
 */

import type { PayoutKey } from './results';
import type { Boat } from './types';

export interface BetTypeSpec {
  key: PayoutKey;
  label: string;
  /** 必要な艇数 */
  size: number;
  /** 着順が意味を持つか */
  ordered: boolean;
  /** 何を当てる賭式かの一言 */
  hint: string;
}

/** 画面に出す順。よく買うものを先に置く */
export const BET_TYPE_SPECS: readonly BetTypeSpec[] = [
  { key: 'trio', label: '3連複', size: 3, ordered: false, hint: '1〜3着を順不同' },
  { key: 'trifecta', label: '3連単', size: 3, ordered: true, hint: '1〜3着を着順どおり' },
  { key: 'quinella', label: '2連複', size: 2, ordered: false, hint: '1〜2着を順不同' },
  { key: 'exacta', label: '2連単', size: 2, ordered: true, hint: '1〜2着を着順どおり' },
  { key: 'wide', label: '拡連複', size: 2, ordered: false, hint: '3着までに入る2艇' },
  { key: 'win', label: '単勝', size: 1, ordered: true, hint: '1着' },
  { key: 'place', label: '複勝', size: 1, ordered: false, hint: '2着まで' },
];

export function specOf(key: PayoutKey): BetTypeSpec {
  return BET_TYPE_SPECS.find((entry) => entry.key === key) ?? BET_TYPE_SPECS[0];
}

/**
 * 艇を押したときの新しい選択。
 *
 * 着順ありは「押した順に積む。既に入っていれば外す」。
 * 順不同は「入っていなければ足す、入っていれば外す」。どちらも上限で止める。
 */
export function toggleBoat(selected: Boat[], boat: Boat, spec: BetTypeSpec): Boat[] {
  const index = selected.indexOf(boat);
  if (index >= 0) {
    // もう一度押したら外す。着順ありでは後ろの艇も繰り上がる
    return selected.filter((entry) => entry !== boat);
  }
  if (selected.length >= spec.size) return selected;
  return [...selected, boat];
}

/** 追加できる状態か。艇数がちょうど揃っていること */
export function isComplete(selected: Boat[], spec: BetTypeSpec): boolean {
  return selected.length === spec.size && new Set(selected).size === spec.size;
}

/**
 * 保存する形に整える。
 * 順不同の賭式は昇順に正規化しておく（同じ買い目を別物として二重に持たないため）。
 */
export function normalizeCombo(selected: Boat[], spec: BetTypeSpec): Boat[] {
  return spec.ordered ? [...selected] : [...selected].sort((a, b) => a - b);
}

/** 選択中の買い目を表示用の文字列に。まだ揃っていない分は「?」で埋める */
export function formatSelection(selected: Boat[], spec: BetTypeSpec): string {
  const separator = spec.ordered ? '-' : '=';
  const shown = spec.ordered ? selected : [...selected].sort((a, b) => a - b);
  const slots = [...shown.map(String), ...Array(Math.max(0, spec.size - shown.length)).fill('?')];
  return slots.join(separator);
}

/**
 * 着順ありのとき、その艇が何着目に選ばれているか（1始まり）。
 * 選ばれていなければ null。順不同では常に null（着順の意味が無いため）。
 */
export function placeOf(selected: Boat[], boat: Boat, spec: BetTypeSpec): number | null {
  if (!spec.ordered) return null;
  const index = selected.indexOf(boat);
  return index >= 0 ? index + 1 : null;
}
