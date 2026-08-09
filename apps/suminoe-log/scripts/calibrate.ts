/**
 * 確率モデルの較正（calibration）を過去データで検証する。
 *
 *   tools/suminoe-mcp/node_modules/.bin/tsx apps/suminoe-log/scripts/calibrate.ts
 *
 * 材料:
 *   tools/suminoe-read/cache/cards/YYYYMMDD.json    その日の番組表（事前の見立て）
 *   tools/suminoe-read/cache/history/YYYYMMDD.json  その日の成績（実際の着順）
 *
 * やること:
 *   1. ソフトマックスの温度を変えながら対数損失を測り、最小になる温度を選ぶ
 *   2. その温度で「予測1着確率 vs 実際の1着率」をビン分割で突き合わせる
 *   3. 3連単の上位N点に実際の着順が入る率を数える
 *
 * 出力 public/calibration.json はアプリが読み、期待値の注記に添える。
 * **モデルがどれだけ当たっていないかを画面に出すためのデータ**であって、
 * モデルを良く見せるためのものではない。
 *
 * 番組表の値だけで再現する（過去成績の実測 enrich は通さない）。
 * 蓄積した成績はその日より後のものも含むため、過去日に当てると未来を見たことになる。
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSuggestion } from '../lib/betting';
import { buildProbabilities, firstProbabilities, trifectaKey } from '../lib/probability';
import { parseRaceCard, type CardRace } from '../lib/raceCard';
import { BOATS, type Boat } from '../lib/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const READ_ROOT = join(HERE, '..', '..', '..', 'tools', 'suminoe-read', 'cache');
const CARDS_DIR = join(READ_ROOT, 'cards');
const HISTORY_DIR = join(READ_ROOT, 'history');
const OUT_PATH = join(HERE, '..', 'public', 'calibration.json');

const SCHEMA_VERSION = 1;
/** 3連単の上位N点。現地で買える点数の範囲で見る */
const TOP_N_LIST = [6, 12, 24];
/** ビンの数（10%刻み） */
const BIN_COUNT = 10;

interface Sample {
  race: CardRace;
  /** 実際の着順（1〜3着の艇番） */
  order: Boat[];
  /** 100円あたりの確定配当。賭式名 → 金額 */
  payouts: Map<string, number>;
}

/** 成績ファイルの賭式名（全角） */
const TRIFECTA = '３連単';
const TRIO = '３連複';

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function asBoat(value: unknown): Boat | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6
    ? (value as Boat)
    : null;
}

/** 番組表と成績を突き合わせて、検証に使えるレースだけを集める */
function loadSamples(): Sample[] {
  const samples: Sample[] = [];
  const cardFiles = readdirSync(CARDS_DIR).filter((name) => /^\d{8}\.json$/.test(name));

  for (const name of cardFiles) {
    let history: Record<string, unknown>;
    try {
      history = readJson(join(HISTORY_DIR, name)) as Record<string, unknown>;
    } catch {
      continue; // 成績が無い日は検証できない
    }
    const { card } = parseRaceCard(readFileSync(join(CARDS_DIR, name), 'utf8'));
    if (!card) continue;

    const byRace = new Map<number, { order: Boat[]; payouts: Map<string, number> }>();
    for (const raw of (history.races as Record<string, unknown>[]) ?? []) {
      const raceNo = raw.raceNo;
      const order = Array.isArray(raw.order) ? raw.order.map(asBoat) : [];
      // 失格・返還があると order が欠ける。3着まで揃っているレースだけ使う
      if (typeof raceNo !== 'number' || order.length !== 3 || order.some((b) => b === null)) {
        continue;
      }
      const payouts = new Map<string, number>();
      for (const payout of (raw.payouts as Record<string, unknown>[]) ?? []) {
        const betType = payout.betType;
        const amount = payout.amount;
        // 同着で複数行になる賭式があるので、最初の1件だけ使う（3連単・3連複は基本1件）
        if (typeof betType === 'string' && typeof amount === 'number' && !payouts.has(betType)) {
          payouts.set(betType, amount);
        }
      }
      byRace.set(raceNo, { order: order as Boat[], payouts });
    }

    for (const race of card.races) {
      const entry = byRace.get(race.raceNo);
      if (!race.ok || race.boats.length !== 6 || !entry) continue;
      samples.push({ race, order: entry.order, payouts: entry.payouts });
    }
  }
  return samples;
}

/** そのレースの評価スコア。当日実測は混ぜない（過去日の検証なので当日の記録は無い） */
function scoresFor(race: CardRace) {
  return buildSuggestion(race, {}, 0)?.scores ?? null;
}

/**
 * 3連単の対数損失。実際の着順そのものにモデルが与えた確率で測る。
 *
 * 1着だけを見る対数損失では、2着3着の見立ての良し悪しが分からない。
 * 期待値は3連単の確率に比例するので、ここを合わせないと「穴」が
 * モデルの誤差だけを拾って跳ね上がる（8/9 の前売りで実際に起きた）。
 */
function trifectaLogLossAt(
  samples: Sample[],
  temperature: number,
  placeTemperature: number,
): number {
  let total = 0;
  let count = 0;
  for (const sample of samples) {
    const scores = scoresFor(sample.race);
    if (!scores) continue;
    const probability = buildProbabilities(scores, temperature, placeTemperature);
    const p = probability.trifecta.get(trifectaKey(sample.order)) ?? 0;
    total += -Math.log(Math.max(p, 1e-12));
    count += 1;
  }
  return count === 0 ? Number.POSITIVE_INFINITY : total / count;
}

function logLossAt(samples: Sample[], temperature: number): number {
  let total = 0;
  let count = 0;
  for (const sample of samples) {
    const scores = scoresFor(sample.race);
    if (!scores) continue;
    const first = firstProbabilities(scores, temperature);
    // 確率0の対数を避ける。実質的な下限として十分小さい値を入れる
    total += -Math.log(Math.max(first[sample.order[0]], 1e-12));
    count += 1;
  }
  return count === 0 ? Number.POSITIVE_INFINITY : total / count;
}

function main(): void {
  const samples = loadSamples();
  if (samples.length === 0) {
    console.error('検証できるレースがありません。collect-cards.py と collect-history.py を先に実行してください。');
    process.exit(1);
  }

  const days = new Set(samples.map((s) => s.race.raceNo === 1)).size; // 後で正確に数え直す
  console.log(`検証対象: ${samples.length} レース`);

  // --- 1. 温度を選ぶ ---
  let best = { temperature: 1, logLoss: Number.POSITIVE_INFINITY };
  for (let t = 0.2; t <= 3.0001; t += 0.05) {
    const temperature = Math.round(t * 100) / 100;
    const logLoss = logLossAt(samples, temperature);
    if (logLoss < best.logLoss) best = { temperature, logLoss };
  }
  console.log(`最適な温度: ${best.temperature}（対数損失 ${best.logLoss.toFixed(4)}）`);

  // 比較用: 全艇等確率（1/6）のときの対数損失。これを下回らなければモデルに意味がない
  const baselineLogLoss = -Math.log(1 / 6);
  console.log(`  等確率（1/6）の対数損失: ${baselineLogLoss.toFixed(4)}`);

  // --- 1b. 2着以降の温度を選ぶ（1着の温度は固定） ---
  let bestPlace = { temperature: best.temperature, logLoss: Number.POSITIVE_INFINITY };
  for (let t = 0.4; t <= 6.0001; t += 0.2) {
    const placeTemperature = Math.round(t * 10) / 10;
    const logLoss = trifectaLogLossAt(samples, best.temperature, placeTemperature);
    if (logLoss < bestPlace.logLoss) bestPlace = { temperature: placeTemperature, logLoss };
  }
  const sameTemperatureLoss = trifectaLogLossAt(samples, best.temperature, best.temperature);
  // 3連単120通りを等確率で当てにいったときの対数損失
  const trifectaBaseline = -Math.log(1 / 120);
  console.log(
    `2着以降の温度: ${bestPlace.temperature}（3連単の対数損失 ${bestPlace.logLoss.toFixed(4)}）`,
  );
  console.log(`  1着と同じ温度なら ${sameTemperatureLoss.toFixed(4)}`);
  console.log(`  120通り等確率なら ${trifectaBaseline.toFixed(4)}`);

  // --- 2. 較正（予測 vs 実際） ---
  const bins = Array.from({ length: BIN_COUNT }, () => ({ predictedSum: 0, hits: 0, n: 0 }));
  let firstHits = 0;
  const topNHits = new Map(TOP_N_LIST.map((n) => [n, 0]));
  const topNPredicted = new Map(TOP_N_LIST.map((n) => [n, 0]));
  let trifectaSamples = 0;

  for (const sample of samples) {
    const scores = scoresFor(sample.race);
    if (!scores) continue;
    const probability = buildProbabilities(scores, best.temperature, bestPlace.temperature);

    for (const boat of BOATS) {
      const p = probability.first[boat];
      const index = Math.min(BIN_COUNT - 1, Math.floor(p * BIN_COUNT));
      bins[index].predictedSum += p;
      bins[index].n += 1;
      if (sample.order[0] === boat) bins[index].hits += 1;
    }

    // モデルの本命が1着だった率
    const favourite = BOATS.reduce((a, b) =>
      probability.first[a] >= probability.first[b] ? a : b,
    );
    if (favourite === sample.order[0]) firstHits += 1;

    // 3連単の上位N点に実際の着順が入ったか
    const ranked = [...probability.trifecta.entries()].sort((a, b) => b[1] - a[1]);
    const actualKey = trifectaKey(sample.order);
    for (const n of TOP_N_LIST) {
      if (ranked.slice(0, n).some(([key]) => key === actualKey)) {
        topNHits.set(n, (topNHits.get(n) ?? 0) + 1);
      }
      // モデルが「この N 点で当たる」と見た確率。実際の的中率と比べると、
      // 3連単（＝2着3着の見立て）がどれだけ過大かが分かる
      const predicted = ranked.slice(0, n).reduce((total, [, p]) => total + p, 0);
      topNPredicted.set(n, (topNPredicted.get(n) ?? 0) + predicted);
    }
    trifectaSamples += 1;
  }

  const binOutput = bins
    .map((bin, index) => ({
      range: [index / BIN_COUNT, (index + 1) / BIN_COUNT] as [number, number],
      predicted: bin.n ? bin.predictedSum / bin.n : 0,
      actual: bin.n ? bin.hits / bin.n : 0,
      n: bin.n,
    }))
    .filter((bin) => bin.n > 0);

  console.log('\n予測1着確率 vs 実際の1着率');
  for (const bin of binOutput) {
    const gap = bin.actual - bin.predicted;
    console.log(
      `  ${(bin.range[0] * 100).toFixed(0).padStart(3)}〜${(bin.range[1] * 100).toFixed(0).padStart(3)}%: ` +
        `予測 ${(bin.predicted * 100).toFixed(1).padStart(5)}% / 実際 ${(bin.actual * 100).toFixed(1).padStart(5)}% ` +
        `（差 ${gap >= 0 ? '+' : ''}${(gap * 100).toFixed(1)}pt, ${bin.n}件）`,
    );
  }

  console.log('\n3連単 上位N点  モデルの見立て vs 実際');
  for (const n of TOP_N_LIST) {
    const hits = topNHits.get(n) ?? 0;
    const predicted = (topNPredicted.get(n) ?? 0) / trifectaSamples;
    const actual = hits / trifectaSamples;
    console.log(
      `  上位${String(n).padStart(2)}点: 予測 ${(predicted * 100).toFixed(1).padStart(5)}% / ` +
        `実際 ${(actual * 100).toFixed(1).padStart(5)}%  ` +
        `（実際 ÷ 予測 = ${(actual / predicted).toFixed(2)}、${hits}/${trifectaSamples}件）`,
    );
  }
  // 期待値は「モデル確率 × オッズ」で出す。モデルが過大なら期待値も同じ倍率で過大になる
  const trifectaRatio =
    TOP_N_LIST.reduce(
      (total, n) => total + (topNHits.get(n) ?? 0) / (topNPredicted.get(n) ?? 1),
      0,
    ) / TOP_N_LIST.length;
  console.log(
    `\n3連単確率の実際÷予測（平均）: ${trifectaRatio.toFixed(3)}` +
      `${trifectaRatio < 0.9 ? ' ← モデルが過大。期待値もこの倍率で割り引いて読むこと' : ''}`,
  );

  // --- 3. 回収率（実際に買っていたらどうなったか） ---
  //
  // オッズは当日しか取れないので「期待値の高い順に買う」は過去では再現できない。
  // ここで測るのは**確率の高い順に買った場合**。控除率25%の現実がそのまま出る。
  const strategies = [
    { label: '3連単 上位6点', betType: TRIFECTA, points: 6, ordered: true },
    { label: '3連単 上位12点', betType: TRIFECTA, points: 12, ordered: true },
    { label: '3連複 上位3点', betType: TRIO, points: 3, ordered: false },
    { label: '3連複 上位5点', betType: TRIO, points: 5, ordered: false },
  ];

  const simulations = strategies.map((strategy) => {
    let cost = 0;
    let payout = 0;
    let hits = 0;
    let races = 0;

    for (const sample of samples) {
      const scores = scoresFor(sample.race);
      const amount = sample.payouts.get(strategy.betType);
      if (!scores || amount === undefined) continue;

      const probability = buildProbabilities(scores, best.temperature, bestPlace.temperature);
      const source = strategy.ordered ? probability.trifecta : probability.trio;
      const picks = [...source.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, strategy.points)
        .map(([key]) => key);

      const actual = strategy.ordered
        ? sample.order.join('-')
        : [...sample.order].sort((a, b) => a - b).join('-');

      races += 1;
      cost += strategy.points * 100;
      if (picks.includes(actual)) {
        hits += 1;
        payout += amount;
      }
    }

    return {
      label: strategy.label,
      races,
      hits,
      hitRate: races ? hits / races : 0,
      cost,
      payout,
      roi: cost ? payout / cost : 0,
    };
  });

  console.log('\n過去データで「確率の高い順に買っていたら」の回収率');
  console.log('  （1点100円。オッズではなく実際の確定配当で計算）');
  for (const simulation of simulations) {
    console.log(
      `  ${simulation.label.padEnd(14)}: 的中 ${simulation.hits}/${simulation.races}` +
        `（${(simulation.hitRate * 100).toFixed(1)}%）  ` +
        `回収率 ${(simulation.roi * 100).toFixed(1)}%  ` +
        `[${simulation.cost.toLocaleString()}円 → ${simulation.payout.toLocaleString()}円]`,
    );
  }

  const dayCount = new Set(
    readdirSync(CARDS_DIR).filter((name) => /^\d{8}\.json$/.test(name)),
  ).size;

  const payload = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    days: dayCount,
    races: samples.length,
    temperature: best.temperature,
    /** 2着・3着に使う温度。1着と別に較正した値 */
    placeTemperature: bestPlace.temperature,
    logLoss: Number(best.logLoss.toFixed(4)),
    /** 3連単（着順そのもの）の対数損失。120通り等確率なら 4.7875 */
    trifectaLogLoss: Number(bestPlace.logLoss.toFixed(4)),
    /** 全艇等確率のときの対数損失。モデルがこれを下回っていなければ意味がない */
    baselineLogLoss: Number(baselineLogLoss.toFixed(4)),
    /** モデルの本命が1着だった率 */
    favouriteHitRate: Number((firstHits / samples.length).toFixed(4)),
    bins: binOutput.map((bin) => ({
      range: bin.range,
      predicted: Number(bin.predicted.toFixed(4)),
      actual: Number(bin.actual.toFixed(4)),
      n: bin.n,
    })),
    topN: TOP_N_LIST.map((n) => ({
      n,
      /** モデルが「当たる」と見た確率の平均 */
      predicted: Number(((topNPredicted.get(n) ?? 0) / trifectaSamples).toFixed(4)),
      hitRate: Number(((topNHits.get(n) ?? 0) / trifectaSamples).toFixed(4)),
      samples: trifectaSamples,
    })),
    /**
     * 3連単確率の「実際 ÷ 予測」。1.0 なら見立てどおり、1.0 未満はモデルが過大。
     * 期待値はモデル確率に比例するので、この倍率を掛けて読むのが実態に近い。
     */
    trifectaRatio: Number(trifectaRatio.toFixed(3)),
    /**
     * 過去データで「確率の高い順に買っていたら」の回収率。
     * オッズは当日しか取れないので、期待値順に買う戦略はここでは再現できない。
     * **控除率25%の現実がそのまま出る数字**で、モデルの実力の目安になる。
     */
    simulations: simulations.map((simulation) => ({
      label: simulation.label,
      races: simulation.races,
      hits: simulation.hits,
      hitRate: Number(simulation.hitRate.toFixed(4)),
      roi: Number(simulation.roi.toFixed(4)),
    })),
  };

  writeFileSync(OUT_PATH, JSON.stringify(payload, null, 1), 'utf8');
  console.log(`\n書き出し: ${OUT_PATH}`);
  console.log(
    `本命の1着率 ${(payload.favouriteHitRate * 100).toFixed(1)}%（${samples.length}レース）。` +
      'これは「モデルが一番強いと見た艇が実際に勝った割合」で、儲かるかどうかとは別の話。',
  );
  void days;
}

main();
