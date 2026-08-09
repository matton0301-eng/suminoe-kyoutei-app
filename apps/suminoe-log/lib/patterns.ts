/**
 * レースごとの買い方を3つの型にまとめる（堅実／勝負／穴）。
 *
 * **これは推奨ではない。** 控除率25%は動かないので、長く買えば平均して減る。
 * ここでやっているのは「同じレースを買うなら、どの組み方がモデル上どうなるか」を
 * 並べることだけ。期待値が1.0を下回れば、下回ったまま表示する。
 *
 * 期待値 = Σ(確率 × オッズ) ÷ 点数。1点100円で買ったときの回収率の見立て。
 * **モデル確率が正しい前提の数字**であって、実際の回収率ではない。
 * 較正の結果（`public/calibration.json`）を必ず一緒に見せること。
 */

import type { BetSuggestion } from './betting';
import type { RaceOddsData } from './odds';
import { trifectaKey, trioKey, type RaceProbability } from './probability';
import type { Boat } from './types';

export type PatternKey = 'steady' | 'challenge' | 'longshot';

/**
 * 市場の暗黙確率に対して、モデル確率がこの倍率を超える買い目は選ばない。
 *
 * **期待値の高い順に選ぶ操作は、モデルと市場が最も食い違う点を選ぶ操作と同じ。**
 * 8/9 の前売りで期待値7.2倍という買い目が出たが、中身はモデルが 1.0%、
 * 市場が 0.1% と見ている組み合わせだった。市場は数千万円の投票が集約された
 * 見立てで、こちらは63開催日のデータで作ったモデル。10倍の差がついたとき、
 * モデル側が誤っている可能性のほうが高い。
 *
 * 3 にしているのは、控除率25%（市場の期待値0.75）と掛けて
 * 「期待値2.25倍まで」を上限にする意図。これを超える数字は現実には出ない。
 */
const MAX_EDGE_RATIO = 3;

/** 堅実で買う3連複の点数。増やすほど当たりやすく、1点あたりの妙味は薄まる */
const STEADY_POINTS = 3;
/** 勝負で買う3連単の点数 */
const CHALLENGE_POINTS = 6;
/** 穴の上限点数 */
const LONGSHOT_MAX_POINTS = 4;
/** 穴とみなすオッズの下限 */
const LONGSHOT_MIN_ODDS = 50;
/** 1点あたりの期待値がこれ以上なら「割に合う」 */
const BREAK_EVEN = 1;

export interface PatternTicket {
  boats: Boat[];
  /** モデル上の的中確率 */
  probability: number;
  /** オッズ。まだ売れていない組み合わせは null */
  odds: number | null;
  /** オッズから逆算した市場の見立て。控除率を除いて正規化してある */
  marketProbability: number | null;
}

/**
 * オッズから市場の暗黙確率を作る。
 *
 * 1/オッズ の合計は控除率のぶん1を超える（住之江で実測 1.335 ≒ 1/0.75）。
 * 合計で割って確率に均す。取得できていない組み合わせは分母に入らないので、
 * 発売直後で歯抜けのときはやや大きめに出る。
 */
function marketProbabilities(oddsMap: Map<string, number>): Map<string, number> {
  const total = [...oddsMap.values()].reduce((sum, odds) => sum + 1 / odds, 0);
  const market = new Map<string, number>();
  if (total <= 0) return market;
  for (const [key, odds] of oddsMap) {
    market.set(key, 1 / odds / total);
  }
  return market;
}

/** モデルが市場より何倍強気に見ているか。市場の値が無ければ null */
export function edgeRatio(ticket: PatternTicket): number | null {
  if (ticket.marketProbability === null || ticket.marketProbability <= 0) return null;
  return ticket.probability / ticket.marketProbability;
}

/** 市場と食い違いすぎる買い目を落とす（モデル側の誤りである可能性が高いため） */
function withinEdgeLimit(ticket: PatternTicket): boolean {
  const edge = edgeRatio(ticket);
  return edge === null || edge <= MAX_EDGE_RATIO;
}

export interface BetPattern {
  key: PatternKey;
  /** 画面に出す名前 */
  label: string;
  betTypeName: '3連単' | '3連複';
  /** 表記が順序を持つか（3連単は true） */
  ordered: boolean;
  tickets: PatternTicket[];
  points: number;
  /** モデル上の的中率（選んだ点の確率合計） */
  hitProbability: number;
  /** 1点100円で買ったときの回収率の見立て。オッズが揃わなければ null */
  expectedValue: number | null;
  oddsRange: [number, number] | null;
  /**
   * モデル確率 ÷ 市場の暗黙確率。1.0 なら市場と同じ見立て。
   * 期待値が1.0を超えるのは、この値が 1/0.75 = 1.33 を超えたときだけ。
   * **大きいほど「モデルが市場と食い違っている」だけで、当たりやすいわけではない。**
   */
  edgeRatio: number | null;
  /** この型を選んだ理由 */
  reason: string;
  /** 注意。無ければ null */
  caution: string | null;
}

function toBoats(key: string): Boat[] {
  return key.split('-').map((value) => Number(value) as Boat);
}

/** 期待値（回収率の見立て）。オッズが1つでも欠けたら出さない */
function expectedValueOf(tickets: PatternTicket[]): number | null {
  if (tickets.length === 0) return null;
  if (tickets.some((ticket) => ticket.odds === null)) return null;
  const total = tickets.reduce((sum, ticket) => sum + ticket.probability * (ticket.odds ?? 0), 0);
  return total / tickets.length;
}

function oddsRangeOf(tickets: PatternTicket[]): [number, number] | null {
  const values = tickets
    .map((ticket) => ticket.odds)
    .filter((odds): odds is number => odds !== null);
  return values.length ? [Math.min(...values), Math.max(...values)] : null;
}

function cautionFor(
  tickets: PatternTicket[],
  expectedValue: number | null,
  hasOdds: boolean,
): string | null {
  if (tickets.length === 0) return null;
  if (!hasOdds) return 'オッズがまだ取れていないため、期待値は出していません。';
  if (expectedValue === null) {
    return 'まだ売れていない組み合わせが混ざっているため、期待値は出していません。';
  }
  if (expectedValue < BREAK_EVEN) {
    return `モデル上は割に合いません（回収率の見立て ${Math.round(expectedValue * 100)}%）。買わない判断も十分あります。`;
  }
  return null;
}

/** 選んだ点をまとめた「モデル ÷ 市場」。確率で重みを付けずに合計同士で比べる */
function patternEdgeRatio(tickets: PatternTicket[]): number | null {
  const usable = tickets.filter(
    (ticket) => ticket.marketProbability !== null && ticket.marketProbability > 0,
  );
  if (usable.length === 0) return null;
  const model = usable.reduce((sum, ticket) => sum + ticket.probability, 0);
  const market = usable.reduce((sum, ticket) => sum + (ticket.marketProbability ?? 0), 0);
  return market > 0 ? model / market : null;
}

function buildPattern(
  key: PatternKey,
  label: string,
  betTypeName: '3連単' | '3連複',
  tickets: PatternTicket[],
  reason: string,
  hasOdds: boolean,
): BetPattern {
  const expectedValue = expectedValueOf(tickets);
  return {
    key,
    label,
    betTypeName,
    ordered: betTypeName === '3連単',
    tickets,
    points: tickets.length,
    hitProbability: tickets.reduce((sum, ticket) => sum + ticket.probability, 0),
    expectedValue,
    oddsRange: oddsRangeOf(tickets),
    edgeRatio: patternEdgeRatio(tickets),
    reason,
    caution: cautionFor(tickets, expectedValue, hasOdds),
  };
}

/** 確率の高い順に並べた候補 */
function rank(
  probabilities: Map<string, number>,
  oddsMap: Map<string, number> | null,
): PatternTicket[] {
  const market = oddsMap ? marketProbabilities(oddsMap) : null;
  return [...probabilities.entries()]
    .map(([key, probability]) => ({
      boats: toBoats(key),
      probability,
      odds: oddsMap?.get(key) ?? null,
      marketProbability: market?.get(key) ?? null,
    }))
    .sort((a, b) => b.probability - a.probability);
}

export function buildPatterns(
  suggestion: BetSuggestion,
  probability: RaceProbability,
  odds: RaceOddsData | null,
): BetPattern[] {
  const trioOdds = odds && odds.trio.size > 0 ? odds.trio : null;
  const trifectaOdds = odds && odds.trifecta.size > 0 ? odds.trifecta : null;

  /**
   * --- 堅実: 3連複の確率上位 ---
   *
   * **乖離が上限を超える点は除く。** 2026-08-09 の 11R で 1=5=6 が
   * モデル16.8% / 市場1.75%（乖離9.6倍）のまま堅実に入り、
   * 表示上の期待値を2.37まで押し上げていた。片方が大きく間違っているとき、
   * 63開催日のモデルより数千万円の投票のほうが正しい可能性が高い。
   * 除かずに残すと、的中率も期待値も同時に水増しされる。
   */
  const steadyTickets = rank(probability.trio, trioOdds)
    .filter(withinEdgeLimit)
    .slice(0, STEADY_POINTS);
  const steady = buildPattern(
    'steady',
    '堅実',
    '3連複',
    steadyTickets,
    `着順を問わない3連複を、確率の高い${STEADY_POINTS}点だけ。当たりやすさを優先した型です。`,
    trioOdds !== null,
  );

  /**
   * --- 勝負: 軸1着固定の3連単を、確率の高い順に ---
   *
   * **期待値順で選ばない。** 8/9 に一度そうしたが、期待値順は
   * 「モデルが市場より強気な点」を上に持ってくる操作と同じで、
   * 本命どおりの決着（オッズが安い＝期待値が低い）を確率が高くても落とす。
   *
   * 戻した理由は**当日の成績ではない**。8/9 の全12レースで測ると
   * 期待値順 1/12・回収率93%、確率順 4/12・回収率85% で、
   * むしろ期待値順のほうが高かった（11R の 6,730円を1本引き当てたため）。
   * **12レースでは何も決まらない。**
   *
   * 戻したのは、確率順が743レースで検証済み（的中率29.2% / 回収率74.7%）なのに対し、
   * 期待値順は過去の全オッズが無く**検証できていない**から。
   * 検証済みの方法を、未検証の方法で置き換えてはいけない。
   * オッズの時系列を貯め終えたら、そのとき初めて比べ直す。
   * 期待値は表示するが、選ぶ基準には使わない。
   */
  const anchorFirst = rank(probability.trifecta, trifectaOdds).filter(
    (ticket) => ticket.boats[0] === suggestion.anchor,
  );
  const challengePool = trifectaOdds
    ? anchorFirst.filter((ticket) => ticket.odds !== null && withinEdgeLimit(ticket))
    : anchorFirst;
  const challengeTickets = challengePool.slice(0, CHALLENGE_POINTS);
  const challenge = buildPattern(
    'challenge',
    '勝負',
    '3連単',
    challengeTickets,
    `${suggestion.anchor}号艇を1着に固定し、確率の高い順に${challengeTickets.length}点。`,
    trifectaOdds !== null,
  );

  // --- 穴: 高オッズかつ1点あたり期待値が1.0以上のものだけ ---
  const longshotTickets = trifectaOdds
    ? rank(probability.trifecta, trifectaOdds)
        .filter(
          (ticket) =>
            ticket.odds !== null &&
            ticket.odds >= LONGSHOT_MIN_ODDS &&
            ticket.probability * ticket.odds >= BREAK_EVEN &&
            withinEdgeLimit(ticket),
        )
        .sort((a, b) => b.probability * (b.odds ?? 0) - a.probability * (a.odds ?? 0))
        .slice(0, LONGSHOT_MAX_POINTS)
    : [];
  const longshot = buildPattern(
    'longshot',
    '穴',
    '3連単',
    longshotTickets,
    longshotTickets.length
      ? `${LONGSHOT_MIN_ODDS}倍以上で、モデル上は割に合う組み合わせ。当たりにくいぶん、少額で。`
      : `${LONGSHOT_MIN_ODDS}倍以上で割に合う組み合わせは該当なしです。無理に作りません。`,
    trifectaOdds !== null,
  );
  if (!trifectaOdds) {
    longshot.caution = 'オッズがまだ取れていないため、穴は出せません。';
  }

  return [steady, challenge, longshot];
}

export function formatPatternTicket(ticket: PatternTicket, ordered: boolean): string {
  return ticket.boats.join(ordered ? '-' : '=');
}

/**
 * この1点が当たっても、その型をまとめ買いした分を取り戻せないか。
 *
 * N点を同額ずつ買うと、1点あたりの賭け金を u として投資は N×u。
 * ある点が当たったときの払戻は オッズ×u なので、
 * **オッズが点数以下なら、当たっても収支がプラスにならない。**
 * 賭け金 u が約分されて消えるので、金額によらず点数とオッズだけで決まる。
 *
 * 2026-08-09 の 8R 1=3=4（2.5倍を3点買い）と
 * 12R 1=2=3（3.0倍を3点買い＝ちょうど同額）で実際に起きた。
 * 買う前に見えていないと意味がないので、買い目カードに出す。
 */
export function losesOnHit(ticket: PatternTicket, points: number): boolean {
  return ticket.odds !== null && ticket.odds <= points;
}

/**
 * 期待度。パチンコの信頼度表示（青→緑→赤→金→虹）から借りた階調。
 *
 * **煽り文句として使わない。** 言葉の横には必ず「的中率◯%」を出す。
 * 「激熱」は感想ではなく「モデル上の的中率30%以上」という定義を持った印で、
 * 競馬新聞の ◎ ○ ▲ と同じ性格のもの。
 *
 * 段階の切り方は、実際に出る値の幅に合わせてある。
 * 3連複3点はおおむね 25〜60%、3連単6点は 10〜30% に収まるので、
 * どちらの賭式も階調の上を動く（3連単で虹が出ることはまず無い）。
 *
 * **色だけで判断できる作りにはしない。** 数字と言葉を必ず添える
 * （色覚特性のある人が読めなくなるため）。
 */
export type HeatLevel = 0 | 1 | 2 | 3 | 4 | 5;

export interface Heat {
  level: HeatLevel;
  /** 画面に出す言葉。level 0 は出さない */
  label: string;
  /** その段に乗るための的中率 */
  threshold: number;
}

const HEAT_LABELS = ['', '注目', '熱', '激熱', '超激熱', '大当たり濃厚'] as const;

/**
 * 段の切り方は賭式ごとに変える。
 *
 * 3連複3点は構造的に当たりやすく、実データ12レースで 27〜54% に固まる。
 * 3連単と同じ物差しを当てると11/12レースが「激熱」以上になり、階調が死ぬ
 * （2026-08-09 の実測で確認した）。同じ言葉でも基準の数字を必ず併記するので、
 * 賭式で基準が違っても画面上は誤解にならない。
 */
const HEAT_THRESHOLDS: Record<'3連単' | '3連複', readonly number[]> = {
  // [注目, 熱, 激熱, 超激熱, 大当たり濃厚]
  '3連複': [0.35, 0.42, 0.48, 0.55, 0.62],
  '3連単': [0.08, 0.13, 0.2, 0.28, 0.38],
};

export function heatOf(hitProbability: number, betTypeName: '3連単' | '3連複' = '3連複'): Heat {
  const thresholds = HEAT_THRESHOLDS[betTypeName];
  for (let level = thresholds.length; level >= 1; level -= 1) {
    if (hitProbability >= thresholds[level - 1]) {
      return {
        level: level as HeatLevel,
        label: HEAT_LABELS[level],
        threshold: thresholds[level - 1],
      };
    }
  }
  return { level: 0, label: '', threshold: 0 };
}

/** 3連単・3連複のキーを作る（呼び出し側で使う） */
export { trifectaKey, trioKey };
