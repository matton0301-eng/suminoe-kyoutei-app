/**
 * 住之江の開催予定（どの日に開催があるか）。
 *
 * **`lib/schedule.ts` とは別物。** あちらは当日のレース時刻（締切・進行中のレース）、
 * こちらは開催日そのもののカレンダー。
 *
 * `tools/suminoe-read/schedule.py` が公式の月間スケジュールから作って
 * `public/schedule.json` に置く。**開催日は月に12日ほどしかない。**
 *
 * 用途は2つ。
 *   - 画面に「次はいつ開催か」を出す
 *   - 収集を回すかどうかの判断（そちらは CI 側で同じ JSON を読む）
 *
 * 取得できなければ null を返す。**予定が無いことを「開催なし」と解釈しない。**
 */

export interface ScheduleSeries {
  name: string;
  grade: string | null;
  /** ISO の日付（YYYY-MM-DD） */
  start: string;
  end: string;
  /** 節の日数 */
  days: number;
}

export interface Schedule {
  schemaVersion: number;
  venue: string;
  updatedAt: string;
  raceDays: string[];
  /** 次の開催日。予定内に無ければ null */
  nextRaceDay: string | null;
  series: ScheduleSeries[];
}

export const SCHEDULE_URL = '/schedule.json';

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asIsoDate(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function parseSeries(raw: unknown): ScheduleSeries | null {
  const record = asRecord(raw);
  if (!record) return null;
  const start = asIsoDate(record.start);
  const end = asIsoDate(record.end);
  if (!start || !end) return null;
  return {
    name: typeof record.name === 'string' ? record.name : '',
    grade: typeof record.grade === 'string' ? record.grade : null,
    start,
    end,
    days: typeof record.days === 'number' ? record.days : 1,
  };
}

export function parseSchedule(text: string): Schedule | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const record = asRecord(raw);
  if (!record) return null;

  const raceDays = Array.isArray(record.raceDays)
    ? record.raceDays.map(asIsoDate).filter((day): day is string => day !== null)
    : [];
  if (raceDays.length === 0) return null;

  const series = Array.isArray(record.series)
    ? record.series.map(parseSeries).filter((entry): entry is ScheduleSeries => entry !== null)
    : [];

  return {
    schemaVersion: typeof record.schemaVersion === 'number' ? record.schemaVersion : 1,
    venue: typeof record.venue === 'string' ? record.venue : '住之江',
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : '',
    raceDays,
    nextRaceDay: asIsoDate(record.nextRaceDay),
    series,
  };
}

export async function fetchSchedule(): Promise<Schedule | null> {
  try {
    const response = await fetch(SCHEDULE_URL);
    if (!response.ok) return null;
    return parseSchedule(await response.text());
  } catch {
    return null;
  }
}

/** その日に開催があるか。予定が無ければ null（「無い」と断定しない） */
export function hasRaceOn(schedule: Schedule | null, iso: string): boolean | null {
  if (!schedule) return null;
  return schedule.raceDays.includes(iso);
}

/** 今日以降の最初の開催日。今日が開催日なら今日 */
export function nextRaceDayFrom(schedule: Schedule | null, iso: string): string | null {
  if (!schedule) return null;
  return schedule.raceDays.find((day) => day >= iso) ?? null;
}

/** その日を含む節。無ければ null */
export function seriesOn(schedule: Schedule | null, iso: string): ScheduleSeries | null {
  if (!schedule) return null;
  return schedule.series.find((entry) => entry.start <= iso && iso <= entry.end) ?? null;
}

/**
 * 日付の計算はすべて UTC の通し番号で行う。
 *
 * **`new Date('2026-08-04T00:00:00+09:00').toISOString()` を使ってはいけない。**
 * UTC に直すと前日の15:00になるので、日付が1日前にずれる。
 * 実際に開催カレンダーで「1日目 8/3」と表示する不具合を出した。
 * 端末のタイムゾーンにも依存させない。
 */
function toUtcMillis(iso: string): number {
  return Date.UTC(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10)),
  );
}

function fromUtcMillis(millis: number): string {
  return new Date(millis).toISOString().slice(0, 10);
}

/** 開催まであと何日か。当日は0、過ぎていれば負 */
export function daysUntil(from: string, to: string): number {
  return Math.round((toUtcMillis(to) - toUtcMillis(from)) / 86_400_000);
}

/** ISO の日付に日数を足す。 */
export function addDays(iso: string, days: number): string {
  return fromUtcMillis(toUtcMillis(iso) + days * 86_400_000);
}

/** 曜日（0=日）。端末のタイムゾーンに依存しない */
export function weekdayIndex(iso: string): number {
  return new Date(toUtcMillis(iso)).getUTCDay();
}

/** 節に含まれる日付を並べる。 */
export function seriesDays(entry: ScheduleSeries): string[] {
  return Array.from({ length: Math.max(1, entry.days) }, (_, index) =>
    addDays(entry.start, index),
  );
}
