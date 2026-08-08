/**
 * スミノエ・ログのドメイン型。
 * 仕様: docs/01-suminoe-log-spec.md §5
 */

export type Boat = 1 | 2 | 3 | 4 | 5 | 6;
export type Kimarite = '逃げ' | 'まくり' | '差し' | 'まくり差し' | '抜き';
export type Suimen = '静か' | 'ふつう' | '荒れてる';

/** 結果の着順を指す。フォームの3行に対応する。 */
export type ResultPlace = 'resultFirst' | 'resultSecond' | 'resultThird';

export interface RaceLog {
  id: string;
  raceNo: number;
  predictedFirst: Boat | null;
  tenjiFast: Boat | null;
  resultFirst: Boat | null;
  resultSecond: Boat | null;
  resultThird: Boat | null;
  kimarite: Kimarite | null;
  suimen: Suimen | null;
  memo: string;
  savedAt: string;
}

/** localStorage に入る形。schemaVersion は後方互換のための保険。 */
export interface StoredData {
  schemaVersion: 1;
  logs: RaceLog[];
}

/** 記録タブのフォーム状態。下書きとしてそのまま保存する。 */
export interface FormState {
  raceNo: number;
  predictedFirst: Boat | null;
  tenjiFast: Boat | null;
  resultFirst: Boat | null;
  resultSecond: Boat | null;
  resultThird: Boat | null;
  kimarite: Kimarite | null;
  suimen: Suimen | null;
  memo: string;
  /** 保存済みレコードを編集中ならその id。新規入力なら null。 */
  editingId: string | null;
}

export const BOATS: readonly Boat[] = [1, 2, 3, 4, 5, 6];

export const MIN_RACE_NO = 1;
export const MAX_RACE_NO = 12;

/**
 * 枠番と艇色。競艇では枠番ごとの艇色が世界共通で固定されている。
 * この色をUIの基本言語として使うため、彩度の高い色はこの6色だけに限る。
 */
export const BOAT_COLORS: Record<Boat, { bg: string; fg: string; name: string }> = {
  1: { bg: '#FFFFFF', fg: '#1A1A1A', name: '白' },
  2: { bg: '#2B2B2B', fg: '#FFFFFF', name: '黒' },
  3: { bg: '#D83A34', fg: '#FFFFFF', name: '赤' },
  4: { bg: '#2A6FC9', fg: '#FFFFFF', name: '青' },
  5: { bg: '#F2C230', fg: '#1A1A1A', name: '黄' },
  6: { bg: '#3F9A54', fg: '#FFFFFF', name: '緑' },
};

/** 決まり手と、初心者が判断できるようにするための補足。補足は削らないこと。 */
export const KIMARITE_OPTIONS: readonly { value: Kimarite; hint: string }[] = [
  { value: '逃げ', hint: '1号艇が先頭のまま' },
  { value: 'まくり', hint: '外から抜き去った' },
  { value: '差し', hint: '内側を突いた' },
  { value: 'まくり差し', hint: '外から回って内へ' },
  { value: '抜き', hint: '直線で追い抜いた' },
];

export const SUIMEN_OPTIONS: readonly Suimen[] = ['静か', 'ふつう', '荒れてる'];

export const EMPTY_FORM: FormState = {
  raceNo: MIN_RACE_NO,
  predictedFirst: null,
  tenjiFast: null,
  resultFirst: null,
  resultSecond: null,
  resultThird: null,
  kimarite: null,
  suimen: null,
  memo: '',
  editingId: null,
};

export const RESULT_PLACES: readonly { key: ResultPlace; label: string }[] = [
  { key: 'resultFirst', label: '1着' },
  { key: 'resultSecond', label: '2着' },
  { key: 'resultThird', label: '3着' },
];
