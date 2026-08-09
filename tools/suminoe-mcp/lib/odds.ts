/**
 * 公式サイトから3連単オッズを取得する。
 *
 * **オッズは刻々と変わる。** 返り値には必ず取得時刻を添え、呼び出し側もそれを添えて扱うこと。
 * ここが返すのは「いまいくらか」だけで、買うべきかどうかは扱わない。
 *
 * 公式サイトへの礼儀として、リクエストは1.5秒以上あける（collect-history.py と同じ）。
 * 同じレースを繰り返し聞かれることがあるので60秒だけメモリにキャッシュする。
 *
 * ## ページ構造（2026-08-08 の実データで確認）
 *
 * 3連単オッズ表は「1着艇＝列、2着艇＝rowspan=4 のまとまり、3着艇＝行」で組まれている。
 *
 *     <thead> 1 松山 | 2 内田 | 3 野相 | ...        ← 列 = 1着艇
 *     <tbody>
 *       <tr>
 *         <td rowspan=4>2</td><td>3</td><td class="oddsPoint">22.2</td>   ← 1-2-3 = 22.2
 *         <td rowspan=4>1</td><td>3</td><td class="oddsPoint">163.1</td>  ← 2-1-3 = 163.1
 *         ...（6列ぶん）
 *
 * rowspan の td は4行に1度しか現れないので、列ごとに直前の2着艇を持ち回す。
 */

import * as cheerio from 'cheerio';

export type OddsBetType = 'trifecta' | 'trio';

export interface OddsEntry {
  combo: number[];
  odds: number | null;
}

export interface RaceOdds {
  date: string;
  raceNo: number;
  betType: OddsBetType;
  /** 取得時刻（ISO）。表示するときは必ずこれを添える */
  fetchedAt: string;
  entries: OddsEntry[];
}

const ODDS_URL_BY_TYPE: Record<OddsBetType, string> = {
  trifecta: 'https://www.boatrace.jp/owpc/pc/race/odds3t',
  trio: 'https://www.boatrace.jp/owpc/pc/race/odds3f',
};
/** 住之江 */
const JCD = 12;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const CACHE_TTL_MS = 60_000;
const MIN_INTERVAL_MS = 1_500;

const cache = new Map<string, { at: number; data: RaceOdds }>();
let lastRequestAt = 0;

export function oddsUrl(date: string, raceNo: number, betType: OddsBetType = 'trifecta'): string {
  const base = ODDS_URL_BY_TYPE[betType];
  return `${base}?rno=${raceNo}&jcd=${JCD}&hd=${date.replaceAll('-', '')}`;
}

/**
 * "22.2" を 22.2 に。"欠場" など数値でないものは null。
 *
 * **0.0 も null にする。** 0倍という払戻はありえない。前売りの早い時間帯は
 * まだ売れていない組み合わせが 0.0 と表示される（8/9 朝の1Rで15件あった）。
 * これを 0 のまま通すと期待値が 0 になり、「絶対に買ってはいけない買い目」として
 * 扱われてしまう。正しくは「オッズがまだ分からない」。
 */
function toOdds(text: string): number | null {
  const trimmed = text.replace(/\s/g, '');
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const value = Number.parseFloat(trimmed);
  return value > 0 ? value : null;
}

/** "3" を 3 に。空欄（&nbsp;）や想定外の文字列は null */
function toBoat(text: string): number | null {
  const value = Number.parseInt(text.trim(), 10);
  return Number.isInteger(value) && value >= 1 && value <= 6 ? value : null;
}

/**
 * 「1つ目＝列、2つ目＝rowspan のまとまり、3つ目＝行」で組まれたオッズ表を読む。
 * 3連単（odds3t）も3連複（odds3f）もこの形。
 *
 * **3連複では空セルが混じる。** 列ごとに組み合わせの数が違い（艇1の列は10通り、
 * 艇4の列は1通り）、まだ始まっていない列には中身が空のセルが rowspan 付きで並ぶ。
 * 艇番として読めないセルを弾かないと NaN が混じり、存在しない組み合わせを拾う。
 */
function parseOddsGrid(html: string): { combo: [number, number, number]; odds: number | null }[] {
  const $ = cheerio.load(html);
  const oddsCells = $('td.oddsPoint');
  // 発売前のページは表の枠だけがあってオッズが入っていない
  if (oddsCells.length === 0) return [];

  const table = oddsCells.first().closest('table');
  if (table.length === 0) return [];

  const firsts = table
    .find('thead th')
    .toArray()
    .map((th) => Number.parseInt($(th).text().trim(), 10))
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= 6);
  if (firsts.length !== 6) return [];

  const seconds: (number | null)[] = new Array(6).fill(null);
  const found: { combo: [number, number, number]; odds: number | null }[] = [];

  table.find('tbody tr').each((_, tr) => {
    const cells = $(tr).find('td').toArray();
    let column = 0;
    /** オッズセルが来るまで溜める。1列ぶんの区切りはオッズセル */
    let group: typeof cells = [];

    for (const cell of cells) {
      group.push(cell);
      if (!$(cell).hasClass('oddsPoint')) continue;
      if (column >= 6) break;

      // グループは [2つ目, 3つ目, オッズ] か [3つ目, オッズ]。
      // rowspan 属性では判別しない（各列の最終行は rowspan が省略される）。
      const third = group.length >= 2 ? toBoat($(group[group.length - 2]).text()) : null;
      if (group.length >= 3) {
        const second = toBoat($(group[group.length - 3]).text());
        if (second !== null) seconds[column] = second;
      }

      const second = seconds[column];
      if (
        third !== null &&
        second !== null &&
        new Set([firsts[column], second, third]).size === 3
      ) {
        found.push({
          combo: [firsts[column], second, third],
          odds: toOdds($(cell).text()),
        });
      }
      column += 1;
      group = [];
    }
  });

  return found;
}

export function parseOdds3t(html: string, date: string, raceNo: number): RaceOdds | null {
  if (html.trim() === '') return null;

  const entries = parseOddsGrid(html);
  if (entries.length === 0) return null;

  return {
    date,
    raceNo,
    betType: 'trifecta',
    fetchedAt: new Date().toISOString(),
    entries,
  };
}

/** 3連複は 6C3 = 20 通り */
const TRIO_COMBINATIONS = 20;

/**
 * 3連複オッズを読む。組み合わせは昇順に均す（順不同の賭式なので）。
 *
 * 20通り揃わなければ null を返す。欠けたまま返すと、
 * 「オッズが無い＝買えない」のか「読めていない」のか区別できなくなる。
 */
export function parseOdds3f(html: string, date: string, raceNo: number): RaceOdds | null {
  if (html.trim() === '') return null;

  const grid = parseOddsGrid(html);
  // 3連単のページ（120通り）を均すと 20 通りになってしまうので、
  // 均す前の件数で種別を判別する
  if (grid.length !== TRIO_COMBINATIONS) return null;

  const byCombo = new Map<string, OddsEntry>();
  for (const entry of grid) {
    const combo = [...entry.combo].sort((a, b) => a - b);
    byCombo.set(combo.join('-'), { combo, odds: entry.odds });
  }

  if (byCombo.size !== TRIO_COMBINATIONS) return null;

  return {
    date,
    raceNo,
    betType: 'trio',
    fetchedAt: new Date().toISOString(),
    entries: [...byCombo.values()],
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 公式サイトから取得する。取れない（発売前・非開催日・構造変更）ときは null */
export async function fetchOdds(
  date: string,
  raceNo: number,
  betType: OddsBetType = 'trifecta',
): Promise<RaceOdds | null> {
  const key = `${date}-${raceNo}-${betType}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

  const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();

  try {
    const response = await fetch(oddsUrl(date, raceNo, betType), {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!response.ok) return null;
    const html = await response.text();
    const parsed =
      betType === 'trio'
        ? parseOdds3f(html, date, raceNo)
        : parseOdds3t(html, date, raceNo);
    if (parsed !== null) cache.set(key, { at: Date.now(), data: parsed });
    return parsed;
  } catch {
    return null;
  }
}
