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

export type OddsBetType = 'trifecta';

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

const ODDS_URL = 'https://www.boatrace.jp/owpc/pc/race/odds3t';
/** 住之江 */
const JCD = 12;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const CACHE_TTL_MS = 60_000;
const MIN_INTERVAL_MS = 1_500;

const cache = new Map<string, { at: number; data: RaceOdds }>();
let lastRequestAt = 0;

export function oddsUrl(date: string, raceNo: number): string {
  return `${ODDS_URL}?rno=${raceNo}&jcd=${JCD}&hd=${date.replaceAll('-', '')}`;
}

/** "22.2" を 22.2 に。"欠場" など数値でないものは null */
function toOdds(text: string): number | null {
  const trimmed = text.replace(/\s/g, '');
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  return Number.parseFloat(trimmed);
}

export function parseOdds3t(html: string, date: string, raceNo: number): RaceOdds | null {
  if (html.trim() === '') return null;

  const $ = cheerio.load(html);
  const oddsCells = $('td.oddsPoint');
  // 発売前のページは表の枠だけがあってオッズが入っていない
  if (oddsCells.length === 0) return null;

  const table = oddsCells.first().closest('table');
  if (table.length === 0) return null;

  const firsts = table
    .find('thead th')
    .toArray()
    .map((th) => Number.parseInt($(th).text().trim(), 10))
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= 6);
  if (firsts.length !== 6) return null;

  const seconds: (number | null)[] = new Array(6).fill(null);
  const entries: OddsEntry[] = [];

  table.find('tbody tr').each((_, tr) => {
    const cells = $(tr).find('td').toArray();
    let column = 0;
    let index = 0;

    while (index < cells.length && column < 6) {
      const cell = $(cells[index]);
      // rowspan つきの td は「この列の2着艇」。以降4行はこの値が続く
      if (cell.attr('rowspan') !== undefined) {
        seconds[column] = Number.parseInt(cell.text().trim(), 10);
        index += 1;
      }
      if (index + 1 >= cells.length) break;

      const third = Number.parseInt($(cells[index]).text().trim(), 10);
      const odds = toOdds($(cells[index + 1]).text());
      index += 2;

      const second = seconds[column];
      if (
        Number.isInteger(third) &&
        second !== null &&
        new Set([firsts[column], second, third]).size === 3
      ) {
        entries.push({ combo: [firsts[column], second, third], odds });
      }
      column += 1;
    }
  });

  if (entries.length === 0) return null;

  return {
    date,
    raceNo,
    betType: 'trifecta',
    fetchedAt: new Date().toISOString(),
    entries,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 公式サイトから取得する。取れない（発売前・非開催日・構造変更）ときは null */
export async function fetchOdds(date: string, raceNo: number): Promise<RaceOdds | null> {
  const key = `${date}-${raceNo}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

  const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();

  try {
    const response = await fetch(oddsUrl(date, raceNo), {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!response.ok) return null;
    const parsed = parseOdds3t(await response.text(), date, raceNo);
    if (parsed !== null) cache.set(key, { at: Date.now(), data: parsed });
    return parsed;
  } catch {
    return null;
  }
}
