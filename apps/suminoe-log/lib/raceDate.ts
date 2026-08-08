/**
 * 「アプリがいま扱っている日」の扱い。
 *
 * このアプリは特定の1日の専用ではない。開催日ごとに中身が入れ替わる。
 * 日付の決め方は次の順。
 *
 *   1. 取り込んだ出走表の日付（当日朝に取得したもの）
 *   2. 出走表がなければ端末の今日
 *
 * 出走表を優先するのは、翌日に前日のレースを振り返る場合があるため。
 * その場合も「その出走表の日の記録」を見せるのが自然。
 *
 * 記録・下書きは日付ごとに分けて保存する（`suminoe-log-20260809` など）。
 * 日が変われば別の記録になり、前日の記録は消えずに残る。
 */

const WEEKDAY_JP = ['日', '月', '火', '水', '木', '金', '土'] as const;

/** "2026-08-09" 形式かどうか */
export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** 端末の今日を "2026-08-09" 形式で返す */
export function todayIso(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** "2026-08-09" を "8/9(日)" にする。読めなければそのまま返す。 */
export function formatDateLabel(iso: string): string {
  if (!isIsoDate(iso)) return iso;
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return `${month}/${day}(${WEEKDAY_JP[date.getDay()]})`;
}

/** "2026-08-09" を "2026/8/9" にする（書き出しの見出し用） */
export function formatDateSlash(iso: string): string {
  if (!isIsoDate(iso)) return iso;
  const [year, month, day] = iso.split('-').map(Number);
  return `${year}/${month}/${day}`;
}

/** 日付付きの保存キーに使う "20260809" 形式 */
export function compactDate(iso: string): string {
  return isIsoDate(iso) ? iso.replaceAll('-', '') : iso;
}

/** "20260809" を "2026-08-09" にする。8桁の数字でなければ null */
export function isoFromCompact(compact: string): string | null {
  if (!/^\d{8}$/.test(compact)) return null;
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}

// --- localStorage のキー ---

/** 記録の保存キー。開催日ごとに分ける */
export function logsKey(iso: string): string {
  return `suminoe-log-${compactDate(iso)}`;
}

/** 入力途中の下書きキー。開催日ごとに分ける */
export function draftKey(iso: string): string {
  return `suminoe-draft-${compactDate(iso)}`;
}

/**
 * 取り込んだ出走表のキー。
 *
 * **日付を含めない。** 「いまアプリが扱っている出走表」1件だけを持つ。
 * 日付を含めると「日付を知るために日付が必要」という循環になるため。
 */
export const CARD_KEY = 'suminoe-racecard';

/** 結果データも出走表と同じ理由で日付を含めない */
export const RESULTS_KEY = 'suminoe-results';
