/**
 * 「いま祝うべき的中があるか」を決める。
 *
 * **着順の手入力を外したので、保存の瞬間には当たりが分からない。**
 * 結果は15分おきの収集で自動的に入るので、入った時点で祝う。
 * レースが終わって最大15分後に、金額つきで出ることになる。
 *
 * 判定をここに切り出してあるのは、画面の都合と混ぜないため
 * （効果の出し方を変えても、何を祝うかの規則は変わらない）。
 */

import { settleRace, type Bet } from './bets';
import type { ResultDay } from './results';
import type { RaceLog } from './types';

export interface Celebration {
  /** 同じレースで二度祝わないための鍵 */
  key: string;
  raceNo: number;
  hits: Bet[];
  /** 買い目ごとの倍率。演出の段を決めるのに使う */
  multiples: (number | null)[];
  returnedYen: number;
}

/**
 * まだ祝っていないレースのうち、いちばん若い番号の的中を返す。
 *
 * **まとめて何回も流さない。** 一度に1レースだけ返し、
 * 祝い終わったら呼び出し側が `celebrated` に足して次を探す。
 *
 * 外れたレースも `celebrated` に入れてもらう必要がある
 * （そうしないと毎回ここで見つかり続ける）。そのため
 * **的中が無くても「見終わったレース」は返す**（`hits` が空の形で）。
 */
export function findCelebration(
  results: ResultDay | null,
  date: string,
  logs: RaceLog[],
  celebrated: ReadonlySet<string>,
): Celebration | null {
  if (!results || results.date !== date) return null;

  for (const log of [...logs].sort((a, b) => a.raceNo - b.raceNo)) {
    if (log.bets.length === 0) continue;
    const key = `${date}-${log.raceNo}`;
    if (celebrated.has(key)) continue;

    const race = results.races.find((entry) => entry.raceNo === log.raceNo);
    if (!race || !race.ok || race.payouts.length === 0) continue;

    const settlement = settleRace(log.bets, race);
    const hits: Bet[] = [];
    const multiples: (number | null)[] = [];

    for (const hit of settlement.hits) {
      const bet = log.bets.find(
        (entry) =>
          entry.betType === hit.betType && entry.combo.join('-') === hit.combo.join('-'),
      );
      hits.push({
        betType: hit.betType,
        combo: hit.combo,
        amountYen: bet?.amountYen ?? 0,
      });
      multiples.push(bet && bet.amountYen > 0 ? hit.returnedYen / bet.amountYen : null);
    }

    return { key, raceNo: log.raceNo, hits, multiples, returnedYen: settlement.returnedYen };
  }

  return null;
}
