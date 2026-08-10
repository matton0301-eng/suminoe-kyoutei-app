/**
 * 舟券の券面から買い目を読み取る。
 *
 * 写真から起こした文字列を受け取り、買い目・金額・レースに直す。
 * **OCR そのものはここに入れない。** 読み取りの精度と、読み取った内容の解釈を
 * 分けておかないと、どちらが間違っているのか切り分けられなくなる。
 *
 * 実物の調査は `docs/04-funaken-format.md`。要点:
 *
 *   - **区切り記号は場によって違う**（福岡◆ / 芦屋★）。同じ場でも3連単と3連複で同じ。
 *     **記号から賭式を判定してはいけない。** 縦書きの枠に書かれた券種を読む
 *   - 買い方は3つ。「ボックス」「フォーメーション」の文字が無ければ通常
 *   - **券面には検算用の数字がある**（組合せ数・各組・合計◯枚・合計◯円）。
 *     読み取りが正しいかを券面だけで確かめられる
 *
 * 検算が通らなければ `ok: false` を返す。**合わない読み取りを登録させない。**
 */

import { boxPoints, expandBox, specOf, type BetTypeSpec } from './betBuilder';
import type { Bet } from './bets';
import type { PayoutKey } from './results';
import type { Boat } from './types';

export type BuyStyle = 'normal' | 'box' | 'formation';

export interface TicketCheck {
  label: string;
  ok: boolean;
  detail: string;
}

export interface ParsedTicket {
  style: BuyStyle;
  betType: PayoutKey;
  /** 券面のレース番号。読めなければ null */
  raceNo: number | null;
  /** 券面の開催日（YYYY-MM-DD）。読めなければ null */
  date: string | null;
  /** 展開した買い目 */
  bets: Bet[];
  /** 券面に印字されていた検算用の数字 */
  printed: {
    /** 組合せ数、または「合計◯枚」 */
    points: number | null;
    /** 各組（1点あたり） */
    unitYen: number | null;
    /** 合計金額 */
    totalYen: number | null;
  };
  checks: TicketCheck[];
  /** すべての検算が通ったか。false なら登録させない */
  ok: boolean;
}

export class TicketParseError extends Error {}

/** 券種の表記。**縦書きなので、OCR では1文字ずつ分かれて出ることがある** */
const BET_TYPE_BY_LABEL: Record<string, PayoutKey> = {
  '3連単': 'trifecta',
  '3連複': 'trio',
  '2連単': 'exacta',
  '2連複': 'quinella',
  拡連複: 'wide',
  単勝: 'win',
  複勝: 'place',
};

/**
 * 券面の文字を揃える。
 *
 * 全角数字を半角に、詰め物の記号（◆★☆・）を取り除く。
 * **記号は場によって違うので、意味を持たせず一律に落とす。**
 */
export function normalize(text: string): string {
  return text
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[◆◇★☆■□●○・･,]/g, ' ')
    // **カタカナの長音（ー）を混ぜてはいけない。**
    // 「フォーメーション」が「フォ-メ-ション」になって判定できなくなる（実際に踏んだ）
    .replace(/[‐‑‒–—―−－]/g, '-')
    .replace(/[ \t　]+/g, ' ')
    .trim();
}

/** 縦書きで1文字ずつ分かれても拾えるよう、空白を落とした文字列でも探す */
function findBetType(text: string): PayoutKey | null {
  const squeezed = text.replace(/\s+/g, '');
  // 「拡連複」を「連複」より先に見る（部分一致で取り違えないため）
  const order: string[] = ['拡連複', '3連単', '3連複', '2連単', '2連複', '単勝', '複勝'];
  for (const label of order) {
    if (squeezed.includes(label)) return BET_TYPE_BY_LABEL[label];
  }
  return null;
}

function findStyle(text: string): BuyStyle {
  const squeezed = text.replace(/\s+/g, '');
  if (squeezed.includes('フォーメーション')) return 'formation';
  if (squeezed.includes('ボックス')) return 'box';
  return 'normal';
}

function findRaceNo(text: string): number | null {
  const matched = /(\d{1,2})\s*レース/.exec(text);
  if (!matched) return null;
  const value = Number(matched[1]);
  return value >= 1 && value <= 12 ? value : null;
}

function findDate(text: string): string | null {
  const matched = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(text);
  if (!matched) return null;
  const [, year, month, day] = matched;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/**
 * 「合計 6枚 600円」から金額を拾う。
 *
 * **枚数を金額と読み違えないこと。** 「合計」と「円」の間に枚数が挟まるので、
 * 数字でない文字だけを飛ばす作りだと枚数の「6」を掴んで止まる（実際にそうなった）。
 * 「円」の直前にある数字まで進める。
 */
function yenAfter(text: string, keyword: string): number | null {
  const matched = new RegExp(`${keyword}[^円]{0,40}?(\\d[\\d ]*)\\s*円`).exec(text);
  return matched ? Number(matched[1].replace(/\s/g, '')) : null;
}

/**
 * 買い目ではない行。
 *
 * **券種の「3連単」の3を艇番と読んでしまう**ので、明示的に落とす
 * （3艇のボックスが4艇に化けて24点になった）。
 */
const NOT_A_BOAT_LINE =
  /連単|連複|単勝|複勝|ボックス|フォーメーション|レース|年|月|日|組合せ|各組|合計|枚|円|主催|BOAT|RACE/;

function toBoats(digits: string): Boat[] {
  return [...digits]
    .filter((char) => char >= '1' && char <= '6')
    .map((char) => Number(char) as Boat);
}

/** 「1着-45」の行を拾う。着ごとの候補 */
function findFormationRows(lines: string[]): Map<number, Boat[]> {
  const rows = new Map<number, Boat[]>();
  for (const line of lines) {
    const matched = /([1-3])\s*着\s*-?\s*([1-6][1-6 ]*)/.exec(line);
    if (!matched) continue;
    const boats = toBoats(matched[2]);
    if (boats.length > 0) rows.set(Number(matched[1]), [...new Set(boats)]);
  }
  return rows;
}

/**
 * フォーメーションを展開する。
 *
 * 各着の候補から1つずつ取り、**同じ艇を2か所に使わない**。
 * 順不同の賭式では、並びの違うものを1点にまとめる
 * （公式カードの「重複する組合せは1点として計算します」）。
 */
export function expandFormation(rows: Map<number, Boat[]>, spec: BetTypeSpec): Boat[][] {
  const levels: Boat[][] = [];
  for (let i = 1; i <= spec.size; i += 1) {
    const boats = rows.get(i);
    if (!boats || boats.length === 0) return [];
    levels.push(boats);
  }

  const found: Boat[][] = [];
  const walk = (depth: number, picked: Boat[]) => {
    if (depth === levels.length) {
      found.push([...picked]);
      return;
    }
    for (const boat of levels[depth]) {
      if (picked.includes(boat)) continue;
      walk(depth + 1, [...picked, boat]);
    }
  };
  walk(0, []);

  if (spec.ordered) return found;

  const seen = new Set<string>();
  const unique: Boat[][] = [];
  for (const combo of found) {
    const sorted = [...combo].sort((a, b) => a - b);
    const key = sorted.join('-');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(sorted);
  }
  return unique;
}

/** 通常券の買い目行。「1 3 4 100円」のように、艇と金額が並ぶ */
function findNormalRows(lines: string[], spec: BetTypeSpec): { boats: Boat[]; yen: number }[] {
  const rows: { boats: Boat[]; yen: number }[] = [];
  for (const line of lines) {
    // 「合計」行は買い目ではない
    if (line.includes('合計') || line.includes('組合せ') || line.includes('各組')) continue;
    const matched = new RegExp(`((?:[1-6][ ]*){${spec.size}})\\s*(\\d[\\d ]*)\\s*円`).exec(line);
    if (!matched) continue;
    const boats = toBoats(matched[1]);
    if (boats.length !== spec.size || new Set(boats).size !== spec.size) continue;
    rows.push({ boats, yen: Number(matched[2].replace(/\s/g, '')) });
  }
  return rows;
}

/** ボックス券の艇。選手名の行に艇番が付くので、そこから拾う */
function findBoxBoats(lines: string[]): Boat[] {
  const boats: Boat[] = [];
  for (const line of lines) {
    if (NOT_A_BOAT_LINE.test(line)) continue;
    // 行頭の1桁が艇番。後ろに選手名が続く
    const matched = /^\s*([1-6])\s*\D/.exec(line);
    if (matched) boats.push(Number(matched[1]) as Boat);
  }
  return [...new Set(boats)];
}

function check(label: string, ok: boolean, detail: string): TicketCheck {
  return { label, ok, detail };
}

/**
 * 券面から読み取る。
 *
 * @param raw OCR が起こした文字列（改行込み）
 */
export function parseTicket(raw: string): ParsedTicket {
  const text = normalize(raw);
  const lines = raw
    .split(/\r?\n/)
    .map((line) => normalize(line))
    .filter((line) => line.length > 0);

  const betType = findBetType(text);
  if (!betType) {
    throw new TicketParseError('券種（3連単など）を読み取れませんでした');
  }
  const spec = specOf(betType);
  const style = findStyle(text);

  const printed = {
    points:
      (() => {
        const combos = /組合せ数[^\d]*(\d+)/.exec(text);
        if (combos) return Number(combos[1]);
        const sheets = /合計[^\d]*(\d+)\s*枚/.exec(text);
        return sheets ? Number(sheets[1]) : null;
      })(),
    unitYen: yenAfter(text, '各組'),
    totalYen: yenAfter(text, '合計'),
  };

  let combos: Boat[][] = [];
  let unitYen = printed.unitYen;

  if (style === 'formation') {
    combos = expandFormation(findFormationRows(lines), spec);
    if (combos.length === 0) {
      throw new TicketParseError('フォーメーションの着順欄を読み取れませんでした');
    }
  } else if (style === 'box') {
    const boats = findBoxBoats(lines);
    if (boats.length < spec.size) {
      throw new TicketParseError('ボックスの艇を読み取れませんでした');
    }
    combos = expandBox(boats, spec);
  } else {
    const rows = findNormalRows(lines, spec);
    if (rows.length === 0) {
      throw new TicketParseError('買い目を読み取れませんでした');
    }
    combos = rows.map((row) => row.boats);
    // 通常券は行ごとに金額が付く。すべて同額でなければ行の金額を使う
    unitYen = rows[0].yen;
    if (rows.some((row) => row.yen !== unitYen)) unitYen = null;
    const bets: Bet[] = rows.map((row) => ({
      betType,
      combo: spec.ordered ? row.boats : [...row.boats].sort((a, b) => a - b),
      amountYen: row.yen,
    }));
    return finish(style, betType, text, bets, printed, spec);
  }

  if (unitYen === null) {
    throw new TicketParseError('1点あたりの金額を読み取れませんでした');
  }

  const bets: Bet[] = combos.map((combo) => ({ betType, combo, amountYen: unitYen }));
  return finish(style, betType, text, bets, printed, spec);
}

function finish(
  style: BuyStyle,
  betType: PayoutKey,
  text: string,
  bets: Bet[],
  printed: ParsedTicket['printed'],
  spec: BetTypeSpec,
): ParsedTicket {
  const totalYen = bets.reduce((sum, bet) => sum + bet.amountYen, 0);
  const checks: TicketCheck[] = [];

  if (printed.points !== null) {
    checks.push(
      check(
        '点数',
        printed.points === bets.length,
        `券面 ${printed.points}点 / 読み取り ${bets.length}点`,
      ),
    );
  }
  if (printed.totalYen !== null) {
    checks.push(
      check(
        '合計金額',
        printed.totalYen === totalYen,
        `券面 ${printed.totalYen.toLocaleString('ja-JP')}円 / 読み取り ${totalYen.toLocaleString('ja-JP')}円`,
      ),
    );
  }
  // ボックスは公式の点数表と突き合わせる（展開の誤りをここで捕まえる）
  if (style === 'box') {
    const boats = new Set(bets.flatMap((bet) => bet.combo)).size;
    checks.push(
      check(
        'ボックスの点数',
        boxPoints(boats, spec) === bets.length,
        `${boats}艇の${spec.label}は${boxPoints(boats, spec)}点`,
      ),
    );
  }

  return {
    style,
    betType,
    raceNo: findRaceNo(text),
    date: findDate(text),
    bets,
    printed,
    checks,
    // **検算が1つでも通らなければ登録させない。** 券面と合わない記録は残す意味がない
    ok: checks.length > 0 && checks.every((entry) => entry.ok),
  };
}
