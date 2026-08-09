/**
 * 記録フォームの状態遷移。
 *
 * すべて新しいオブジェクトを返す（既存の state を書き換えない）。
 */

import { betKey, type Bet } from './bets';
import {
  EMPTY_FORM,
  MAX_RACE_NO,
  MIN_RACE_NO,
  RESULT_PLACES,
  type Boat,
  type FormState,
  type Kimarite,
  type RaceLog,
  type ResultPlace,
  type Suimen,
} from './types';

export type FormAction =
  | { type: 'selectRace'; raceNo: number; log: RaceLog | null }
  | { type: 'setResult'; place: ResultPlace; boat: Boat }
  | { type: 'addBets'; bets: Bet[] }
  | { type: 'removeBet'; index: number }
  | { type: 'toggleKen' }
  | { type: 'toggleKimarite'; value: Kimarite }
  | { type: 'toggleSuimen'; value: Suimen }
  | { type: 'setMemo'; value: string }
  | { type: 'reset'; raceNo: number }
  | { type: 'loadForEdit'; log: RaceLog }
  | { type: 'restore'; form: FormState };

function clampRaceNo(value: number): number {
  return Math.min(MAX_RACE_NO, Math.max(MIN_RACE_NO, value));
}

/** 保存後の次のレース番号。12Rの次は13にせず12で止める。 */
export function nextRaceNo(current: number): number {
  return clampRaceNo(current + 1);
}

/**
 * 着順の重複を解消する。
 * 同じ艇を別の行で選んだら、元の行から自動的に外す（誤入力防止）。
 */
function assignResult(state: FormState, place: ResultPlace, boat: Boat): FormState {
  const next: FormState = { ...state };
  for (const { key } of RESULT_PLACES) {
    if (key !== place && next[key] === boat) {
      next[key] = null;
    }
  }
  next[place] = state[place] === boat ? null : boat;
  return next;
}

/**
 * 入力されたものが何かあるか。
 *
 * レースを移るときに「保存する価値のある内容か」を判断するために使う。
 * 空のフォームまで保存すると、押しただけのレースが記録に増える。
 */
export function formHasContent(form: FormState): boolean {
  return (
    form.bets.length > 0 ||
    form.ken ||
    form.resultFirst !== null ||
    form.resultSecond !== null ||
    form.resultThird !== null ||
    form.kimarite !== null ||
    form.suimen !== null ||
    form.memo.trim() !== ''
  );
}

/** そのレースの記録を読み込んだ状態にする。記録が無ければ空のフォーム。 */
function loadRace(raceNo: number, log: RaceLog | null): FormState {
  const clamped = clampRaceNo(raceNo);
  if (!log) return { ...EMPTY_FORM, raceNo: clamped };
  return {
    raceNo: clamped,
    bets: log.bets,
    ken: log.ken,
    resultFirst: log.resultFirst,
    resultSecond: log.resultSecond,
    resultThird: log.resultThird,
    kimarite: log.kimarite,
    suimen: log.suimen,
    memo: log.memo,
    editingId: log.id,
  };
}

export function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    /**
     * レースを移る。
     *
     * **前のレースの内容を持ち越さない。** 以前は raceNo だけを差し替えていたため、
     * 3R で「見」を押してから 4R に送ると 4R も「見」になっていた
     * （2026-08-09 の現地で発覚。着順・決まり手・メモも同じように波及していた）。
     * 移った先に記録があればそれを読み込み、無ければ空にする。
     */
    case 'selectRace':
      return loadRace(action.raceNo, action.log);

    case 'setResult':
      return assignResult(state, action.place, action.boat);

    case 'addBets': {
      // 同じ買い目を二重に足さない（買い増しは金額を変えて記録する）
      const existing = new Set(state.bets.map(betKey));
      const added = action.bets.filter((bet) => !existing.has(betKey(bet)));
      return { ...state, bets: [...state.bets, ...added], ken: false };
    }

    case 'removeBet':
      return { ...state, bets: state.bets.filter((_, index) => index !== action.index) };

    case 'toggleKen':
      // 見送ると決めたら買い目は残さない（記録の意味が食い違う）
      return state.ken
        ? { ...state, ken: false }
        : { ...state, ken: true, bets: [] };

    case 'toggleKimarite':
      return { ...state, kimarite: state.kimarite === action.value ? null : action.value };

    case 'toggleSuimen':
      return { ...state, suimen: state.suimen === action.value ? null : action.value };

    case 'setMemo':
      return { ...state, memo: action.value };

    case 'reset':
      return { ...EMPTY_FORM, raceNo: clampRaceNo(action.raceNo) };

    case 'loadForEdit':
      return loadRace(action.log.raceNo, action.log);

    case 'restore':
      return { ...action.form, raceNo: clampRaceNo(action.form.raceNo) };

    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

/** フォームの内容から保存用のレコードを組み立てる。 */
export function toRaceLog(form: FormState, id: string): RaceLog {
  return {
    id,
    raceNo: form.raceNo,
    bets: form.bets,
    ken: form.ken,
    resultFirst: form.resultFirst,
    resultSecond: form.resultSecond,
    resultThird: form.resultThird,
    kimarite: form.kimarite,
    suimen: form.suimen,
    memo: form.memo,
    savedAt: new Date().toISOString(),
  };
}

/** crypto.randomUUID が使えない環境でも動くようにする。 */
export function createId(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
  } catch {
    // フォールバックへ
  }
  return `log-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}
