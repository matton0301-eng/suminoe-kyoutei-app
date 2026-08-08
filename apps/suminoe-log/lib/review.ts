/**
 * 提示した買い目の型と、実際の結果を突き合わせる。
 *
 * **1日ぶんの結果は母数がごく小さく、分析の実力を示さない。**
 * 控除率が約25%ある以上、型どおり買い続けて増えることは想定していない。
 * ここで出すのは「その日どうだったか」の記録であって、成績の証明ではない。
 */

import type { BetPlan, BetTypeKey } from './betting';
import type { PayoutKey, ResultPayout, ResultRace } from './results';
import type { Boat } from './types';

/** 1点あたりの想定購入額。回収の目安を出すためだけに使う。 */
export const UNIT_YEN = 100;

/** アプリの賭式キー → 公式の払戻キー。3連単の2つの型は同じ払戻を参照する。 */
const PLAN_TO_PAYOUT: Record<BetTypeKey, PayoutKey> = {
  'trifecta-formation': 'trifecta',
  'trifecta-box': 'trifecta',
  trio: 'trio',
  exacta: 'exacta',
  quinella: 'quinella',
  wide: 'wide',
  win: 'win',
  place: 'place',
};

/** 着順が意味を持つ賭式。順不同の賭式は並べ替えて比較する。 */
const ORDERED: ReadonlySet<PayoutKey> = new Set<PayoutKey>(['trifecta', 'exacta']);

export interface HitTicket {
  ticket: Boat[];
  amount: number;
  popularity: number | null;
}

export interface PlanOutcome {
  plan: BetPlan;
  /** 的中した買い目。複勝は複数当たることがある */
  hits: HitTicket[];
  /** 1点100円で買った場合の投資額 */
  investedYen: number;
  /** 払戻の合計 */
  returnedYen: number;
  /** 結果データに該当する賭式の払戻が無い場合（未確定など） */
  unknown: boolean;
}

function sameCombo(a: Boat[], b: Boat[], ordered: boolean): boolean {
  if (a.length !== b.length) return false;
  if (ordered) return a.every((value, index) => value === b[index]);
  const sortedA = [...a].sort((x, y) => x - y);
  const sortedB = [...b].sort((x, y) => x - y);
  return sortedA.every((value, index) => value === sortedB[index]);
}

function payoutsOf(race: ResultRace, key: PayoutKey): ResultPayout[] {
  return race.payouts.filter((payout) => payout.key === key);
}

/**
 * 1つの型について、的中した買い目と払戻を求める。
 *
 * 複勝は2着以内の艇それぞれに払戻があるため、同じ艇が複数の払戻に一致しうる。
 * その場合は最初に見つかった1件だけを数える（同じ1点を二重に数えない）。
 */
export function reviewPlan(plan: BetPlan, race: ResultRace): PlanOutcome {
  const key = PLAN_TO_PAYOUT[plan.key];
  const candidates = payoutsOf(race, key);
  const invested = plan.tickets.length * UNIT_YEN;

  if (candidates.length === 0) {
    return { plan, hits: [], investedYen: invested, returnedYen: 0, unknown: true };
  }

  const ordered = ORDERED.has(key);
  const hits: HitTicket[] = [];
  for (const ticket of plan.tickets) {
    const matched = candidates.find((payout) => sameCombo(ticket, payout.combo, ordered));
    if (matched) {
      hits.push({ ticket, amount: matched.amount, popularity: matched.popularity });
    }
  }

  return {
    plan,
    hits,
    investedYen: invested,
    returnedYen: hits.reduce((sum, hit) => sum + hit.amount, 0),
    unknown: false,
  };
}

export function reviewPlans(plans: BetPlan[], race: ResultRace): PlanOutcome[] {
  return plans.map((plan) => reviewPlan(plan, race));
}

export interface RaceOutcomeSummary {
  /** 提示した型のうち、1点でも的中したものの数 */
  hitPlans: number;
  totalPlans: number;
  investedYen: number;
  returnedYen: number;
}

export function summarizeOutcomes(outcomes: PlanOutcome[]): RaceOutcomeSummary {
  const known = outcomes.filter((outcome) => !outcome.unknown);
  return {
    hitPlans: known.filter((outcome) => outcome.hits.length > 0).length,
    totalPlans: known.length,
    investedYen: known.reduce((sum, outcome) => sum + outcome.investedYen, 0),
    returnedYen: known.reduce((sum, outcome) => sum + outcome.returnedYen, 0),
  };
}

/** 予想（記録タブで選んだ1着）と結果を突き合わせる。 */
export function predictionHit(predicted: Boat | null, race: ResultRace): boolean | null {
  if (predicted === null || race.order.length === 0) return null;
  return predicted === race.order[0];
}

export function formatYen(value: number): string {
  return `${value.toLocaleString('ja-JP')}円`;
}
