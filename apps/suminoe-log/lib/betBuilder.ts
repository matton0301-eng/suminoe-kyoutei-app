/**
 * 買った舟券を組み立てる操作。
 *
 * **公式のマークシート（投票カード）と同じ形にしてある。**
 * 現地で手にしているのがあの紙なので、画面が別の組み方をしていると
 * 見比べながら入力できない。カードの順に:
 *
 *   式別（券種） → 1着・2着・3着の欄 → 金額 → 単位（百/千/万）
 *
 * 着順の欄は賭式ごとに数が変わる（3連単は3つ、2連単は2つ、単勝は1つ）。
 * **同じ艇を2つの欄に入れられない。** 別の欄で選び直したら、元の欄からは外れる
 * （カードでも同じ艇を2か所には塗れない）。
 *
 * ここは金額と同じく「記録として残る」側なので、
 * **欄が埋まりきるまで確定させない**（中途半端な買い目を記録に残さない）。
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

/** 着順の欄。マークシートの「1着」「2着」「3着」に対応する。null は未記入 */
export type Slots = (Boat | null)[];

/** その賭式の空の欄を作る */
export function emptySlots(spec: BetTypeSpec): Slots {
  return Array.from({ length: spec.size }, () => null);
}

/** 欄の見出し。着順が意味を持たない賭式でも、カードと同じ「◯着」で並べる */
export function slotLabel(index: number, spec: BetTypeSpec): string {
  if (spec.size === 1) return spec.ordered ? '1着' : '選ぶ艇';
  return `${index + 1}着`;
}

/**
 * 欄に艇を入れる。
 *
 * **同じ艇は2つの欄に入らない。** 別の欄に入っていたらそこから外す
 * （マークシートでも同じ艇を2か所には塗れない）。
 * 同じ欄の同じ艇をもう一度押したら取り消し。
 */
export function setSlot(slots: Slots, index: number, boat: Boat): Slots {
  const next = slots.map((entry) => (entry === boat ? null : entry));
  next[index] = slots[index] === boat ? null : boat;
  return next;
}

/** 欄をすべて空にする */
export function clearSlots(spec: BetTypeSpec): Slots {
  return emptySlots(spec);
}

/** 追加できる状態か。**全部の欄が埋まり、艇が重複していないこと** */
export function isComplete(slots: Slots, spec: BetTypeSpec): boolean {
  const filled = slots.filter((entry): entry is Boat => entry !== null);
  return filled.length === spec.size && new Set(filled).size === spec.size;
}

/**
 * 保存する形に整える。
 * 順不同の賭式は昇順に正規化しておく（同じ買い目を別物として二重に持たないため）。
 */
export function normalizeCombo(slots: Slots, spec: BetTypeSpec): Boat[] {
  const filled = slots.filter((entry): entry is Boat => entry !== null);
  return spec.ordered ? filled : [...filled].sort((a, b) => a - b);
}

/** 記入中の買い目を表示用の文字列に。空欄は「?」で出す */
export function formatSelection(slots: Slots, spec: BetTypeSpec): string {
  const separator = spec.ordered ? '-' : '=';
  if (!isComplete(slots, spec)) {
    return slots.map((entry) => (entry === null ? '?' : String(entry))).join(separator);
  }
  return normalizeCombo(slots, spec).join(separator);
}

/* ────────────────────────────────────────────
   ボックス投票
   ──────────────────────────────────────────── */

/**
 * ボックスは「選んだ艇の全組み合わせを買う」買い方。
 *
 * 公式のマークシート（フォーメーション／ボックス用カード）に点数表が刷ってある:
 *
 *   マーク数   3艇  4艇  5艇  6艇
 *   3連単       6   24   60  120
 *   3連複       1    4   10   20
 *   2連単       6   12   20   30
 *   2連複       3    6   10   15
 *
 * **この表をテストの答え合わせに使う。** 組み合わせの計算を間違えると、
 * 買った点数と金額が実際とずれる。金額は記録として残る側なので、ここは外せない。
 */
export function expandBox(boats: Boat[], spec: BetTypeSpec): Boat[][] {
  const unique = [...new Set(boats)].sort((a, b) => a - b);
  if (unique.length < spec.size) return [];

  const combos: Boat[][] = [];

  const chooseUnordered = (start: number, picked: Boat[]) => {
    if (picked.length === spec.size) {
      combos.push([...picked]);
      return;
    }
    for (let i = start; i < unique.length; i += 1) {
      chooseUnordered(i + 1, [...picked, unique[i]]);
    }
  };

  const chooseOrdered = (picked: Boat[]) => {
    if (picked.length === spec.size) {
      combos.push([...picked]);
      return;
    }
    for (const boat of unique) {
      if (picked.includes(boat)) continue;
      chooseOrdered([...picked, boat]);
    }
  };

  if (spec.ordered) chooseOrdered([]);
  else chooseUnordered(0, []);

  return combos;
}

/** ボックスの点数。艇が足りなければ0 */
export function boxPoints(boatCount: number, spec: BetTypeSpec): number {
  if (boatCount < spec.size) return 0;
  let value = 1;
  for (let i = 0; i < spec.size; i += 1) value *= boatCount - i;
  if (spec.ordered) return value;
  for (let i = 2; i <= spec.size; i += 1) value /= i;
  return value;
}

/* ────────────────────────────────────────────
   フォーメーション投票
   ──────────────────────────────────────────── */

/**
 * フォーメーションを展開する。
 *
 * 各着の候補から1つずつ取り、**同じ艇を2か所に使わない**。
 * 順不同の賭式では、並びの違うものを1点にまとめる
 * （公式カードの「重複する組合せは1点として計算します」）。
 */
export function expandFormation(rows: Map<number, Boat[]>, spec: BetTypeSpec): Boat[][] {
  const levels: Boat[][] = [];
  for (let i = 1; i <= spec.size; i += 1) {
    const boats = rows.get(i);
    if (!boats || boats.length === 0) return [];
    levels.push(boats);
  }

  const found: Boat[][] = [];
  const walk = (depth: number, picked: Boat[]) => {
    if (depth === levels.length) {
      found.push([...picked]);
      return;
    }
    for (const boat of levels[depth]) {
      if (picked.includes(boat)) continue;
      walk(depth + 1, [...picked, boat]);
    }
  };
  walk(0, []);

  if (spec.ordered) return found;

  const seen = new Set<string>();
  const unique: Boat[][] = [];
  for (const combo of found) {
    const sorted = [...combo].sort((a, b) => a - b);
    const key = sorted.join('-');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(sorted);
  }
  return unique;
}

/* ────────────────────────────────────────────
   買い方（通常 / ボックス / フォーメーション）
   ──────────────────────────────────────────── */

export type BuyStyle = 'normal' | 'box' | 'formation';

export interface BuyStyleSpec {
  key: BuyStyle;
  label: string;
  hint: string;
}

export const BUY_STYLES: readonly BuyStyleSpec[] = [
  { key: 'normal', label: '通常', hint: '買い目を1点ずつ' },
  { key: 'box', label: 'ボックス', hint: '選んだ艇の全通り' },
  { key: 'formation', label: 'フォーメーション', hint: '着ごとに候補を選ぶ' },
];

/**
 * 単勝・複勝にボックスとフォーメーションは無い。
 * 1艇しか選ばない賭式なので、全通りも着ごとの候補も意味を持たない。
 */
export function stylesFor(spec: BetTypeSpec): readonly BuyStyleSpec[] {
  return spec.size === 1 ? BUY_STYLES.slice(0, 1) : BUY_STYLES;
}

/** 複数選択の入り／切り。ボックスの艇、フォーメーションの各着で使う */
export function toggleInList(list: Boat[], boat: Boat): Boat[] {
  return list.includes(boat) ? list.filter((entry) => entry !== boat) : [...list, boat];
}

/** フォーメーションの選択（着ごとの候補）。要素数は賭式の艇数に合わせる */
export type FormationPicks = Boat[][];

export function emptyFormation(spec: BetTypeSpec): FormationPicks {
  return Array.from({ length: spec.size }, () => []);
}

export function formationRows(picks: FormationPicks): Map<number, Boat[]> {
  return new Map(picks.map((boats, index) => [index + 1, boats]));
}
