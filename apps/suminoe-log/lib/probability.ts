/**
 * 買い目の評価スコアを確率に変換する。
 *
 * **確率はモデルの見立てであって、当たることの保証ではない。**
 * ここが出す数字は必ず較正（`public/calibration.json`）の結果と一緒に表示すること。
 * 予測55%のレースが実際に何%勝っていたかを添えないと、数字だけが独り歩きする。
 *
 * スコアの計算は `betting.ts` のものをそのまま使う（別実装を持たない）。
 * ここがやるのは変換だけ。
 *
 * ## 方式
 *
 * 1着は `firstScore` のソフトマックス。2着以降は Harville:
 * 1着が決まったら、その艇を除いた残りを `placeScore` で再正規化する。
 *
 * Harville は「1着になった艇の強さが2着争いに影響しない」という近似で、
 * 実際には人気どころの2着確率をやや高く見積もる傾向が知られている。
 * **補正係数は入れない。** 検証していない補正を足すと、ズレの原因が分からなくなる。
 * 偏りの大きさは較正で測り、画面に出す。
 */

import type { BoatScore } from './betting';
import { BOATS, type Boat } from './types';

/**
 * ソフトマックスの温度。低いほど上位に確率が集中する。
 *
 * 既定値は 1.0（スコアの単位＝勝率スケールをそのまま使う）。
 * 実際に使う値は `calibration.json` の temperature で、過去データの対数損失が
 * 最小になるものを選んである。較正データが無ければこの既定値に戻る。
 */
export const DEFAULT_TEMPERATURE = 1;

/** 温度に0や負値が来ても壊れないようにする下限 */
const MIN_TEMPERATURE = 0.01;

export interface RaceProbability {
  /** 各艇の1着確率 */
  first: Record<Boat, number>;
  /** 3連単120通り。キーは "1-2-3"（着順どおり） */
  trifecta: Map<string, number>;
  /** 3連複20通り。キーは "1-2-3"（昇順） */
  trio: Map<string, number>;
}

export function trifectaKey(boats: Boat[]): string {
  return boats.join('-');
}

export function trioKey(boats: Boat[]): string {
  return [...boats].sort((a, b) => a - b).join('-');
}

/**
 * ソフトマックス。最大値を引いてから exp を取る（そうしないと大きなスコアで
 * Infinity になり、確率が NaN になる）。
 */
function softmax(items: { teiban: Boat; score: number }[], temperature: number): Map<Boat, number> {
  const t = Math.max(temperature, MIN_TEMPERATURE);
  const max = Math.max(...items.map((item) => item.score));
  const weights = items.map((item) => ({
    teiban: item.teiban,
    weight: Math.exp((item.score - max) / t),
  }));
  const total = weights.reduce((sum, item) => sum + item.weight, 0);
  return new Map(weights.map((item) => [item.teiban, item.weight / total]));
}

export function firstProbabilities(
  scores: BoatScore[],
  temperature: number = DEFAULT_TEMPERATURE,
): Record<Boat, number> {
  const map = softmax(
    scores.map((score) => ({ teiban: score.teiban, score: score.firstScore })),
    temperature,
  );
  const result = {} as Record<Boat, number>;
  for (const boat of BOATS) {
    result[boat] = map.get(boat) ?? 0;
  }
  return result;
}

export function buildProbabilities(
  scores: BoatScore[],
  temperature: number = DEFAULT_TEMPERATURE,
  /**
   * 2着・3着に使う温度。1着と別に較正する。
   *
   * 同じ温度を使うと、2着争いの確率が実測より広がる（外枠の2着を高く見すぎる）。
   * 3連単の期待値はこの誤差を拾って跳ね上がるので、ここを分けるかどうかで
   * 「穴」の顔ぶれが大きく変わる。既定は1着と同じ（較正データが無いとき用）。
   */
  placeTemperature: number = temperature,
): RaceProbability {
  const first = firstProbabilities(scores, temperature);
  const placeScores = new Map(scores.map((score) => [score.teiban, score.placeScore]));

  const trifecta = new Map<string, number>();
  const trio = new Map<string, number>();

  for (const firstBoat of scores) {
    const p1 = first[firstBoat.teiban];
    const afterFirst = scores.filter((score) => score.teiban !== firstBoat.teiban);
    const secondMap = softmax(
      afterFirst.map((score) => ({
        teiban: score.teiban,
        score: placeScores.get(score.teiban) ?? 0,
      })),
      placeTemperature,
    );

    for (const secondBoat of afterFirst) {
      const p2 = secondMap.get(secondBoat.teiban) ?? 0;
      const afterSecond = afterFirst.filter((score) => score.teiban !== secondBoat.teiban);
      const thirdMap = softmax(
        afterSecond.map((score) => ({
          teiban: score.teiban,
          score: placeScores.get(score.teiban) ?? 0,
        })),
        placeTemperature,
      );

      for (const thirdBoat of afterSecond) {
        const combo: Boat[] = [firstBoat.teiban, secondBoat.teiban, thirdBoat.teiban];
        const probability = p1 * p2 * (thirdMap.get(thirdBoat.teiban) ?? 0);
        trifecta.set(trifectaKey(combo), probability);
        const key = trioKey(combo);
        trio.set(key, (trio.get(key) ?? 0) + probability);
      }
    }
  }

  return { first, trifecta, trio };
}
