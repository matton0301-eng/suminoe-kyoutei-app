/**
 * 競走成績（結果）データの取り込み。
 *
 * スミノエ・リードの `review.py` が `public/results.json` に書き出す。
 * 全レースが終わってから確定するため、レース中は存在しないか古い日付になる。
 *
 * 外から来るデータなので、境界で厳密に検証する。
 */

import type { Boat } from './types';
import type { Verdict } from './raceCard';

export const RESULTS_URL = '/results.json';
const SUPPORTED_SCHEMA_VERSION = 1;

/** 公式の賭式名に対応するキー。リード側の BET_TYPE_TO_APP_KEY と揃える。 */
export type PayoutKey = 'trifecta' | 'trio' | 'exacta' | 'quinella' | 'wide' | 'win' | 'place';

export interface ResultPayout {
  /** 公式の表記（３連単 など） */
  betType: string;
  key: PayoutKey | null;
  combo: Boat[];
  amount: number;
  popularity: number | null;
}

export interface ResultEntry {
  teiban: Boat;
  name: string;
  /** 着順の生の値。'01'〜'06' のほか 'F' 'S0' などが入る */
  rankRaw: string;
  rank: number | null;
  /** 実際の進入コース */
  course: number | null;
  st: number | null;
  tenji: number | null;
}

export interface ResultRace {
  raceNo: number;
  name: string;
  ok: boolean;
  /** 着順の艇番（1着, 2着, 3着） */
  order: Boat[];
  kimarite: string;
  weather: string;
  windDir: string;
  windM: number | null;
  waveCm: number | null;
  /** 全艇が枠なり進入だったか */
  wakunari: boolean | null;
  verdict: Verdict | null;
  /** 事前に軸として提示した艇 */
  anchor: Boat | null;
  anchorWon: boolean | null;
  notes: string[];
  entries: ResultEntry[];
  payouts: ResultPayout[];
}

export interface ResultDay {
  schemaVersion: number;
  date: string;
  place: string;
  title: string;
  dayLabel: string;
  /** 当日実測のコース別1着率 */
  courseRates: Partial<Record<Boat, number>>;
  /** [枠なりだったレース数, 判定できたレース数] */
  wakunariCount: [number, number];
  races: ResultRace[];
  warnings: string[];
}

const PAYOUT_KEYS: PayoutKey[] = ['trifecta', 'trio', 'exacta', 'quinella', 'wide', 'win', 'place'];
const VERDICTS: Verdict[] = ['勝負', '標準', '見送り'];

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

function asBoat(value: unknown): Boat | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  return value >= 1 && value <= 6 ? (value as Boat) : null;
}

function asBoatList(value: unknown): Boat[] {
  if (!Array.isArray(value)) return [];
  const boats = value.map(asBoat);
  return boats.every((b): b is Boat => b !== null) ? boats : [];
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function parsePayout(raw: unknown): ResultPayout | null {
  const record = asRecord(raw);
  if (!record) return null;
  const combo = asBoatList(record.combo);
  const amount = asNumberOrNull(record.amount);
  if (combo.length === 0 || amount === null) return null;
  const key = record.appKey;
  return {
    betType: asString(record.betType),
    key: typeof key === 'string' && PAYOUT_KEYS.includes(key as PayoutKey) ? (key as PayoutKey) : null,
    combo,
    amount,
    popularity: asNumberOrNull(record.popularity),
  };
}

function parseEntry(raw: unknown): ResultEntry | null {
  const record = asRecord(raw);
  if (!record) return null;
  const teiban = asBoat(record.teiban);
  if (teiban === null) return null;
  return {
    teiban,
    name: asString(record.name, '（名前なし）'),
    rankRaw: asString(record.rankRaw),
    rank: asNumberOrNull(record.rank),
    course: asNumberOrNull(record.course),
    st: asNumberOrNull(record.st),
    tenji: asNumberOrNull(record.tenji),
  };
}

function parseRace(raw: unknown): ResultRace | null {
  const record = asRecord(raw);
  if (!record) return null;
  const raceNo = asNumberOrNull(record.raceNo);
  if (raceNo === null || !Number.isInteger(raceNo) || raceNo < 1 || raceNo > 12) return null;

  const verdict = record.verdict;
  return {
    raceNo,
    name: asString(record.name),
    ok: record.ok === true,
    order: asBoatList(record.order),
    kimarite: asString(record.kimarite),
    weather: asString(record.weather),
    windDir: asString(record.windDir),
    windM: asNumberOrNull(record.windM),
    waveCm: asNumberOrNull(record.waveCm),
    wakunari: typeof record.wakunari === 'boolean' ? record.wakunari : null,
    verdict: VERDICTS.includes(verdict as Verdict) ? (verdict as Verdict) : null,
    anchor: asBoat(record.anchor),
    anchorWon: typeof record.anchorWon === 'boolean' ? record.anchorWon : null,
    notes: asStringList(record.notes),
    entries: Array.isArray(record.entries)
      ? record.entries.map(parseEntry).filter((e): e is ResultEntry => e !== null)
      : [],
    payouts: Array.isArray(record.payouts)
      ? record.payouts.map(parsePayout).filter((p): p is ResultPayout => p !== null)
      : [],
  };
}

export function parseResults(rawText: string): ResultDay | null {
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
    ? record.races.map(parseRace).filter((r): r is ResultRace => r !== null)
    : [];
  if (races.length === 0) return null;

  const courseRates: Partial<Record<Boat, number>> = {};
  const rawRates = asRecord(record.courseRates);
  if (rawRates) {
    for (const [key, value] of Object.entries(rawRates)) {
      const course = asBoat(Number(key));
      const rate = asNumberOrNull(value);
      if (course !== null && rate !== null) courseRates[course] = rate;
    }
  }

  const wakunari = Array.isArray(record.wakunariCount) ? record.wakunariCount : [];
  const wakunariCount: [number, number] = [
    asNumberOrNull(wakunari[0]) ?? 0,
    asNumberOrNull(wakunari[1]) ?? 0,
  ];

  return {
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    date: asString(record.date),
    place: asString(record.place, 'ボートレース住之江'),
    title: asString(record.title),
    dayLabel: asString(record.dayLabel),
    courseRates,
    wakunariCount,
    races: races.sort((a, b) => a.raceNo - b.raceNo),
    warnings: asStringList(record.warnings),
  };
}

/**
 * アプリに同梱された結果データを読む。
 *
 * まだレースが終わっていなければ存在しない（404）ので、null を返すだけ。
 */
export async function fetchResults(): Promise<ResultDay | null> {
  try {
    const response = await fetch(RESULTS_URL);
    if (!response.ok) return null;
    return parseResults(await response.text());
  } catch {
    return null;
  }
}
