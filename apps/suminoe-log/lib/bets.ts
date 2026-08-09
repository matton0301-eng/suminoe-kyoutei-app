/**
 * 買った舟券と、その配当。
 *
 * **金額を扱う唯一の場所。** 記録として残る以上、1円の誤差も作らない。
 *
 * 公式の払戻（`results.json` の payouts）は**100円あたりの金額**なので、
 * 実際の配当は `払戻 × 買った金額 ÷ 100` で出る。100円単位でしか買えないため
 * 割り切れ、円未満は発生しない。
 *
 * レースの結果がまだ出ていないときは `settled: false` を返し、払戻を確定させない。
 * 「まだ分からない」と「外れた」を同じ 0 円にしてはいけない。
 */

import type { PayoutKey, ResultRace } from './results';
import { UNIT_YEN } from './review';
import type { Boat } from './types';

/** 買った舟券1点 */
export interface Bet {
  betType: PayoutKey;
  /** 買い目。3連単・2連単は着順どおり、それ以外は昇順 */
  combo: Boat[];
  /** この1点に賭けた金額（円）。100円単位 */
  amountYen: number;
}

/** 1レース分の購入記録。bets が空で ken なら「見（ケン）」 */
export interface RaceBets {
  raceNo: number;
  bets: Bet[];
  /** 意図して買わなかった。未入力と区別する */
  ken: boolean;
}

export interface RaceSettlement {
  raceNo: number;
  /** 結果が出て払戻が確定したか */
  settled: boolean;
  investedYen: number;
  returnedYen: number;
  balanceYen: number;
  /** 当たった買い目と、その払戻 */
  hits: { combo: Boat[]; betType: PayoutKey; returnedYen: number }[];
}

export interface BetsSummary {
  investedYen: number;
  returnedYen: number;
  balanceYen: number;
  /** 払戻 ÷ 投資（%）。1円も買っていなければ null */
  recoveryRate: number | null;
  /** 舟券を買ったレース数 */
  betRaces: number;
  /** 見送った（ケン）レース数 */
  kenRaces: number;
  /** 1点でも当たったレース数 */
  hitRaces: number;
  /** 買ったが、まだ結果が出ていないレース数 */
  pendingRaces: number;
  races: RaceSettlement[];
}

/** 着順が意味を持つ賭式。ここに無いものは順不同で照合する */
const ORDERED_BET_TYPES: ReadonlySet<PayoutKey> = new Set<PayoutKey>(['trifecta', 'exacta']);

/** 同じ買い目か。賭式ごとに順序の扱いが変わる */
export function isSameCombo(betType: PayoutKey, a: Boat[], b: Boat[]): boolean {
  if (a.length !== b.length) return false;
  if (ORDERED_BET_TYPES.has(betType)) return a.every((boat, index) => boat === b[index]);
  const sortNum = (list: Boat[]) => [...list].sort((x, y) => x - y);
  const left = sortNum(a);
  const right = sortNum(b);
  return left.every((boat, index) => boat === right[index]);
}

/** 買い目を一意に表すキー。重複した買い目を弾くのに使う */
export function betKey(bet: Bet): string {
  const combo = ORDERED_BET_TYPES.has(bet.betType)
    ? bet.combo
    : [...bet.combo].sort((a, b) => a - b);
  return `${bet.betType}:${combo.join('-')}`;
}

export function investedYen(bets: Bet[]): number {
  return bets.reduce((total, bet) => total + bet.amountYen, 0);
}

/**
 * 1レース分を精算する。
 *
 * 払戻表に載っている組み合わせだけが当たり。載っていなければ外れ。
 * ワイドは1レースに3通りの払戻があるので、買い目ごとに引き当てる。
 */
export function settleRace(bets: Bet[], race: ResultRace | null): RaceSettlement {
  const invested = investedYen(bets);
  const settled = race !== null && race.ok && race.payouts.length > 0;

  if (!settled) {
    return {
      raceNo: race?.raceNo ?? 0,
      settled: false,
      investedYen: invested,
      returnedYen: 0,
      balanceYen: 0,
      hits: [],
    };
  }

  const hits: RaceSettlement['hits'] = [];
  let returned = 0;

  for (const bet of bets) {
    const payout = race.payouts.find(
      (entry) => entry.key === bet.betType && isSameCombo(bet.betType, bet.combo, entry.combo),
    );
    if (!payout) continue;
    // 払戻は100円あたり。買った金額に比例させる（100円単位なので割り切れる）
    const amount = (payout.amount * bet.amountYen) / UNIT_YEN;
    returned += amount;
    hits.push({ combo: bet.combo, betType: bet.betType, returnedYen: amount });
  }

  return {
    raceNo: race.raceNo,
    settled: true,
    investedYen: invested,
    returnedYen: returned,
    balanceYen: returned - invested,
    hits,
  };
}

/** その日の購入をまとめる。結果が出ていないレースは払戻に数えない */
export function summarizeBets(logs: RaceBets[], results: ResultRace[]): BetsSummary {
  const byRace = new Map(results.map((race) => [race.raceNo, race]));
  // settleRace は結果が無いとレース番号を持てないので、記録側の番号で上書きする
  const races = logs.map((log) => ({
    ...settleRace(log.bets, byRace.get(log.raceNo) ?? null),
    raceNo: log.raceNo,
  }));

  const invested = races.reduce((total, race) => total + race.investedYen, 0);
  const returned = races.reduce((total, race) => total + race.returnedYen, 0);
  // 回収率は**結果が出たぶんだけ**で出す。結果待ちを分母に入れると
  // 買った直後に「回収率0%」と表示され、外れたように見える
  const settledInvested = races
    .filter((race) => race.settled)
    .reduce((total, race) => total + race.investedYen, 0);

  return {
    investedYen: invested,
    returnedYen: returned,
    balanceYen: returned - invested,
    recoveryRate: settledInvested > 0 ? (returned / settledInvested) * 100 : null,
    betRaces: logs.filter((log) => log.bets.length > 0).length,
    kenRaces: logs.filter((log) => log.bets.length === 0 && log.ken).length,
    hitRaces: races.filter((race) => race.hits.length > 0).length,
    pendingRaces: races.filter((race) => !race.settled && race.investedYen > 0).length,
    races,
  };
}

/** 賭式の表示名。記録一覧と書き出しで使う */
export const BET_TYPE_NAMES: Record<PayoutKey, string> = {
  trifecta: '3連単',
  trio: '3連複',
  exacta: '2連単',
  quinella: '2連複',
  wide: 'ワイド',
  win: '単勝',
  place: '複勝',
};

export function formatBet(bet: Bet): string {
  const separator = ORDERED_BET_TYPES.has(bet.betType) ? '-' : '=';
  return `${BET_TYPE_NAMES[bet.betType]} ${bet.combo.join(separator)}`;
}

export function formatYen(yen: number): string {
  return `${yen < 0 ? '−' : ''}${Math.abs(yen).toLocaleString('ja-JP')}円`;
}
