/**
 * レース結果ページ（公式）を読む。
 *
 *   https://www.boatrace.jp/owpc/pc/race/raceresult?rno=8&jcd=12&hd=20260809
 *
 * **競走成績のファイル（K）は全レース終了後にしか出ない。**
 * こちらは1レース終わるたびに更新されるので、当日のうちに着順・決まり手・払戻が取れる。
 * これがあるおかげで、記録タブでの着順の手入力が要らなくなった。
 *
 * 出す形は `apps/suminoe-log/lib/results.ts` の `ResultRace` に合わせる。
 * K ファイルから作ったものと同じ器に入れて混ぜられるようにするため。
 */

import * as cheerio from 'cheerio';

export type PayoutKey =
  | 'trifecta'
  | 'trio'
  | 'exacta'
  | 'quinella'
  | 'wide'
  | 'win'
  | 'place';

/** 公式の表記 → こちらのキー */
const PAYOUT_KEY_BY_LABEL: Record<string, PayoutKey> = {
  '3連単': 'trifecta',
  '3連複': 'trio',
  '2連単': 'exacta',
  '2連複': 'quinella',
  拡連複: 'wide',
  単勝: 'win',
  複勝: 'place',
};

export interface LiveResultPayout {
  betType: string;
  key: PayoutKey | null;
  combo: number[];
  amount: number;
  popularity: number | null;
}

export interface LiveResult {
  raceNo: number;
  ok: boolean;
  order: number[];
  kimarite: string;
  weather: string;
  windDir: string;
  windM: number | null;
  waveCm: number | null;
  payouts: LiveResultPayout[];
}

function toNumber(text: string): number | null {
  const matched = /-?\d+(\.\d+)?/.exec(text.replace(/[,\s]/g, ''));
  return matched ? Number(matched[0]) : null;
}

/** 「気温 31.0℃」のような並びから、見出しの次に来る値を取る（水面気象の欄） */
function labelledValue($: cheerio.CheerioAPI, label: string): string {
  const found = $(`*:contains("${label}")`)
    .filter((_, el) => $(el).children().length === 0 && $(el).text().trim() === label)
    .first();
  return found.length > 0 ? found.parent().text().replace(label, '').trim() : '';
}

/**
 * 見出し1つだけの小さな表から値を取る（決まり手・備考）。
 * `<thead><th>決まり手</th></thead><tbody><tr><td>逃げ</td></tr></tbody>` という形。
 */
function tableValue($: cheerio.CheerioAPI, header: string): string {
  let value = '';
  $('table').each((_, table) => {
    if ($(table).find('thead th').first().text().trim() !== header) return;
    value = $(table).find('tbody td').first().text().trim();
  });
  return value;
}

/**
 * 払戻の表を読む。
 *
 * 賭式ごとに `<td rowspan="2">3連単</td>` があり、その後に艇番のセルと金額が続く。
 * **拡連複は1レースに3通りの払戻がある**ので、賭式ごとに複数行を拾う。
 */
function parsePayouts($: cheerio.CheerioAPI): LiveResultPayout[] {
  const payouts: LiveResultPayout[] = [];

  /**
   * 賭式の見出しは rowspan 付きのセル。**rowspan の値は賭式で違う**
   * （3連単は2、複勝は3、拡連複は5）。数を決め打ちせず、
   * **同じ tbody に入っている行をすべて見る**。
   * 拡連複は1レースに3通り、複勝は2通りの払戻があるので、複数行を拾う必要がある。
   */
  $('td[rowspan]').each((_, cell) => {
    const label = $(cell).text().trim();
    const key = PAYOUT_KEY_BY_LABEL[label];
    if (!key) return;

    $(cell)
      .closest('tbody')
      .find('tr')
      .each((__, tr) => {
        const row = $(tr);
        const combo = row
          .find('span.numberSet1_number')
          .toArray()
          .map((span) => Number($(span).text().trim()))
          .filter((value) => value >= 1 && value <= 6);
        const amount = toNumber(row.find('span[class^="is-payout"]').first().text() ?? '');
        if (combo.length === 0 || amount === null) return;
        payouts.push({
          betType: label,
          key,
          combo,
          popularity: toNumber(row.find('td').last().text()),
          amount,
        });
      });
  });

  return payouts;
}

/**
 * ページを読む。まだレースが終わっていなければ `ok: false` を返す。
 * **エラーにしない。** 終わっていないのは異常ではない。
 */
export function parseRaceResult(html: string, raceNo: number): LiveResult {
  const $ = cheerio.load(html);
  const payouts = parsePayouts($);

  const empty: LiveResult = {
    raceNo,
    ok: false,
    order: [],
    kimarite: '',
    weather: '',
    windDir: '',
    windM: null,
    waveCm: null,
    payouts: [],
  };
  if (payouts.length === 0) return empty;

  // 着順は3連単の組番がそのまま（1着-2着-3着）
  const trifecta = payouts.find((entry) => entry.key === 'trifecta');
  const order = trifecta ? trifecta.combo.slice(0, 3) : [];
  if (order.length < 3) return { ...empty, payouts };

  return {
    raceNo,
    ok: true,
    order,
    kimarite: tableValue($, '決まり手'),
    weather: labelledValue($, '天候'),
    windDir: '',
    windM: toNumber(labelledValue($, '風速')),
    waveCm: toNumber(labelledValue($, '波高')),
    payouts,
  };
}

export function raceResultUrl(date: string, raceNo: number, jcd = 12): string {
  return `https://www.boatrace.jp/owpc/pc/race/raceresult?rno=${raceNo}&jcd=${jcd}&hd=${date.replaceAll('-', '')}`;
}
