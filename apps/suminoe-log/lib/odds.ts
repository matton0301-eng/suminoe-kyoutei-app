/**
 * オッズ（3連単・3連複）の取り込み。
 *
 * `tools/suminoe-mcp/scripts/fetch-odds.ts` が `public/odds.json` に書き出す。
 *
 * **オッズは締切直前まで動く。** 30分おきのタスクで更新しているので、
 * 画面に出す値は最大30分古い。`fetchedAt` を必ず一緒に表示すること。
 *
 * まだ売れていない組み合わせにはオッズが付かない（取得側で null にしてある）。
 * 前売りの早い時間帯は3連複の半分以上が未確定になる。
 */

import { compactDate } from './raceDate';

export const ODDS_URL = '/odds.json';
const SUPPORTED_SCHEMA_VERSION = 1;

export interface RaceOddsData {
  raceNo: number;
  /** そのレースのオッズを取った時刻（JST）。null は取れていない */
  fetchedAt: string | null;
  /** キーは "1-2-3"（着順どおり）。未確定の組み合わせは入っていない */
  trifecta: Map<string, number>;
  /** キーは "1-2-3"（昇順）。未確定の組み合わせは入っていない */
  trio: Map<string, number>;
}

export interface OddsDay {
  schemaVersion: number;
  date: string;
  updatedAt: string;
  races: RaceOddsData[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 賭式ごとのオッズ表。0以下や数値でない値は捨てる（0倍の払戻は存在しない） */
function parseOddsMap(raw: unknown, keyPattern: RegExp): Map<string, number> {
  const record = asRecord(raw);
  const map = new Map<string, number>();
  if (!record) return map;
  for (const [key, value] of Object.entries(record)) {
    if (!keyPattern.test(key)) continue;
    const odds = asNumberOrNull(value);
    if (odds !== null && odds > 0) map.set(key, odds);
  }
  return map;
}

const TRIFECTA_KEY = /^[1-6]-[1-6]-[1-6]$/;
const TRIO_KEY = /^[1-6]-[1-6]-[1-6]$/;

function parseRace(raw: unknown): RaceOddsData | null {
  const record = asRecord(raw);
  if (!record) return null;
  const raceNo = asNumberOrNull(record.raceNo);
  if (raceNo === null || !Number.isInteger(raceNo) || raceNo < 1 || raceNo > 12) return null;

  return {
    raceNo,
    fetchedAt: typeof record.fetchedAt === 'string' ? record.fetchedAt : null,
    trifecta: parseOddsMap(record.trifecta, TRIFECTA_KEY),
    trio: parseOddsMap(record.trio, TRIO_KEY),
  };
}

export function parseOdds(rawText: string): OddsDay | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return null;
  }
  const record = asRecord(parsed);
  if (!record) return null;
  if (asNumberOrNull(record.schemaVersion) !== SUPPORTED_SCHEMA_VERSION) return null;

  const races = Array.isArray(record.races)
    ? record.races.map(parseRace).filter((race): race is RaceOddsData => race !== null)
    : [];
  if (races.length === 0) return null;

  return {
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    date: asString(record.date),
    updatedAt: asString(record.updatedAt),
    races: races.sort((a, b) => a.raceNo - b.raceNo),
  };
}

/**
 * そのレースのオッズを取り出す。
 *
 * 前日のオッズが残っていることがあるので、出走表の日付と一致しなければ使わない。
 * 1つもオッズが入っていないレース（発売前）は null。
 */
export function findRaceOdds(
  day: OddsDay | null,
  raceNo: number,
  cardDate: string,
): RaceOddsData | null {
  if (!day || day.date !== cardDate) return null;
  const race = day.races.find((entry) => entry.raceNo === raceNo);
  if (!race) return null;
  return race.trifecta.size > 0 || race.trio.size > 0 ? race : null;
}

/** "2026-08-09T15:05:00+09:00" → "15:05" */
export function formatFetchedAt(fetchedAt: string | null): string | null {
  if (!fetchedAt) return null;
  const matched = /T(\d{2}:\d{2})/.exec(fetchedAt);
  return matched ? matched[1] : null;
}

export function archiveOddsUrl(iso: string): string {
  return `/archive/odds-${compactDate(iso)}.json`;
}

async function fetchOddsFrom(url: string): Promise<OddsDay | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return parseOdds(await response.text());
  } catch {
    return null;
  }
}

export async function fetchOddsDay(): Promise<OddsDay | null> {
  return fetchOddsFrom(ODDS_URL);
}

export async function fetchArchiveOdds(iso: string): Promise<OddsDay | null> {
  return fetchOddsFrom(archiveOddsUrl(iso));
}
