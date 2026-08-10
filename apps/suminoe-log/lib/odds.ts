/**
 * オッズの取り込み（全賭式）。
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
  /** 2連単。キーは "1-2"（着順どおり） */
  exacta: Map<string, number>;
  /** 2連複。キーは "1-2"（昇順） */
  quinella: Map<string, number>;
  /** 単勝。キーは "1" */
  win: Map<string, number>;
  /**
   * 拡連複。キーは "1-2"（昇順）。値は [下限, 上限]。
   * **1つの数字ではない。** 3着までに入る組み合わせ次第で払戻が変わるため。
   */
  wide: Map<string, [number, number]>;
  /** 複勝。キーは "1"。値は [下限, 上限] */
  place: Map<string, [number, number]>;
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
const PAIR_KEY = /^[1-6]-[1-6]$/;
const SINGLE_KEY = /^[1-6]$/;

/** 幅を持つ賭式（拡連複・複勝）。[下限, 上限] の形でだけ受け取る */
function parseRangeMap(raw: unknown, keyPattern: RegExp): Map<string, [number, number]> {
  const record = asRecord(raw);
  const map = new Map<string, [number, number]>();
  if (!record) return map;
  for (const [key, value] of Object.entries(record)) {
    if (!keyPattern.test(key)) continue;
    if (!Array.isArray(value) || value.length !== 2) continue;
    const low = asNumberOrNull(value[0]);
    const high = asNumberOrNull(value[1]);
    if (low === null || high === null || low <= 0 || high < low) continue;
    map.set(key, [low, high]);
  }
  return map;
}

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
    exacta: parseOddsMap(record.exacta, PAIR_KEY),
    quinella: parseOddsMap(record.quinella, PAIR_KEY),
    win: parseOddsMap(record.win, SINGLE_KEY),
    wide: parseRangeMap(record.wide, PAIR_KEY),
    place: parseRangeMap(record.place, SINGLE_KEY),
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

/* ────────────────────────────────────────────
   オンデマンド取得（見た瞬間の値）
   ──────────────────────────────────────────── */

/**
 * そのレースのオッズを、いま公式から取り直す。
 *
 * 収集の仕組み（15分おき）で入る `odds.json` は、締切直前に最大15分古い。
 * **画面で見ているレースだけは、その場で取り直す。**
 * 8/9 のいちばんの不満が「オッズが反映されてない」だった。
 *
 * **取れなければ null を返す。** 呼び出し側は `odds.json` の値を出し続ける。
 * 新しい値が取れないことを理由に、画面から数字を消してはいけない。
 */
export async function fetchLiveRaceOdds(
  date: string,
  raceNo: number,
  options: { all?: boolean; signal?: AbortSignal } = {},
): Promise<RaceOddsData | null> {
  try {
    const query = new URLSearchParams({ date, race: String(raceNo) });
    if (options.all) query.set('all', '1');
    const response = await fetch(`/api/odds?${query.toString()}`, { signal: options.signal });
    if (!response.ok) return null;

    const raw = (await response.json()) as Record<string, unknown>;
    if (raw.available !== true) return null;

    const race = parseRace({ ...raw, raceNo });
    // 3連単も3連複も空なら、取れていないのと同じ
    return race && (race.trifecta.size > 0 || race.trio.size > 0) ? race : null;
  } catch {
    return null;
  }
}
