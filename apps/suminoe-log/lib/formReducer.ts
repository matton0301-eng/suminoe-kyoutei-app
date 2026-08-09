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
  | { type: 'stepRaceNo'; delta: number }
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

export function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'stepRaceNo':
      return { ...state, raceNo: clampRaceNo(state.raceNo + action.delta) };

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
      return {
        raceNo: action.log.raceNo,
        bets: action.log.bets,
        ken: action.log.ken,
        resultFirst: action.log.resultFirst,
        resultSecond: action.log.resultSecond,
        resultThird: action.log.resultThird,
        kimarite: action.log.kimarite,
        suimen: action.log.suimen,
        memo: action.log.memo,
        editingId: action.log.id,
      };

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
