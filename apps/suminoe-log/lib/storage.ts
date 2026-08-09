/**
 * localStorage の読み書き。
 *
 * 現地では取りこぼしが起きるため、
 *  - 保存はデバウンスせず即時
 *  - フォーム入力のたびに下書きを別キーへ退避
 * localStorage が使えない環境でもクラッシュせず、呼び出し側が警告を出せるようにする。
 *
 * **記録と下書きは開催日ごとに分ける**（`suminoe-log-20260809` など）。
 * 出走表・結果は「いま扱っている1件」だけなので日付を含めない。
 * 詳細は `lib/raceDate.ts`。
 */

import { CARD_KEY, RESULTS_KEY, draftKey, isoFromCompact, logsKey } from './raceDate';
import { EMPTY_FORM, type FormState, type RaceLog, type StoredData } from './types';

export interface LoadResult {
  logs: RaceLog[];
  /** localStorage が使えない／壊れている場合の利用者向けメッセージ */
  error: string | null;
}

function getStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    // Safari のプライベートモード等では getItem 自体が投げることがある
    const probe = '__suminoe_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

export function isStorageAvailable(): boolean {
  return getStorage() !== null;
}

function readRaw(key: string): string | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string): boolean {
  const storage = getStorage();
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeRaw(key: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // noop
  }
}

function isBoatLike(value: unknown): boolean {
  return value === null || (typeof value === 'number' && value >= 1 && value <= 6);
}

/** 外から来たデータは信用しない。形が合わない要素は捨てる。 */
function sanitizeLog(raw: unknown): RaceLog | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.id !== 'string') return null;
  if (typeof record.raceNo !== 'number') return null;
  const boatFields = [
    'resultFirst',
    'resultSecond',
    'resultThird',
  ] as const;
  for (const field of boatFields) {
    if (!isBoatLike(record[field])) return null;
  }
  return {
    id: record.id,
    raceNo: record.raceNo,
    resultFirst: record.resultFirst as RaceLog['resultFirst'],
    resultSecond: record.resultSecond as RaceLog['resultSecond'],
    resultThird: record.resultThird as RaceLog['resultThird'],
    kimarite: (record.kimarite ?? null) as RaceLog['kimarite'],
    suimen: (record.suimen ?? null) as RaceLog['suimen'],
    memo: typeof record.memo === 'string' ? record.memo : '',
    savedAt: typeof record.savedAt === 'string' ? record.savedAt : new Date().toISOString(),
  };
}

/** 指定した開催日の記録を読む。 */
export function loadLogs(date: string): LoadResult {
  if (!isStorageAvailable()) {
    return {
      logs: [],
      error: 'この端末では記録を保存できません。画面を閉じると記録が消えます。',
    };
  }
  const raw = readRaw(logsKey(date));
  if (!raw) return { logs: [], error: null };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return { logs: [], error: '保存データの形式が読めませんでした。新しく記録を始めます。' };
    }
    const data = parsed as Partial<StoredData>;
    const logs = Array.isArray(data.logs)
      ? data.logs.map(sanitizeLog).filter((log): log is RaceLog => log !== null)
      : [];
    return { logs, error: null };
  } catch {
    return { logs: [], error: '保存データを読めませんでした。新しく記録を始めます。' };
  }
}

/** 保存できたかを返す。false なら呼び出し側で警告を出す。 */
export function saveLogs(date: string, logs: RaceLog[]): boolean {
  const data: StoredData = { schemaVersion: 1, logs };
  return writeRaw(logsKey(date), JSON.stringify(data));
}

export function saveDraft(date: string, form: FormState): void {
  writeRaw(draftKey(date), JSON.stringify(form));
}

/** 起動時に呼ぶ。入力途中でブラウザが落ちても復元できるようにする。 */
export function loadDraft(date: string): FormState | null {
  const raw = readRaw(draftKey(date));
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.raceNo !== 'number') return null;
    return { ...EMPTY_FORM, ...(record as Partial<FormState>) };
  } catch {
    return null;
  }
}

export function clearDraft(date: string): void {
  removeRaw(draftKey(date));
}

/** その日の記録と下書きを消す。出走表は消さない。 */
export function clearAll(date: string): void {
  removeRaw(logsKey(date));
  removeRaw(draftKey(date));
}

/**
 * 記録が保存されている日付ごとの件数（日付リスト用）。
 * localStorage のキーを走査する。日数は高々数十なので毎回読んで問題ない。
 */
export function countLogsByDate(): Record<string, number> {
  const storage = getStorage();
  if (!storage) return {};
  const counts: Record<string, number> = {};
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    const match = key === null ? null : /^suminoe-log-(\d{8})$/.exec(key);
    if (!match) continue;
    const iso = isoFromCompact(match[1]);
    if (iso === null) continue;
    counts[iso] = loadLogs(iso).logs.length;
  }
  return counts;
}

/** 下書きが実質空か（初期状態と変わらないか）。空なら復元通知を出さない。 */
export function isDraftMeaningful(form: FormState): boolean {
  return (
    form.resultFirst !== null ||
    form.resultSecond !== null ||
    form.resultThird !== null ||
    form.kimarite !== null ||
    form.suimen !== null ||
    form.memo.trim() !== ''
  );
}

// --- 出走表・結果（いま扱っている1件だけを持つので日付を含めない） ---

export function saveRaceCardRaw(raw: string): boolean {
  return writeRaw(CARD_KEY, raw);
}

export function loadRaceCardRaw(): string | null {
  return readRaw(CARD_KEY);
}

export function clearRaceCard(): void {
  removeRaw(CARD_KEY);
}

export function saveResultsRaw(raw: string): boolean {
  return writeRaw(RESULTS_KEY, raw);
}

export function loadResultsRaw(): string | null {
  return readRaw(RESULTS_KEY);
}
