/**
 * 複数の視点から軸を出し、一致の度合いを見る。
 *
 * **1つのスコアで軸を決めていると、外したときに何を見誤ったのかが分からない。**
 * 8/9 に 7R で 6号艇を軸にして 1-2-3 で決着したとき、
 * どの材料が間違っていたのかを後から言えなかった。
 *
 * ここでやるのは「別々の材料だけを見る5人の意見を並べる」こと。
 * **一致したら強く、割れたら割れたと出す。** 割れているのを隠して1つの答えに
 * まとめるほうが、よほど危ない。
 *
 * 各視点は独立していること。混ぜて重み付けした時点で「1つのスコア」に戻る。
 */

import type { TenjiRace } from './beforeInfo';
import type { RaceOddsData } from './odds';
import type { CardBoat, CardRace } from './raceCard';
import type { Boat } from './types';

export type LensKey = 'theory' | 'local' | 'motor' | 'tenji' | 'market';

export interface LensSpec {
  key: LensKey;
  label: string;
  /** 何を見ているか */
  what: string;
}

export const LENS_SPECS: readonly LensSpec[] = [
  { key: 'theory', label: 'セオリー', what: 'コースと級別' },
  { key: 'local', label: '当地実績', what: '当地勝率' },
  { key: 'motor', label: 'モーター', what: 'モーター2連率' },
  { key: 'tenji', label: '展示', what: '展示タイム' },
  { key: 'market', label: '市場', what: 'オッズの偏り' },
];

export interface LensPick {
  key: LensKey;
  label: string;
  /** その視点が推す艇。材料が無ければ null */
  anchor: Boat | null;
  /** なぜその艇か（数字を必ず含める） */
  reason: string | null;
  /** 材料が揃っていない理由。anchor が null のときだけ入る */
  missing: string | null;
}

export interface LensVerdict {
  picks: LensPick[];
  /** 材料が揃った視点の数 */
  available: number;
  /** いちばん多く推された艇。並んだ場合は内枠を採る */
  leading: Boat | null;
  /** その艇を推した視点の数 */
  agree: number;
  /** 見立てが揃っているか */
  consensus: 'strong' | 'split' | 'unknown';
}

/** 級別の重み。A1 と B2 の差が、コースの差と釣り合う程度にしてある */
const GRADE_SCORE: Record<string, number> = { A1: 3, A2: 2, B1: 1, B2: 0 };

/**
 * 住之江の1コース1着率は 56.2%。**セオリーの視点はこれを素直に反映する。**
 * 他の視点が別の艇を推したときに「セオリーと違う」と分かることに意味があるので、
 * ここで他の材料を混ぜない。
 */
const COURSE_SCORE: Record<number, number> = { 1: 5.5, 2: 2.0, 3: 1.6, 4: 1.3, 5: 0.7, 6: 0.4 };

function best<T>(items: T[], score: (item: T) => number | null): T | null {
  let top: T | null = null;
  let topScore = -Infinity;
  for (const item of items) {
    const value = score(item);
    if (value === null) continue;
    if (value > topScore) {
      topScore = value;
      top = item;
    }
  }
  return top;
}

function theoryPick(boats: CardBoat[]): LensPick {
  const top = best(boats, (boat) => (COURSE_SCORE[boat.teiban] ?? 0) + (GRADE_SCORE[boat.kyubetsu] ?? 0));
  if (!top) return { key: 'theory', label: 'セオリー', anchor: null, reason: null, missing: '出走表なし' };
  return {
    key: 'theory',
    label: 'セオリー',
    anchor: top.teiban,
    reason: `${top.teiban}コース・${top.kyubetsu}`,
    missing: null,
  };
}

function localPick(boats: CardBoat[]): LensPick {
  const withData = boats.filter((boat) => !boat.noTouchiData && boat.touchiShoritsu > 0);
  if (withData.length === 0) {
    return { key: 'local', label: '当地実績', anchor: null, reason: null, missing: '当地データなし' };
  }
  const top = best(withData, (boat) => boat.touchiShoritsu)!;
  return {
    key: 'local',
    label: '当地実績',
    anchor: top.teiban,
    reason: `当地${top.touchiShoritsu.toFixed(2)}（2率${top.touchiNiritsu.toFixed(1)}%）`,
    missing: null,
  };
}

function motorPick(boats: CardBoat[]): LensPick {
  const withData = boats.filter((boat) => boat.motorNiritsu > 0);
  if (withData.length === 0) {
    return { key: 'motor', label: 'モーター', anchor: null, reason: null, missing: 'モーターデータなし' };
  }
  const top = best(withData, (boat) => boat.motorNiritsu)!;
  return {
    key: 'motor',
    label: 'モーター',
    anchor: top.teiban,
    reason: `${top.motorNo}号機 2連率${top.motorNiritsu.toFixed(1)}%`,
    missing: null,
  };
}

/** 展示タイムは**小さいほど速い**。順位付けの向きを逆にすること */
function tenjiPick(tenji: TenjiRace | null): LensPick {
  const entries = tenji?.available ? tenji.entries.filter((entry) => entry.tenjiTime !== null) : [];
  if (entries.length === 0) {
    return {
      key: 'tenji',
      label: '展示',
      anchor: null,
      reason: null,
      missing: '展示はまだ（締切10〜15分前）',
    };
  }
  const top = best(entries, (boat) => -(boat.tenjiTime ?? Infinity))!;
  return {
    key: 'tenji',
    label: '展示',
    anchor: top.teiban,
    reason: `展示${top.tenjiTime?.toFixed(2)}秒${top.stTime !== null ? ` / ST${top.stTime.toFixed(2)}` : ''}`,
    missing: null,
  };
}

/**
 * 市場の見立て。3連単オッズから1着ごとの暗黙確率を出して、いちばん高い艇を採る。
 *
 * **これはモデルではない。** 数千万円の投票が集約された他人の見立てで、
 * こちらのモデルと食い違ったときに「どちらが変か」を考える材料になる。
 */
function marketPick(odds: RaceOddsData | null): LensPick {
  if (!odds || odds.trifecta.size === 0) {
    return { key: 'market', label: '市場', anchor: null, reason: null, missing: 'オッズ未取得' };
  }
  const weight = new Map<Boat, number>();
  let total = 0;
  for (const [key, value] of odds.trifecta) {
    if (value <= 0) continue;
    const first = Number(key[0]) as Boat;
    weight.set(first, (weight.get(first) ?? 0) + 1 / value);
    total += 1 / value;
  }
  if (total <= 0) {
    return { key: 'market', label: '市場', anchor: null, reason: null, missing: 'オッズ未取得' };
  }
  const ranked = [...weight.entries()].sort((a, b) => b[1] - a[1]);
  const [anchor, share] = ranked[0];
  return {
    key: 'market',
    label: '市場',
    anchor,
    reason: `1着確率 ${((share / total) * 100).toFixed(0)}% と見ている`,
    missing: null,
  };
}

/** 一致した数が multi 以上なら「揃っている」とみなす */
const CONSENSUS_MIN = 4;

export function buildLenses(
  race: CardRace | null,
  tenji: TenjiRace | null,
  odds: RaceOddsData | null,
): LensVerdict {
  const boats = race?.boats ?? [];
  const picks: LensPick[] = [
    theoryPick(boats),
    localPick(boats),
    motorPick(boats),
    tenjiPick(tenji),
    marketPick(odds),
  ];

  const votes = new Map<Boat, number>();
  for (const pick of picks) {
    if (pick.anchor === null) continue;
    votes.set(pick.anchor, (votes.get(pick.anchor) ?? 0) + 1);
  }

  const available = picks.filter((pick) => pick.anchor !== null).length;
  // 同数のときは内枠を採る。住之江の1コース1着率が高い以上、迷ったら内が素直
  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const leading = ranked[0]?.[0] ?? null;
  const agree = ranked[0]?.[1] ?? 0;

  return {
    picks,
    available,
    leading,
    agree,
    consensus: available === 0 ? 'unknown' : agree >= CONSENSUS_MIN ? 'strong' : 'split',
  };
}

/** 画面に出す一言。**割れているときに「本命」と言わない。** */
export function consensusLabel(verdict: LensVerdict): string {
  if (verdict.consensus === 'unknown') return '材料がまだ揃っていません';
  if (verdict.consensus === 'strong') {
    return `${verdict.available}視点中${verdict.agree}が${verdict.leading}号艇。見立てが揃っています`;
  }
  return `${verdict.available}視点中${verdict.agree}どまり。見立てが割れています`;
}

/* ────────────────────────────────────────────
   視点ごとの実績（過去データで測ったもの）
   ──────────────────────────────────────────── */

export type LensStat =
  | { key: LensKey; label: string; measured: false }
  | {
      key: LensKey;
      label: string;
      measured: true;
      races: number;
      /** その視点が推した艇が1着だった割合 */
      firstRate: number;
      /** 3着以内だった割合 */
      top3Rate: number;
    };

export interface LensRecord {
  schemaVersion: number;
  generatedAt: string;
  days: number;
  races: number;
  lenses: LensStat[];
}

export const LENS_RECORD_URL = '/lens-record.json';

export function parseLensRecord(text: string): LensRecord | null {
  try {
    const raw = JSON.parse(text) as LensRecord;
    if (!Array.isArray(raw?.lenses) || raw.lenses.length === 0) return null;
    return raw;
  } catch {
    return null;
  }
}

export async function fetchLensRecord(): Promise<LensRecord | null> {
  try {
    const response = await fetch(LENS_RECORD_URL);
    if (!response.ok) return null;
    return parseLensRecord(await response.text());
  } catch {
    return null;
  }
}

/** その視点の実績。測っていなければ null（それらしい数字を当てはめない） */
export function statOf(record: LensRecord | null, key: LensKey): LensStat | null {
  return record?.lenses.find((entry) => entry.key === key) ?? null;
}
