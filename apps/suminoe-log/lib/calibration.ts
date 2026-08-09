/**
 * 確率モデルの較正データの取り込み。
 *
 * `scripts/calibrate.ts` が過去データで検証した結果を `public/calibration.json` に書く。
 *
 * **これはモデルを良く見せるためのデータではない。** 期待値の数字を出す以上、
 * 「その確率がどれだけ当たっていないか」を同じ画面に置くために読む。
 */

export const CALIBRATION_URL = '/calibration.json';
const SUPPORTED_SCHEMA_VERSION = 1;

export interface CalibrationSimulation {
  label: string;
  races: number;
  hits: number;
  hitRate: number;
  /** 1点100円で買った場合の回収率。控除率25%があるので 0.75 前後が普通 */
  roi: number;
}

export interface Calibration {
  schemaVersion: number;
  generatedAt: string;
  /** 検証に使った開催日数とレース数 */
  days: number;
  races: number;
  /** ソフトマックスの温度（この値で確率を作る） */
  temperature: number;
  /** 2着・3着に使う温度。1着と別に較正した値 */
  placeTemperature: number;
  logLoss: number;
  /** 全艇等確率のときの対数損失。これを下回っていなければモデルに意味がない */
  baselineLogLoss: number;
  favouriteHitRate: number;
  /** 3連単確率の「実際 ÷ 予測」。1.0 未満はモデルが過大 */
  trifectaRatio: number;
  simulations: CalibrationSimulation[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function parseSimulation(raw: unknown): CalibrationSimulation | null {
  const record = asRecord(raw);
  if (!record || typeof record.label !== 'string') return null;
  return {
    label: record.label,
    races: asNumber(record.races, 0),
    hits: asNumber(record.hits, 0),
    hitRate: asNumber(record.hitRate, 0),
    roi: asNumber(record.roi, 0),
  };
}

export function parseCalibration(rawText: string): Calibration | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return null;
  }
  const record = asRecord(parsed);
  if (!record) return null;
  if (asNumber(record.schemaVersion, 0) !== SUPPORTED_SCHEMA_VERSION) return null;

  const races = asNumber(record.races, 0);
  if (races <= 0) return null;

  return {
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    generatedAt: typeof record.generatedAt === 'string' ? record.generatedAt : '',
    days: asNumber(record.days, 0),
    races,
    temperature: asNumber(record.temperature, 1),
    // 較正前のデータには無いので、その場合は1着と同じ温度に倒す
    placeTemperature: asNumber(record.placeTemperature, asNumber(record.temperature, 1)),
    logLoss: asNumber(record.logLoss, 0),
    baselineLogLoss: asNumber(record.baselineLogLoss, 0),
    favouriteHitRate: asNumber(record.favouriteHitRate, 0),
    trifectaRatio: asNumber(record.trifectaRatio, 1),
    simulations: Array.isArray(record.simulations)
      ? record.simulations
          .map(parseSimulation)
          .filter((simulation): simulation is CalibrationSimulation => simulation !== null)
      : [],
  };
}

export async function fetchCalibration(): Promise<Calibration | null> {
  try {
    const response = await fetch(CALIBRATION_URL);
    if (!response.ok) return null;
    return parseCalibration(await response.text());
  } catch {
    return null;
  }
}
