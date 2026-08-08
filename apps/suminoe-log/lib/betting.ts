/**
 * 賭式ごとの買い目を組み立てる。
 *
 * **前提（崩さないこと）**
 * 舟券の控除率は約25%ある。ここで出すのは「その賭式で買うならこういう組み方が定石」
 * という型の提示であって、当たることの保証でも推奨でもない。
 * 金額は扱わない。存在しない精度の確率も出さない。
 *
 * 住之江は枠なり進入がほぼ確定しているため、枠番=進入コースとして扱う。
 * 相手選びのスコアにコース別1着率を織り込むのは、勝率だけで並べると
 * 構造的に不利な外枠（6コースの1着率は1.8%）が上位に来てしまうため。
 */

import { COURSE_FIRST_RATE, MIN_LOGS_FOR_READING } from './baseline';
import type { CardRace, Verdict } from './raceCard';
import { BOATS, type Boat } from './types';

/**
 * コース補正の強さ。1着率(%)をこの値で割って勝率スケール（おおむね 2.0〜7.5）に足す。
 *
 * 値の決め方: 1コースと2コースの補正差が「勝率差いくつ分に相当するか」で調整した。
 *   14 のとき 1コース +4.01 / 2コース +1.09 → 差 2.93
 * つまり2号艇が1号艇より勝率2.93以上上回って初めて軸が移る。
 * 「1号艇がB級で当地3.59、2号艇がA1で当地7.29」なら2号艇が軸になり、
 * 「1号艇5.00、2号艇7.20」程度なら1号艇の軸を維持する。実際の人気の付き方に近い。
 *
 * これを 10 にすると差が 4.10 になり、A1トップが外にいても常に1号艇が軸になって
 * しまう（住之江の水面特性を過大評価した状態）。2026-08-06 の実データで確認済み。
 */
const COURSE_WEIGHT_FIRST = 14;

/**
 * 2・3着の相手選びはコースの影響が1着より小さい。
 * 1着率の1コース/6コース比は約31倍だが、2連対率の差はそこまで開かないため、
 * 1着の補正の半分程度の効き（1コース +2.01 / 2コース +0.54）にしている。
 */
const COURSE_WEIGHT_PLACE = 28;

/**
 * 展示で速いと見た艇に足す評価（勝率スケール）。
 *
 * 展示走行は現地の電光掲示板でしか分からない直前情報で、事前の分析には入っていない。
 * ただし「速く見えた」という主観1つで判断を大きく動かすべきではないので、
 * 1コースと2コースのコース補正差（2.93）より小さい +0.6 に留める。
 * 勝率0.6の差は「B1級の上位とA2級の下位」程度の開きにあたる。
 */
export const TENJI_BONUS = 0.6;

/** 当日実測をコース別1着率に混ぜる上限。母数が小さいので控えめに寄せる。 */
const MAX_ACTUAL_WEIGHT = 0.5;
/** この母数で上限の重みに達する */
const ACTUAL_WEIGHT_FULL_N = 24;

export type BetTypeKey =
  | 'trifecta-formation'
  | 'trifecta-box'
  | 'trio'
  | 'exacta'
  | 'quinella'
  | 'wide'
  | 'win'
  | 'place';

export interface BetPlan {
  key: BetTypeKey;
  /** 賭式の名前 */
  name: string;
  /** 何が当たれば的中かの説明（初心者向け） */
  hitCondition: string;
  /** 買い目の表記（例: 1-{2,3}-{2,3,4}） */
  formation: string;
  /** 具体的な組み合わせ。3連単なら順番どおり、3連複などは昇順 */
  tickets: Boat[][];
  points: number;
  /** どんなレースに向くか */
  suitedFor: string;
  /** このレースの判定で定石とされる型か */
  primary: boolean;
}

export interface BoatScore {
  teiban: Boat;
  firstScore: number;
  placeScore: number;
}

export interface BetSuggestion {
  /** 1着候補の筆頭（軸） */
  anchor: Boat;
  /** 軸を除いた相手の評価順 */
  partners: Boat[];
  scores: BoatScore[];
  plans: BetPlan[];
  /** コース別1着率に当日実測を混ぜた重み（0なら基準値のみ） */
  actualWeight: number;
  /** 軸が1号艇でない場合の注意 */
  anchorNote: string | null;
  /** 展示で速いと見て評価を上げた艇。反映していなければ null */
  tenjiFast: Boat | null;
}

/**
 * コース別1着率に当日の実測を混ぜる。
 *
 * 母数が小さいうちは基準値をほぼそのまま使う（縮小推定）。
 * 少ないサンプルで断定的に振らないための措置。
 */
export function blendCourseRates(
  actualRates: Partial<Record<Boat, number | null>>,
  resultCount: number,
): { rates: Record<Boat, number>; weight: number } {
  const weight =
    resultCount < MIN_LOGS_FOR_READING
      ? 0
      : Math.min(MAX_ACTUAL_WEIGHT, resultCount / ACTUAL_WEIGHT_FULL_N);

  const rates = {} as Record<Boat, number>;
  for (const course of BOATS) {
    const baseline = COURSE_FIRST_RATE[course];
    const actual = actualRates[course];
    rates[course] =
      weight === 0 || actual === null || actual === undefined
        ? baseline
        : baseline * (1 - weight) + actual * weight;
  }
  return { rates, weight };
}

function scoreBoats(
  race: CardRace,
  courseRates: Record<Boat, number>,
  tenjiFast: Boat | null,
): BoatScore[] {
  return race.boats
    .map((boat) => {
      // 展示で速く見えた艇は、その日その時点の調子として評価に足す
      const tenji = tenjiFast === boat.teiban ? TENJI_BONUS : 0;
      return {
        teiban: boat.teiban,
        firstScore: boat.evalShoritsu + tenji + courseRates[boat.teiban] / COURSE_WEIGHT_FIRST,
        placeScore: boat.evalShoritsu + tenji + courseRates[boat.teiban] / COURSE_WEIGHT_PLACE,
      };
    })
    .sort((a, b) => b.firstScore - a.firstScore || a.teiban - b.teiban);
}

function formatSet(boats: Boat[]): string {
  const unique = [...new Set(boats)].sort((a, b) => a - b);
  return unique.length === 1 ? String(unique[0]) : `{${unique.join(',')}}`;
}

/** 順番が意味を持つ賭式の組み合わせを列挙する */
function permutationsFrom(firsts: Boat[], seconds: Boat[], thirds?: Boat[]): Boat[][] {
  const tickets: Boat[][] = [];
  for (const first of firsts) {
    for (const second of seconds) {
      if (second === first) continue;
      if (!thirds) {
        tickets.push([first, second]);
        continue;
      }
      for (const third of thirds) {
        if (third === first || third === second) continue;
        tickets.push([first, second, third]);
      }
    }
  }
  return tickets;
}

/** 順不同の賭式。軸を必ず含み、残りを候補から選ぶ */
function combinationsWithAnchor(anchor: Boat, pool: Boat[], size: number): Boat[][] {
  const tickets: Boat[][] = [];
  const walk = (start: number, current: Boat[]) => {
    if (current.length === size - 1) {
      tickets.push([anchor, ...current].sort((a, b) => a - b));
      return;
    }
    for (let i = start; i < pool.length; i += 1) {
      walk(i + 1, [...current, pool[i]]);
    }
  };
  walk(0, []);
  return tickets;
}

/** 判定ごとに、定石とされる賭式を決める */
function primaryKeys(verdict: Verdict | null): BetTypeKey[] {
  switch (verdict) {
    case '勝負':
      return ['trifecta-formation'];
    case '見送り':
      return ['place', 'wide'];
    case '標準':
      return ['trio', 'exacta'];
    default:
      return ['trio'];
  }
}

export function buildSuggestion(
  race: CardRace,
  actualRates: Partial<Record<Boat, number | null>>,
  resultCount: number,
  /** 展示で速いと見た艇。現地で入力された直前情報を反映する */
  tenjiFast: Boat | null = null,
): BetSuggestion | null {
  if (!race.ok || race.boats.length !== 6) return null;

  const { rates, weight } = blendCourseRates(actualRates, resultCount);
  const scores = scoreBoats(race, rates, tenjiFast);
  const anchor = scores[0].teiban;

  const partners = [...scores]
    .filter((score) => score.teiban !== anchor)
    .sort((a, b) => b.placeScore - a.placeScore || a.teiban - b.teiban)
    .map((score) => score.teiban);

  const top2 = partners.slice(0, 2);
  const top3 = partners.slice(0, 3);
  /**
   * 3連単フォーメーションの3着候補。2着候補も含める（含めないと
   * 「2着2号艇→3着3号艇」が買えず不自然）。2着2艇 × 3着4艇 − 重複2 = 6点。
   * スミノエ・リード側の型提示と同じ組み方に揃えている。
   */
  const top4 = partners.slice(0, 4);
  const primaries = new Set(primaryKeys(race.verdict));

  // 点数は組み合わせを数えて決めるので、ここでは points を持たない形で並べる
  const basePlans: Omit<BetPlan, 'points'>[] = [
    {
      key: 'trifecta-formation',
      name: '3連単フォーメーション',
      hitCondition: '1着・2着・3着を順番どおり当てる',
      formation: `${anchor}-${formatSet(top2)}-${formatSet(top4)}`,
      tickets: permutationsFrom([anchor], top2, top4),
      suitedFor: '軸が信頼できて、相手が絞れているとき',
      primary: primaries.has('trifecta-formation'),
    },
    {
      key: 'trifecta-box',
      name: '3連単ボックス',
      hitCondition: '選んだ3艇が1〜3着を独占すれば、順番はどれでも当たる',
      formation: `${[anchor, ...top2].sort((a, b) => a - b).join('・')} のボックス`,
      tickets: permutationsFrom(
        [anchor, ...top2],
        [anchor, ...top2],
        [anchor, ...top2],
      ),
      suitedFor: '3艇は堅いが、着順の並びが読めないとき',
      primary: primaries.has('trifecta-box'),
    },
    {
      key: 'trio',
      name: '3連複',
      hitCondition: '1〜3着に入る3艇を当てる（順番は不問）',
      formation: `${anchor}-${formatSet(top3)} から2艇`,
      tickets: combinationsWithAnchor(anchor, top3, 3),
      suitedFor: '3連単より当たりやすい。着順まで読み切れないとき',
      primary: primaries.has('trio'),
    },
    {
      key: 'exacta',
      name: '2連単',
      hitCondition: '1着と2着を順番どおり当てる',
      formation: `${anchor}-${formatSet(top2)}`,
      tickets: permutationsFrom([anchor], top2),
      suitedFor: '軸の1着が濃厚で、相手を2艇に絞れるとき',
      primary: primaries.has('exacta'),
    },
    {
      key: 'quinella',
      name: '2連複',
      hitCondition: '1着と2着に入る2艇を当てる（順番は不問）',
      formation: `${anchor}=${formatSet(top2)}`,
      tickets: combinationsWithAnchor(anchor, top2, 2),
      suitedFor: '2艇は絞れるが、どちらが勝つか読めないとき',
      primary: primaries.has('quinella'),
    },
    {
      key: 'wide',
      name: 'ワイド（拡連複）',
      hitCondition: '選んだ2艇がどちらも3着以内に入れば当たる',
      formation: `${anchor}=${formatSet(top2)}`,
      tickets: combinationsWithAnchor(anchor, top2, 2),
      suitedFor: '当たりやすさ重視。荒れそうな日の保険',
      primary: primaries.has('wide'),
    },
    {
      key: 'win',
      name: '単勝',
      hitCondition: '1着の艇を当てる',
      formation: `${anchor}`,
      tickets: [[anchor]],
      suitedFor: '軸の1着を強く見込めるとき',
      primary: primaries.has('win'),
    },
    {
      key: 'place',
      name: '複勝',
      hitCondition: '選んだ艇が2着以内に入れば当たる',
      formation: `${anchor}`,
      tickets: [[anchor]],
      suitedFor: '一番当たりやすい。読みどころが薄い日',
      primary: primaries.has('place'),
    },
  ];

  const plans: BetPlan[] = basePlans.map((plan) => ({
    ...plan,
    points: plan.tickets.length,
  }));

  return {
    anchor,
    partners,
    scores,
    plans,
    actualWeight: weight,
    tenjiFast,
    anchorNote:
      anchor === 1
        ? null
        : `評価が最も高いのは${anchor}号艇です。住之江は1コースの1着率が${COURSE_FIRST_RATE[1]}%と高いため、1号艇を切る判断は慎重に。`,
  };
}

export function formatTicket(ticket: Boat[], ordered: boolean): string {
  return ticket.join(ordered ? '-' : '=');
}

export const ORDERED_KEYS: ReadonlySet<BetTypeKey> = new Set<BetTypeKey>([
  'trifecta-formation',
  'trifecta-box',
  'exacta',
]);
