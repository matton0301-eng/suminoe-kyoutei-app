/**
 * 当日の記録を集計する。
 *
 * 住之江の基準値と並べて表示することがこのアプリの中核価値。
 * サンプル数が少ない段階で断定的な判定を出さないこと（仕様 §3 タブ2 ④）。
 */

import {
  COURSE_FIRST_RATE,
  EMPHASIS_DIFF_PT,
  MIN_LOGS_FOR_READING,
} from './baseline';
import { BOATS, KIMARITE_OPTIONS, type Boat, type Kimarite, type RaceLog } from './types';

export interface HitRate {
  hit: number;
  /** 予想と結果1着の両方が入っているレース数 */
  total: number;
  rate: number | null;
}

export interface CourseStat {
  course: Boat;
  count: number;
  rate: number | null;
  baseline: number;
  diff: number | null;
  /** 基準との差が ±10pt を超えたか */
  emphasize: boolean;
}

export interface KimariteStat {
  kimarite: Kimarite;
  count: number;
  rate: number | null;
}

export interface Reading {
  /** 記録が足りていて判定を出せるか */
  ready: boolean;
  text: string;
}

export interface Stats {
  totalLogs: number;
  /** 結果1着が入っているレース数。コース別1着率と傾向判定の母数。 */
  resultCount: number;
  hitRate: HitRate;
  courses: CourseStat[];
  kimarite: KimariteStat[];
  roughCount: number;
  reading: Reading;
}

function ratio(count: number, total: number): number | null {
  return total > 0 ? (count / total) * 100 : null;
}

export function aggregate(logs: RaceLog[]): Stats {
  const withResult = logs.filter((log) => log.resultFirst !== null);
  const resultCount = withResult.length;

  const predictable = logs.filter(
    (log) => log.predictedFirst !== null && log.resultFirst !== null,
  );
  const hit = predictable.filter((log) => log.predictedFirst === log.resultFirst).length;

  const courses: CourseStat[] = BOATS.map((course) => {
    const count = withResult.filter((log) => log.resultFirst === course).length;
    const rate = ratio(count, resultCount);
    const baseline = COURSE_FIRST_RATE[course];
    const diff = rate === null ? null : rate - baseline;
    return {
      course,
      count,
      rate,
      baseline,
      diff,
      emphasize: diff !== null && Math.abs(diff) >= EMPHASIS_DIFF_PT,
    };
  });

  const withKimarite = logs.filter((log) => log.kimarite !== null);
  const kimarite: KimariteStat[] = KIMARITE_OPTIONS.map(({ value }) => {
    const count = withKimarite.filter((log) => log.kimarite === value).length;
    return { kimarite: value, count, rate: ratio(count, withKimarite.length) };
  });

  const roughCount = logs.filter((log) => log.suimen === '荒れてる').length;

  return {
    totalLogs: logs.length,
    resultCount,
    hitRate: { hit, total: predictable.length, rate: ratio(hit, predictable.length) },
    courses,
    kimarite,
    roughCount,
    reading: buildReading(logs, resultCount, courses, roughCount),
  };
}

/**
 * 今日の水面の読みを1文で生成する。
 *
 * 母数が {@link MIN_LOGS_FOR_READING} 未満のときは判定を出さない。
 * 少ないサンプルで断定的な判定を出さないことは仕様上の要件。
 */
function buildReading(
  logs: RaceLog[],
  resultCount: number,
  courses: CourseStat[],
  roughCount: number,
): Reading {
  if (resultCount < MIN_LOGS_FOR_READING) {
    const needed = MIN_LOGS_FOR_READING - resultCount;
    return {
      ready: false,
      text: `あと${needed}レース記録すると傾向が出ます`,
    };
  }

  const course1 = courses.find((c) => c.course === 1);
  const diff1 = course1?.diff ?? null;

  if (diff1 !== null && diff1 >= EMPHASIS_DIFF_PT) {
    return { ready: true, text: 'イン特強。1号艇の信頼度が高い日。' };
  }
  if (diff1 !== null && diff1 <= -EMPHASIS_DIFF_PT) {
    return { ready: true, text: 'インが崩れてる。3・4号艇の攻めが利く日。' };
  }
  if (logs.length > 0 && roughCount >= logs.length / 2) {
    return { ready: true, text: '2マークが荒れてる。逆転に注意。' };
  }
  return { ready: true, text: 'おおむね基準どおり。セオリー重視で。' };
}

/** 予想が的中したか。予想か結果が欠けている場合は null（○×を出さない）。 */
export function isHit(log: RaceLog): boolean | null {
  if (log.predictedFirst === null || log.resultFirst === null) return null;
  return log.predictedFirst === log.resultFirst;
}

/** 「1-3-2」形式。欠けている着は「?」で埋める。 */
export function formatResult(log: RaceLog): string {
  const places = [log.resultFirst, log.resultSecond, log.resultThird];
  if (places.every((place) => place === null)) return '未入力';
  return places.map((place) => (place === null ? '?' : String(place))).join('-');
}

export function formatRate(rate: number | null, digits = 1): string {
  return rate === null ? '—' : `${rate.toFixed(digits)}%`;
}

export function formatDiff(diff: number | null): string {
  if (diff === null) return '—';
  const sign = diff >= 0 ? '+' : '−';
  return `${sign}${Math.abs(diff).toFixed(1)}`;
}
