/**
 * 複数の開催日を合算した通算集計。
 *
 * 1日ぶんの収支（{@link tallyDay}）を日をまたいで足し合わせる。
 * **母数が増えるほど回収率は控除率どおり75%前後へ寄っていく。**
 * それを自分のデータで確かめられることがこの集計の目的であって、
 * 成績を良く見せるためのものではない。日数とレース数を必ず併記すること。
 *
 * ここは純関数だけを置く。取得は {@link ./totalLoader}。
 */

import type { BetTypeKey } from './betting';
import type { Verdict } from './raceCard';
import type { BetTypeTally, DayTally, VerdictTally } from './tally';
import type { RaceLog } from './types';

/** 賭式ごとの通算。最高配当がどの日のものかを見失わないよう日付を持つ */
export interface TotalBetTypeTally extends BetTypeTally {
  bestDate: string | null;
}

export interface DaySummary {
  date: string;
  racesFinished: number;
  investedYen: number;
  returnedYen: number;
  balanceYen: number;
  recoveryRate: number | null;
  /** 1号艇が1着だったレース数 */
  insideWon: number;
}

export interface MultiTally {
  /** 日付降順（新しい日が先頭） */
  days: DaySummary[];
  totalDays: number;
  racesFinished: number;
  investedYen: number;
  returnedYen: number;
  balanceYen: number;
  recoveryRate: number | null;
  insideWon: number;
  insideWonRate: number | null;
  byBetType: TotalBetTypeTally[];
  byVerdict: VerdictTally[];
}

export interface DayInput {
  date: string;
  /** その日の収支。結果が未確定なら null（通算に入れない） */
  tally: DayTally | null;
  /** その日の観戦記録。無ければ空配列 */
  logs: RaceLog[];
}

const VERDICT_ORDER: Verdict[] = ['勝負', '標準', '見送り'];

function rate(part: number, whole: number): number | null {
  return whole > 0 ? (part / whole) * 100 : null;
}

export function summarizeDay(input: DayInput): DaySummary | null {
  if (input.tally === null) return null;
  return {
    date: input.date,
    racesFinished: input.tally.racesFinished,
    investedYen: input.tally.investedYen,
    returnedYen: input.tally.returnedYen,
    balanceYen: input.tally.balanceYen,
    recoveryRate: input.tally.recoveryRate,
    insideWon: input.tally.insideWon,
  };
}

/** 賭式ごとに足し合わせる。率と収支は合算後に出し直す */
function mergeBetTypes(inputs: DayInput[]): TotalBetTypeTally[] {
  const merged = new Map<BetTypeKey, TotalBetTypeTally>();

  for (const input of inputs) {
    if (input.tally === null) continue;
    for (const row of input.tally.byBetType) {
      const current = merged.get(row.key);
      if (current === undefined) {
        merged.set(row.key, {
          ...row,
          bestDate: row.best === null ? null : input.date,
        });
        continue;
      }
      const keepsCurrentBest =
        current.best !== null && (row.best === null || current.best.amount >= row.best.amount);
      merged.set(row.key, {
        ...current,
        races: current.races + row.races,
        hitRaces: current.hitRaces + row.hitRaces,
        tickets: current.tickets + row.tickets,
        investedYen: current.investedYen + row.investedYen,
        returnedYen: current.returnedYen + row.returnedYen,
        best: keepsCurrentBest ? current.best : row.best,
        bestDate: keepsCurrentBest ? current.bestDate : input.date,
      });
    }
  }

  return [...merged.values()]
    .map((row) => ({
      ...row,
      hitRate: rate(row.hitRaces, row.races),
      balanceYen: row.returnedYen - row.investedYen,
      recoveryRate: rate(row.returnedYen, row.investedYen),
    }))
    .sort((a, b) => (b.recoveryRate ?? -1) - (a.recoveryRate ?? -1));
}

/** 判定ごとに足し合わせる。表示順は 勝負 → 標準 → 見送り で固定 */
function mergeVerdicts(inputs: DayInput[]): VerdictTally[] {
  const merged = new Map<Verdict, VerdictTally>();

  for (const input of inputs) {
    if (input.tally === null) continue;
    for (const row of input.tally.byVerdict) {
      const current = merged.get(row.verdict);
      const next: VerdictTally =
        current === undefined
          ? { ...row }
          : {
              verdict: row.verdict,
              races: current.races + row.races,
              insideWon: current.insideWon + row.insideWon,
              anchorWon: current.anchorWon + row.anchorWon,
              investedYen: current.investedYen + row.investedYen,
              returnedYen: current.returnedYen + row.returnedYen,
              balanceYen: 0,
            };
      merged.set(row.verdict, { ...next, balanceYen: next.returnedYen - next.investedYen });
    }
  }

  return VERDICT_ORDER.map((verdict) => merged.get(verdict)).filter(
    (row): row is VerdictTally => row !== undefined,
  );
}

export function aggregateDays(inputs: DayInput[]): MultiTally {
  const withResult = inputs.filter((input) => input.tally !== null);
  const days = withResult
    .map(summarizeDay)
    .filter((day): day is DaySummary => day !== null)
    .sort((a, b) => b.date.localeCompare(a.date));

  const sum = (pick: (day: DaySummary) => number) =>
    days.reduce((total, day) => total + pick(day), 0);

  const investedYen = sum((day) => day.investedYen);
  const returnedYen = sum((day) => day.returnedYen);
  const racesFinished = sum((day) => day.racesFinished);
  const insideWon = sum((day) => day.insideWon);

  return {
    days,
    totalDays: days.length,
    racesFinished,
    investedYen,
    returnedYen,
    balanceYen: returnedYen - investedYen,
    recoveryRate: rate(returnedYen, investedYen),
    insideWon,
    insideWonRate: rate(insideWon, racesFinished),
    byBetType: mergeBetTypes(withResult),
    byVerdict: mergeVerdicts(withResult),
  };
}
