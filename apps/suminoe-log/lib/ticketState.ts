/**
 * 買った舟券1枚の状態。
 *
 * **「まだ分からない」と「外れた」を同じ見た目にしない。**
 * 着順が出ていないうちは結果待ちで、外れではない。
 * 金額の記録なので、ここを曖昧にすると振り返りが嘘になる。
 *
 * 判定に使う材料は2段ある:
 *   1. 自分が入力した着順 → レース直後に分かる。金額はまだ分からない
 *   2. 公式の払戻          → 夜に入る。ここで初めて金額が確定する
 */

import { isSameCombo, type Bet } from './bets';
import type { ResultRace } from './results';
import type { Boat } from './types';

export type TicketOutcome = 'pending' | 'hit' | 'miss';

export interface TicketState {
  outcome: TicketOutcome;
  /** 払戻（円）。確定していなければ null */
  returnedYen: number | null;
  /** 収支（円）。払戻が確定していなければ null */
  balanceYen: number | null;
  /** 何倍になったか。払戻が確定していなければ null */
  multiple: number | null;
}

/** 100円あたりの払戻から、実際の金額を出す。100円単位でしか買えないので割り切れる */
const UNIT_YEN = 100;

function payoutFor(bet: Bet, race: ResultRace | null): number | null {
  if (!race || !race.ok || race.payouts.length === 0) return null;
  const found = race.payouts.find(
    (entry) => entry.key === bet.betType && isSameCombo(bet.betType, bet.combo, entry.combo),
  );
  return found ? (found.amount * bet.amountYen) / UNIT_YEN : 0;
}

/**
 * 1枚の状態を決める。
 *
 * `order` は自分が入力した着順（1〜3着）。まだ入れていなければ空でよい。
 * `race` は公式の結果。無ければ払戻は確定しない。
 */
export function ticketState(
  bet: Bet,
  order: (Boat | null)[],
  race: ResultRace | null,
  hitByOrder: boolean,
): TicketState {
  const returned = payoutFor(bet, race);

  if (returned !== null) {
    // 公式の払戻が来ている。ここが最終
    const hit = returned > 0;
    return {
      outcome: hit ? 'hit' : 'miss',
      returnedYen: returned,
      balanceYen: returned - bet.amountYen,
      multiple: hit ? returned / bet.amountYen : 0,
    };
  }

  // 払戻はまだ。自分が入れた着順で分かるぶんだけ先に出す
  const hasOrder = order.some((entry) => entry !== null);
  if (!hasOrder) {
    return { outcome: 'pending', returnedYen: null, balanceYen: null, multiple: null };
  }
  if (hitByOrder) {
    // 当たったことは分かるが、いくらかはまだ分からない
    return { outcome: 'hit', returnedYen: null, balanceYen: null, multiple: null };
  }
  return { outcome: 'miss', returnedYen: null, balanceYen: null, multiple: null };
}

/**
 * 当たりの大きさの段。演出の派手さを決める。
 *
 * **外れには段を付けない。** 煽り返す作りにしない（記録の道具なので）。
 * 「万舟」は3連単で100倍（＝1万円）以上の払戻を指す競艇の言葉。
 */
export type HitTier = 0 | 1 | 2 | 3 | 4;

export interface HitGrade {
  tier: HitTier;
  label: string;
  /** その段に届く倍率 */
  threshold: number;
}

const TIERS: readonly HitGrade[] = [
  { tier: 1, label: '的中', threshold: 0 },
  { tier: 2, label: '好配当', threshold: 5 },
  { tier: 3, label: '高配当', threshold: 20 },
  { tier: 4, label: '万舟', threshold: 100 },
];

/** 倍率から段を決める。倍率が分からないうちは1段目（当たったことだけ祝う） */
export function hitGrade(multiple: number | null): HitGrade {
  if (multiple === null) return TIERS[0];
  return [...TIERS].reverse().find((entry) => multiple >= entry.threshold) ?? TIERS[0];
}

/** 複数枚の中でいちばん高い段。演出はこの段で出す */
export function bestGrade(multiples: (number | null)[]): HitGrade {
  return multiples.reduce<HitGrade>((top, value) => {
    const grade = hitGrade(value);
    return grade.tier > top.tier ? grade : top;
  }, TIERS[0]);
}
