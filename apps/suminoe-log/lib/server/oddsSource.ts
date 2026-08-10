/**
 * 公式サイトからオッズを取る（**サーバー側で動かす**）。
 *
 * **公式サイトは CORS を許可していない。** ブラウザから直接は取れないので、
 * ここを経由する。`app/api/odds/route.ts` から呼ばれる。
 *
 * 元は `tools/suminoe-mcp/lib/odds.ts`。**2つ持っているのは意図的ではない。**
 * Vercel のビルドはアプリのディレクトリ配下しか取り込まないため、
 * 外のファイルを import できない。片方を直したらもう片方も直すこと。
 * fixture とテストは MCP 側にある（`tools/suminoe-mcp/tests/odds*.test.ts`）。
 */

import * as cheerio from 'cheerio';

export type OddsBetType =
  | 'trifecta'
  | 'trio'
  | 'exacta'
  | 'quinella'
  | 'wide'
  | 'win'
  | 'place';

export interface OddsEntry {
  combo: number[];
  odds: number | null;
  /**
   * 上限。**拡連複と複勝は1つの値ではなく幅で出る**（「1.8-2.1」）。
   * 3着までに入る組み合わせが複数あり、どれが来るかで払戻が変わるため。
   * 幅を持たない賭式では undefined。`odds` が下限にあたる。
   */
  oddsMax?: number | null;
}

export interface RaceOdds {
  date: string;
  raceNo: number;
  betType: OddsBetType;
  /** 取得時刻（ISO）。表示するときは必ずこれを添える */
  fetchedAt: string;
  entries: OddsEntry[];
}

/**
 * 賭式ごとのページ。**1ページに2つの賭式が載るものがある。**
 *   odds2tf → 2連単・2連複
 *   oddstf  → 単勝・複勝
 * 同じページを2回取りに行かないよう、取得側でまとめること。
 */
const ODDS_URL_BY_TYPE: Record<OddsBetType, string> = {
  trifecta: 'https://www.boatrace.jp/owpc/pc/race/odds3t',
  trio: 'https://www.boatrace.jp/owpc/pc/race/odds3f',
  exacta: 'https://www.boatrace.jp/owpc/pc/race/odds2tf',
  quinella: 'https://www.boatrace.jp/owpc/pc/race/odds2tf',
  wide: 'https://www.boatrace.jp/owpc/pc/race/oddsk',
  win: 'https://www.boatrace.jp/owpc/pc/race/oddstf',
  place: 'https://www.boatrace.jp/owpc/pc/race/oddstf',
};
/** 住之江 */
const JCD = 12;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const CACHE_TTL_MS = 60_000;
const MIN_INTERVAL_MS = 1_500;

const cache = new Map<string, { at: number; data: RaceOdds }>();
/** 取得済みHTML。1枚に2賭式が載るページを二度取りしないために持つ */
const htmlCache = new Map<string, { at: number; html: string }>();
let lastRequestAt = 0;

type OddsParser = (html: string, date: string, raceNo: number) => RaceOdds | null;

const PARSER_BY_TYPE: Record<OddsBetType, OddsParser> = {
  trifecta: (html, date, raceNo) => parseOdds3t(html, date, raceNo),
  trio: (html, date, raceNo) => parseOdds3f(html, date, raceNo),
  exacta: (html, date, raceNo) => parseOdds2t(html, date, raceNo),
  quinella: (html, date, raceNo) => parseOdds2f(html, date, raceNo),
  wide: (html, date, raceNo) => parseOddsWide(html, date, raceNo),
  win: (html, date, raceNo) => parseOddsWin(html, date, raceNo),
  place: (html, date, raceNo) => parseOddsPlace(html, date, raceNo),
};

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

/**
 * 「1.8-2.1」を下限と上限に分ける。単一値なら上限は null。
 *
 * **範囲を平均や中央値に潰さない。** 拡連複と複勝は「どの組み合わせで来るか」で
 * 払戻が変わる量で、1つの数字にした時点で嘘になる。両端をそのまま持つ。
 */
function toOddsRange(text: string): { odds: number | null; oddsMax: number | null } {
  const trimmed = text.replace(/\s/g, '');
  const ranged = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(trimmed);
  if (ranged) {
    return { odds: toOdds(ranged[1]), oddsMax: toOdds(ranged[2]) };
  }
  return { odds: toOdds(trimmed), oddsMax: null };
}

/** オッズの入った表を順に返す。1ページに2つ載ることがある（2連単＋2連複など） */
function oddsTables($: cheerio.CheerioAPI): ReturnType<cheerio.CheerioAPI> {
  return $('table').filter((_, table) => $(table).find('td.oddsPoint').length > 0);
}

/**
 * 2艇の組み合わせの表を読む（2連単・2連複・拡連複）。
 *
 * 3連単のような入れ子は無く、各行が「艇番・オッズ」の対を6列ぶん並べるだけ。
 * 列の見出しが1つ目の艇、行内の艇番が2つ目の艇。
 *
 * `ordered` が false なら組み合わせを昇順に正規化する（2連複・拡連複）。
 */
function parsePairGrid(
  html: string,
  tableIndex: number,
  ordered: boolean,
): OddsEntry[] {
  const $ = cheerio.load(html);
  const table = oddsTables($).eq(tableIndex);
  if (table.length === 0) return [];

  const firsts = table
    .find('thead th')
    .toArray()
    .map((th) => Number.parseInt($(th).text().trim(), 10))
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= 6);
  if (firsts.length !== 6) return [];

  const found: OddsEntry[] = [];
  const seen = new Set<string>();

  table.find('tbody tr').each((_, tr) => {
    const cells = $(tr).find('td').toArray();
    let column = 0;
    let partner: number | null = null;

    for (const cell of cells) {
      if (!$(cell).hasClass('oddsPoint')) {
        partner = toBoat($(cell).text());
        continue;
      }
      if (column >= 6) break;
      const first = firsts[column];
      if (partner !== null && first !== partner) {
        const combo = ordered ? [first, partner] : [first, partner].sort((a, b) => a - b);
        const key = combo.join('-');
        // 2連複・拡連複は同じ組が2回出るので、先に読んだほうを採る
        if (!seen.has(key)) {
          seen.add(key);
          const { odds, oddsMax } = toOddsRange($(cell).text());
          found.push({ combo, odds, oddsMax });
        }
      }
      partner = null;
      column += 1;
    }
  });

  return found;
}

/** 単勝・複勝。艇ごとに1行の単純な表 */
function parseSingleList(html: string, tableIndex: number): OddsEntry[] {
  const $ = cheerio.load(html);
  const table = oddsTables($).eq(tableIndex);
  if (table.length === 0) return [];

  const found: OddsEntry[] = [];
  table.find('tbody tr').each((_, tr) => {
    const cells = $(tr).find('td').toArray();
    const boat = cells.length > 0 ? toBoat($(cells[0]).text()) : null;
    const oddsCell = cells.find((cell) => $(cell).hasClass('oddsPoint'));
    if (boat === null || !oddsCell) return;
    const { odds, oddsMax } = toOddsRange($(oddsCell).text());
    found.push({ combo: [boat], odds, oddsMax });
  });
  return found;
}

function wrap(
  entries: OddsEntry[],
  betType: OddsBetType,
  date: string,
  raceNo: number,
): RaceOdds | null {
  if (entries.length === 0) return null;
  return { date, raceNo, betType, fetchedAt: new Date().toISOString(), entries };
}

/** 2連単（odds2tf の1つ目の表）。着順どおり */
export function parseOdds2t(html: string, date: string, raceNo: number): RaceOdds | null {
  return wrap(parsePairGrid(html, 0, true), 'exacta', date, raceNo);
}

/** 2連複（odds2tf の2つ目の表）。順不同 */
export function parseOdds2f(html: string, date: string, raceNo: number): RaceOdds | null {
  return wrap(parsePairGrid(html, 1, false), 'quinella', date, raceNo);
}

/** 拡連複（oddsk）。順不同で、オッズは幅を持つ */
export function parseOddsWide(html: string, date: string, raceNo: number): RaceOdds | null {
  return wrap(parsePairGrid(html, 0, false), 'wide', date, raceNo);
}

/** 単勝（oddstf の1つ目の表） */
export function parseOddsWin(html: string, date: string, raceNo: number): RaceOdds | null {
  return wrap(parseSingleList(html, 0), 'win', date, raceNo);
}

/** 複勝（oddstf の2つ目の表）。オッズは幅を持つ */
export function parseOddsPlace(html: string, date: string, raceNo: number): RaceOdds | null {
  return wrap(parseSingleList(html, 1), 'place', date, raceNo);
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
    const url = oddsUrl(date, raceNo, betType);

    /**
     * 同じページを2回取りに行かない。
     * odds2tf は 2連単と2連複、oddstf は 単勝と複勝を1枚で配っている。
     * 賭式ごとに素直に取ると、公式サイトへの要求が2倍になる。
     */
    const cachedHtml = htmlCache.get(url);
    let html: string;
    if (cachedHtml && Date.now() - cachedHtml.at < CACHE_TTL_MS) {
      html = cachedHtml.html;
    } else {
      const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!response.ok) return null;
      html = await response.text();
      htmlCache.set(url, { at: Date.now(), html });
    }

    const parsed = PARSER_BY_TYPE[betType](html, date, raceNo);
    if (parsed !== null) cache.set(key, { at: Date.now(), data: parsed });
    return parsed;
  } catch {
    return null;
  }
}
