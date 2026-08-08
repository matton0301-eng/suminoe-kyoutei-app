/**
 * 直前情報（展示タイム・チルト・部品交換・スタート展示）の取り込み。
 *
 * スミノエ・リードの `beforeinfo.py` が `public/tenji.json` に書き出す。
 * レースごとに順次公開されるため、開催中は「まだ」のレースが混ざる。
 *
 * **買い目の評価には使わない。** 記録タブに手入力の「展示で速そう」があり、
 * 二重に効かせると同じ材料で2回評価することになる。ここは表示だけを担う。
 *
 * 外から来るデータなので、境界で厳密に検証する。
 */

import type { Boat } from './types';
import { compactDate } from './raceDate';

export const TENJI_URL = '/tenji.json';
const SUPPORTED_SCHEMA_VERSION = 1;

export interface TenjiEntry {
  teiban: Boat;
  name: string;
  /** 直前計量の体重（kg） */
  weight: number | null;
  /** 展示タイム（秒）。周回展示の直線タイム */
  tenjiTime: number | null;
  tilt: number | null;
  /** 交換していれば「新」。していなければ null */
  propeller: string | null;
  partsChanged: string[];
  /** スタート展示の進入コース */
  stCourse: number | null;
  /** スタート展示のタイミング。フライングは負値 */
  stTime: number | null;
}

export interface TenjiWeather {
  /** 「20:33現在」の部分 */
  observedAt: string | null;
  tempC: number | null;
  weather: string | null;
  windM: number | null;
  /** 風向はアイコンの通し番号でしか公開されていない（1〜17。無風は17） */
  windDirNo: number | null;
  waterTempC: number | null;
  waveCm: number | null;
}

export interface TenjiRace {
  raceNo: number;
  /** false は「まだ公開されていない」。エラーではない */
  available: boolean;
  entries: TenjiEntry[];
  weather: TenjiWeather | null;
}

export interface TenjiDay {
  schemaVersion: number;
  date: string;
  /** 取得時刻（ISO8601・JST）。鮮度の判断に使う */
  updatedAt: string;
  races: TenjiRace[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asBoat(value: unknown): Boat | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  return value >= 1 && value <= 6 ? (value as Boat) : null;
}

function parseEntry(raw: unknown): TenjiEntry | null {
  const record = asRecord(raw);
  if (!record) return null;
  const teiban = asBoat(record.teiban);
  if (teiban === null) return null;

  return {
    teiban,
    name: asString(record.name, '（名前なし）'),
    weight: asNumberOrNull(record.weight),
    tenjiTime: asNumberOrNull(record.tenjiTime),
    tilt: asNumberOrNull(record.tilt),
    propeller: asStringOrNull(record.propeller),
    partsChanged: Array.isArray(record.partsChanged)
      ? record.partsChanged.filter((v): v is string => typeof v === 'string')
      : [],
    stCourse: asNumberOrNull(record.stCourse),
    stTime: asNumberOrNull(record.stTime),
  };
}

function parseWeather(raw: unknown): TenjiWeather | null {
  const record = asRecord(raw);
  if (!record) return null;
  return {
    observedAt: asStringOrNull(record.observedAt),
    tempC: asNumberOrNull(record.tempC),
    weather: asStringOrNull(record.weather),
    windM: asNumberOrNull(record.windM),
    windDirNo: asNumberOrNull(record.windDirNo),
    waterTempC: asNumberOrNull(record.waterTempC),
    waveCm: asNumberOrNull(record.waveCm),
  };
}

function parseRace(raw: unknown): TenjiRace | null {
  const record = asRecord(raw);
  if (!record) return null;
  const raceNo = asNumberOrNull(record.raceNo);
  if (raceNo === null || !Number.isInteger(raceNo) || raceNo < 1 || raceNo > 12) return null;

  const entries = Array.isArray(record.entries)
    ? record.entries.map(parseEntry).filter((e): e is TenjiEntry => e !== null)
    : [];

  return {
    raceNo,
    // 中身が無いのに available だけ true のデータを信じない
    available: record.available === true && entries.length > 0,
    entries,
    weather: parseWeather(record.weather),
  };
}

export function parseBeforeInfo(rawText: string): TenjiDay | null {
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
    ? record.races.map(parseRace).filter((r): r is TenjiRace => r !== null)
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
 * 表示に使える直前情報を取り出す。
 *
 * 前日の tenji.json が残っていることがあるので、出走表の日付と一致しなければ使わない。
 * まだ公開されていないレースも null（列ごと出さないため）。
 */
export function findTenjiRace(
  day: TenjiDay | null,
  raceNo: number,
  cardDate: string,
): TenjiRace | null {
  if (!day || day.date !== cardDate) return null;
  const race = day.races.find((r) => r.raceNo === raceNo);
  return race && race.available ? race : null;
}

/** そのレースの最速展示タイム。速い＝勝つではないが、比べる基準として出す */
export function fastestTenji(entries: TenjiEntry[]): number | null {
  const times = entries
    .map((entry) => entry.tenjiTime)
    .filter((time): time is number => time !== null);
  return times.length ? Math.min(...times) : null;
}

/**
 * スタート展示のタイミングを公式の表記に戻す。
 *
 * 0.19 → ".19"、フライング（負値）は -0.06 → "F.06"。
 * 見慣れた形のほうが現地で読み違えない。
 */
export function formatStartTiming(st: number | null): string | null {
  if (st === null) return null;
  const flying = st < 0;
  const absolute = Math.abs(st);
  const text = absolute < 1 ? absolute.toFixed(2).slice(1) : absolute.toFixed(2);
  return flying ? `F${text}` : text;
}

/**
 * 水面気象を1行にまとめる。取れた項目だけを並べる。
 *
 * 風向は出さない。公式ページがアイコンの通し番号でしか公開しておらず、
 * 番号と方位の対応を検証していないため（推測で「北」とは書かない）。
 */
export function formatTenjiWeather(weather: TenjiWeather | null): string | null {
  if (!weather) return null;
  const parts: string[] = [];
  if (weather.weather) parts.push(weather.weather);
  if (weather.tempC !== null) parts.push(`気温${weather.tempC.toFixed(1)}℃`);
  if (weather.windM !== null) parts.push(`風${weather.windM}m`);
  if (weather.waterTempC !== null) parts.push(`水温${weather.waterTempC.toFixed(1)}℃`);
  if (weather.waveCm !== null) parts.push(`波${weather.waveCm}cm`);
  if (parts.length === 0) return null;
  const body = parts.join(' ');
  return weather.observedAt ? `${weather.observedAt}現在 ${body}` : body;
}

/** 部品交換・プロペラ交換を注記の文字列にする。無ければ空 */
export function tenjiNotes(race: TenjiRace | null): string[] {
  if (!race) return [];
  const notes: string[] = [];

  const parts = race.entries
    .filter((entry) => entry.partsChanged.length > 0)
    .map((entry) => `${entry.teiban}号艇 ${entry.partsChanged.join('・')}`);
  if (parts.length) notes.push(`部品交換: ${parts.join(' / ')}`);

  const propellers = race.entries
    .filter((entry) => entry.propeller !== null)
    .map((entry) => `${entry.teiban}号艇`);
  if (propellers.length) notes.push(`プロペラ交換: ${propellers.join(' / ')}`);

  return notes;
}

export function archiveTenjiUrl(iso: string): string {
  return `/archive/tenji-${compactDate(iso)}.json`;
}

/** アプリに同梱された直前情報を読む。まだ無ければ null */
export async function fetchBeforeInfo(): Promise<TenjiDay | null> {
  return fetchTenjiFrom(TENJI_URL);
}

/** 過去日の直前情報。オンライン前提（/archive/ は precache しない） */
export async function fetchArchiveTenji(iso: string): Promise<TenjiDay | null> {
  return fetchTenjiFrom(archiveTenjiUrl(iso));
}

async function fetchTenjiFrom(url: string): Promise<TenjiDay | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return parseBeforeInfo(await response.text());
  } catch {
    return null;
  }
}
