/**
 * スミノエ・リードが出力した JSON（出走表＋評価値）の取り込み。
 *
 * 外から貼り付けられるデータなので、境界で厳密に検証する。
 * 形が合わないものは受け付けず、利用者に何が悪いかを日本語で返す。
 */

import type { Boat } from './types';

export type Grade3 = '高' | '中' | '低';
export type Verdict = '勝負' | '標準' | '見送り';

export interface CardBoat {
  teiban: Boat;
  name: string;
  kyubetsu: string;
  age: number;
  branch: string;
  zenkokuShoritsu: number;
  zenkokuNiritsu: number;
  touchiShoritsu: number;
  touchiNiritsu: number;
  noTouchiData: boolean;
  /** 当地データがない艇は全国勝率で代替済みの評価勝率 */
  evalShoritsu: number;
  motorNo: number;
  motorNiritsu: number;
  boatNo: number;
  boatNiritsu: number;
  konsetsu: string;
}

export interface CardRace {
  raceNo: number;
  name: string;
  distanceM: number;
  deadline: string;
  ok: boolean;
  inConfidence: Grade3 | null;
  inReason: string | null;
  upsetRisk: Grade3 | null;
  upsetReason: string | null;
  verdict: Verdict | null;
  verdictReason: string | null;
  betShape: string | null;
  motorPicks: { teiban: Boat; motorNiritsu: number }[];
  notes: string[];
  boats: CardBoat[];
}

export interface RaceCard {
  schemaVersion: number;
  date: string;
  place: string;
  title: string;
  dayLabel: string;
  motorLine: number | null;
  races: CardRace[];
}

const SUPPORTED_SCHEMA_VERSION = 1;

/**
 * アプリに同梱した出走表データの場所。
 * スミノエ・リードが `public/racecard.json` に書き出し、デプロイで配信される。
 * 起動時にここを読むので、利用者は貼り付け作業をしなくてよい。
 */
export const BUNDLED_CARD_URL = '/racecard.json';

const GRADES: Grade3[] = ['高', '中', '低'];
const VERDICTS: Verdict[] = ['勝負', '標準', '見送り'];

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asBoat(value: unknown): Boat | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  return value >= 1 && value <= 6 ? (value as Boat) : null;
}

function asGrade(value: unknown): Grade3 | null {
  return GRADES.includes(value as Grade3) ? (value as Grade3) : null;
}

function asVerdict(value: unknown): Verdict | null {
  return VERDICTS.includes(value as Verdict) ? (value as Verdict) : null;
}

function parseBoat(raw: unknown): CardBoat | null {
  const record = asRecord(raw);
  if (!record) return null;
  const teiban = asBoat(record.teiban);
  if (teiban === null) return null;
  return {
    teiban,
    name: asString(record.name, '（名前なし）'),
    kyubetsu: asString(record.kyubetsu, '—'),
    age: asNumber(record.age),
    branch: asString(record.branch),
    zenkokuShoritsu: asNumber(record.zenkokuShoritsu),
    zenkokuNiritsu: asNumber(record.zenkokuNiritsu),
    touchiShoritsu: asNumber(record.touchiShoritsu),
    touchiNiritsu: asNumber(record.touchiNiritsu),
    noTouchiData: record.noTouchiData === true,
    evalShoritsu: asNumber(record.evalShoritsu, asNumber(record.zenkokuShoritsu)),
    motorNo: asNumber(record.motorNo),
    motorNiritsu: asNumber(record.motorNiritsu),
    boatNo: asNumber(record.boatNo),
    boatNiritsu: asNumber(record.boatNiritsu),
    konsetsu: asString(record.konsetsu),
  };
}

function parseRace(raw: unknown): CardRace | null {
  const record = asRecord(raw);
  if (!record) return null;
  const raceNo = asNumber(record.raceNo, -1);
  if (!Number.isInteger(raceNo) || raceNo < 1 || raceNo > 12) return null;

  const boats = Array.isArray(record.boats)
    ? record.boats.map(parseBoat).filter((boat): boat is CardBoat => boat !== null)
    : [];

  const motorPicks = Array.isArray(record.motorPicks)
    ? record.motorPicks
        .map((pick) => {
          const entry = asRecord(pick);
          const teiban = entry ? asBoat(entry.teiban) : null;
          if (teiban === null) return null;
          return { teiban, motorNiritsu: asNumber(entry?.motorNiritsu) };
        })
        .filter((pick): pick is { teiban: Boat; motorNiritsu: number } => pick !== null)
    : [];

  return {
    raceNo,
    name: asString(record.name),
    distanceM: asNumber(record.distanceM, 1800),
    deadline: asString(record.deadline, '—'),
    // 6艇そろっていないレースは分析対象にしない
    ok: record.ok === true && boats.length === 6,
    inConfidence: asGrade(record.inConfidence),
    inReason: typeof record.inReason === 'string' ? record.inReason : null,
    upsetRisk: asGrade(record.upsetRisk),
    upsetReason: typeof record.upsetReason === 'string' ? record.upsetReason : null,
    verdict: asVerdict(record.verdict),
    verdictReason: typeof record.verdictReason === 'string' ? record.verdictReason : null,
    betShape: typeof record.betShape === 'string' ? record.betShape : null,
    motorPicks,
    notes: Array.isArray(record.notes) ? record.notes.filter((note): note is string => typeof note === 'string') : [],
    boats: [...boats].sort((a, b) => a.teiban - b.teiban),
  };
}

export interface ParseCardResult {
  card: RaceCard | null;
  error: string | null;
}

export function parseRaceCard(raw: string): ParseCardResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { card: null, error: 'データが空です。' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {
      card: null,
      error: 'JSONとして読めませんでした。ファイルの中身を全部コピーできているか確認してください。',
    };
  }

  const record = asRecord(parsed);
  if (!record) {
    return { card: null, error: 'JSONの形が違います（オブジェクトではありません）。' };
  }

  const schemaVersion = asNumber(record.schemaVersion, -1);
  if (schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    return {
      card: null,
      error:
        `対応していないデータ形式です（schemaVersion=${schemaVersion}）。` +
        `このアプリは ${SUPPORTED_SCHEMA_VERSION} に対応しています。`,
    };
  }

  const races = Array.isArray(record.races)
    ? record.races.map(parseRace).filter((race): race is CardRace => race !== null)
    : [];

  if (races.length === 0) {
    return { card: null, error: 'レースが1件も読み取れませんでした。' };
  }

  return {
    card: {
      schemaVersion,
      date: asString(record.date),
      place: asString(record.place, 'ボートレース住之江'),
      title: asString(record.title),
      dayLabel: asString(record.dayLabel),
      motorLine: typeof record.motorLine === 'number' ? record.motorLine : null,
      races: [...races].sort((a, b) => a.raceNo - b.raceNo),
    },
    error: null,
  };
}

/**
 * アプリに同梱された出走表データを読む。
 *
 * オフラインでも Service Worker のキャッシュから返るため、
 * 一度でもオンラインで開いていれば現地で通信できなくても読める。
 * 取得できなければ null を返すだけで、貼り付けによる取り込みは引き続き使える。
 */
export async function fetchBundledCard(): Promise<RaceCard | null> {
  try {
    const response = await fetch(BUNDLED_CARD_URL);
    if (!response.ok) return null;
    const text = await response.text();
    const { card } = parseRaceCard(text);
    return card;
  } catch {
    return null;
  }
}
