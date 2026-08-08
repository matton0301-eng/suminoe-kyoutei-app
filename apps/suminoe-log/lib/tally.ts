/**
 * その日1日分の通算集計。
 *
 * 「提示した型を1点100円で全部買っていたら、いくら投資していくら返ってきたか」を出す。
 * 100円は競艇の最低購入単位。
 *
 * **控除率は約25%あるので、長く続ければ回収率は75%前後に収束する。**
 * ここに出る回収率が100%を超えていても、それは1日ぶんのばらつきであって
 * 分析が優れている証拠ではない。母数を必ず併記する。
 */

import { buildSuggestion, type BetTypeKey } from './betting';
import type { RaceCard, Verdict } from './raceCard';
import type { ResultDay } from './results';
import { UNIT_YEN, reviewPlans, summarizeOutcomes, type PlanOutcome } from './review';
import type { Boat } from './types';

export interface HitDetail {
  raceNo: number;
  ticket: Boat[];
  amount: number;
}

export interface BetTypeTally {
  key: BetTypeKey;
  name: string;
  /** 払戻データが揃って判定できたレース数（= 当選率の母数） */
  races: number;
  /** 1点以上当たったレース数 */
  hitRaces: number;
  hitRate: number | null;
  /** 買った点数の合計 */
  tickets: number;
  investedYen: number;
  returnedYen: number;
  balanceYen: number;
  /** 回収率(%)。払戻 ÷ 投資 */
  recoveryRate: number | null;
  /** 一番大きく当たった1点 */
  best: HitDetail | null;
}

export interface VerdictTally {
  verdict: Verdict;
  races: number;
  /** 1号艇が1着だったレース数 */
  insideWon: number;
  /** 軸が1着だったレース数 */
  anchorWon: number;
  investedYen: number;
  returnedYen: number;
  balanceYen: number;
}

export interface RaceTallyRow {
  raceNo: number;
  verdict: Verdict | null;
  order: Boat[];
  kimarite: string;
  anchor: Boat | null;
  anchorWon: boolean | null;
  /** 的中した賭式の名前 */
  hitNames: string[];
  investedYen: number;
  returnedYen: number;
  balanceYen: number;
}

export interface DayTally {
  date: string;
  /** 出走表にあるレース数 */
  racesTotal: number;
  /** 結果が確定したレース数 */
  racesFinished: number;
  insideWon: number;
  insideWonRate: number | null;
  byBetType: BetTypeTally[];
  byVerdict: VerdictTally[];
  perRace: RaceTallyRow[];
  investedYen: number;
  returnedYen: number;
  balanceYen: number;
  recoveryRate: number | null;
  /** 全賭式を1レースぶん買ったときの金額（説明用） */
  unitYen: number;
}

function emptyBetTally(key: BetTypeKey, name: string): BetTypeTally {
  return {
    key,
    name,
    races: 0,
    hitRaces: 0,
    hitRate: null,
    tickets: 0,
    investedYen: 0,
    returnedYen: 0,
    balanceYen: 0,
    recoveryRate: null,
    best: null,
  };
}

function rate(part: number, whole: number): number | null {
  return whole > 0 ? (part / whole) * 100 : null;
}

/**
 * 出走表と結果を突き合わせて、その日の通算を出す。
 *
 * 結果が出ていないレースは母数に入れない（買ったことにしない）。
 */
export function tallyDay(card: RaceCard, results: ResultDay): DayTally | null {
  if (results.date !== card.date) return null;

  const resultByRace = new Map(results.races.filter((race) => race.ok).map((r) => [r.raceNo, r]));

  const betTallies = new Map<BetTypeKey, BetTypeTally>();
  const verdictTallies = new Map<Verdict, VerdictTally>();
  const perRace: RaceTallyRow[] = [];

  let insideWon = 0;
  let invested = 0;
  let returned = 0;
  let unitYen = 0;

  for (const race of card.races) {
    const result = resultByRace.get(race.raceNo);
    if (!result) continue;

    const suggestion = buildSuggestion(race, {}, 0);
    if (!suggestion) continue;

    const outcomes: PlanOutcome[] = reviewPlans(suggestion.plans, result);
    const summary = summarizeOutcomes(outcomes);

    if (unitYen === 0) unitYen = summary.investedYen;
    invested += summary.investedYen;
    returned += summary.returnedYen;

    const first = result.order[0];
    if (first === 1) insideWon += 1;

    // 賭式ごと
    const hitNames: string[] = [];
    for (const outcome of outcomes) {
      if (outcome.unknown) continue;
      const tally = betTallies.get(outcome.plan.key) ?? emptyBetTally(outcome.plan.key, outcome.plan.name);
      tally.races += 1;
      tally.tickets += outcome.plan.points;
      tally.investedYen += outcome.investedYen;
      tally.returnedYen += outcome.returnedYen;
      if (outcome.hits.length > 0) {
        tally.hitRaces += 1;
        hitNames.push(outcome.plan.name);
        for (const hit of outcome.hits) {
          if (tally.best === null || hit.amount > tally.best.amount) {
            tally.best = { raceNo: race.raceNo, ticket: hit.ticket, amount: hit.amount };
          }
        }
      }
      betTallies.set(outcome.plan.key, tally);
    }

    // 判定ごと
    if (race.verdict) {
      const tally =
        verdictTallies.get(race.verdict) ??
        {
          verdict: race.verdict,
          races: 0,
          insideWon: 0,
          anchorWon: 0,
          investedYen: 0,
          returnedYen: 0,
          balanceYen: 0,
        };
      tally.races += 1;
      if (first === 1) tally.insideWon += 1;
      if (result.anchorWon) tally.anchorWon += 1;
      tally.investedYen += summary.investedYen;
      tally.returnedYen += summary.returnedYen;
      tally.balanceYen = tally.returnedYen - tally.investedYen;
      verdictTallies.set(race.verdict, tally);
    }

    perRace.push({
      raceNo: race.raceNo,
      verdict: race.verdict,
      order: result.order,
      kimarite: result.kimarite,
      anchor: result.anchor,
      anchorWon: result.anchorWon,
      hitNames,
      investedYen: summary.investedYen,
      returnedYen: summary.returnedYen,
      balanceYen: summary.returnedYen - summary.investedYen,
    });
  }

  if (perRace.length === 0) return null;

  const byBetType = [...betTallies.values()].map((tally) => ({
    ...tally,
    hitRate: rate(tally.hitRaces, tally.races),
    balanceYen: tally.returnedYen - tally.investedYen,
    recoveryRate: rate(tally.returnedYen, tally.investedYen),
  }));

  const verdictOrder: Verdict[] = ['勝負', '標準', '見送り'];

  return {
    date: card.date,
    racesTotal: card.races.length,
    racesFinished: perRace.length,
    insideWon,
    insideWonRate: rate(insideWon, perRace.length),
    byBetType,
    byVerdict: verdictOrder
      .map((verdict) => verdictTallies.get(verdict))
      .filter((tally): tally is VerdictTally => tally !== undefined),
    perRace,
    investedYen: invested,
    returnedYen: returned,
    balanceYen: returned - invested,
    recoveryRate: rate(returned, invested),
    unitYen,
  };
}

export { UNIT_YEN };
