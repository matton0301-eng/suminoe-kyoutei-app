/**
 * 記録フォームの状態遷移。
 *
 * すべて新しいオブジェクトを返す（既存の state を書き換えない）。
 */

import type { Bet } from './bets';
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
  | { type: 'addBets'; bets: Bet[]; logId?: string }
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

    /**
     * 買った舟券を足す。
     *
     * **同じ買い目でも別の1枚として足す。** 以前は重複を捨てていたが、
     * それだと 100円 で買ったあとに同じ買い目を 500円 で買い増したとき、
     * 2枚目が何の反応もなく消えていた（2026-08-10 にユーザー報告）。
     * 手元には券が2枚あるのだから、記録も2行にする。
     * 押し間違えたぶんは1行ずつ「消す」で外せる。
     *
     * `logId` は、買い目タブから入れたときに渡ってくる保存先の記録の id。
     * これを持たせておかないと、フォームが「どの記録を編集しているか」を
     * 知らないままになり、消したはずの舟券が保存で復活する。
     */
    case 'addBets':
      return {
        ...state,
        bets: [...state.bets, ...action.bets],
        ken: false,
        editingId: state.editingId ?? action.logId ?? null,
      };

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

/**
 * フォームの内容を記録の配列に畳み込む。保存も画面遷移もしない、純粋な組み立て。
 *
 * 同じレースの記録があれば**上書きする**。
 * 買い目タブの「買った」は記録を先に作るので、そのあと結果を保存したときに
 * 新しい行を足すと 1R が2つできてしまう（実際に踏んだ）。
 *
 * **画面から切り出してある。** ここは金額が消えたり戻ったりする場所で、
 * 実際に両方の不具合を出している（下のコメント参照）。テストで固定しておきたい。
 */
export function foldForm(
  source: FormState,
  current: RaceLog[],
): { saved: RaceLog; next: RaceLog[]; isUpdate: boolean; bets: Bet[] } {
  const existing =
    source.editingId !== null
      ? (current.find((log) => log.id === source.editingId) ?? null)
      : (current.find((log) => log.raceNo === source.raceNo) ?? null);

  /**
   * 買い目タブから入れた舟券はフォームに無いことがあるので、既存の記録から引き継ぐ。
   *
   * **ただし「見（ケン）」が立っているときは引き継がない。**
   * 引き継ぐと「舟券を買った」と「買わずに見た」が同じ記録に同居する。
   * 見送ったという申告のほうが後から出た意思なので、そちらを採る。
   *
   * **フォームがその記録を開いているなら、空は「全部消した」という意思。**
   * 以前は空を無条件に「フォームがまだ知らないだけ」と解釈していたため、
   * 1点ずつ消して保存すると消した舟券がそのまま戻ってきた（2026-08-10 に確認）。
   */
  const knowsExisting = existing !== null && source.editingId === existing.id;
  const bets = source.ken
    ? []
    : source.bets.length > 0 || knowsExisting
      ? source.bets
      : (existing?.bets ?? []);

  const saved: RaceLog = {
    ...toRaceLog(source, existing?.id ?? createId()),
    bets,
    ken: source.ken || (bets.length === 0 && (existing?.ken ?? false)),
    savedAt: existing?.savedAt ?? new Date().toISOString(),
  };

  const next = existing
    ? current.map((log) => (log.id === saved.id ? saved : log))
    : [...current, saved];

  return { saved, next, isUpdate: existing !== null, bets };
}
