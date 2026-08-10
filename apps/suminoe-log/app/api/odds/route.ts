/**
 * オッズを都度取ってくる。
 *
 *   GET /api/odds?date=2026-08-13&race=1
 *
 * **「見た瞬間の値」を出すためにある。** 収集の仕組み（15分おき）は続けるが、
 * それだと締切直前に最大15分古い値を見ることになる。8/9 のいちばんの不満がそこだった。
 *
 * **公式サイトは CORS を許可していない**ので、ブラウザから直接は取れない。
 * ここを経由する必要がある。
 *
 * 短時間だけキャッシュする。同じレースを何人かが同時に見ても、
 * 公式サイトへの要求はその間1回で済む。
 */

import { NextResponse } from 'next/server';

import { fetchOdds, type OddsBetType } from '@/lib/server/oddsSource';

/**
 * **1回の取得に10〜12秒かかる。** 手元（日本）から直接叩けば2秒なので、
 * 差のほぼ全部が距離によるもの。関数は米国東部（iad1）で動いている。
 *
 * 東京（hnd1）を指定してみたが**効かなかった**（Hobby プランは単一リージョン）。
 * `preferredRegion` を書いても iad1 のままになるので、書かない。
 *
 * **それでも意味はある。** 画面は待たない作りで、
 * 収集が入れた値をすぐ出したうえで、取れ次第そっと差し替える。
 * 結果として、見えているオッズの古さは最大15分から1分程度まで縮む。
 */

/** 何秒キャッシュするか。オッズは締切直前まで動くので短く */
const CACHE_SECONDS = 30;

/** 1回の要求で取る賭式。全部取ると5ページぶん待たせるので、画面が要る分だけ */
const DEFAULT_TYPES: OddsBetType[] = ['trifecta', 'trio'];

const ALL_TYPES: OddsBetType[] = [
  'trifecta',
  'trio',
  'exacta',
  'quinella',
  'wide',
  'win',
  'place',
];

function toMap(entries: { combo: number[]; odds: number | null }[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const entry of entries) {
    if (entry.odds !== null) map[entry.combo.join('-')] = entry.odds;
  }
  return map;
}

function toRangeMap(
  entries: { combo: number[]; odds: number | null; oddsMax?: number | null }[],
): Record<string, [number, number]> {
  const map: Record<string, [number, number]> = {};
  for (const entry of entries) {
    if (entry.odds === null) continue;
    map[entry.combo.join('-')] = [entry.odds, entry.oddsMax ?? entry.odds];
  }
  return map;
}

function jstNow(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.toISOString().slice(0, 19)}+09:00`;
}

export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const date = params.get('date') ?? '';
  const raceNo = Number(params.get('race'));
  const wantsAll = params.get('all') === '1';

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(raceNo) || raceNo < 1 || raceNo > 12) {
    return NextResponse.json({ error: 'date と race を指定してください' }, { status: 400 });
  }

  const types = wantsAll ? ALL_TYPES : DEFAULT_TYPES;

  try {
    const results = await Promise.all(types.map((type) => fetchOdds(date, raceNo, type)));
    const byType = new Map(types.map((type, index) => [type, results[index]]));

    const trifecta = byType.get('trifecta');
    const trio = byType.get('trio');
    // 1つも取れなければ「まだ発売前」。**空の値を作らない**
    if (!trifecta && !trio) {
      return NextResponse.json(
        { date, raceNo, fetchedAt: null, available: false },
        { headers: { 'Cache-Control': `public, s-maxage=${CACHE_SECONDS}` } },
      );
    }

    const payload: Record<string, unknown> = {
      date,
      raceNo,
      fetchedAt: jstNow(),
      available: true,
      trifecta: trifecta ? toMap(trifecta.entries) : null,
      trio: trio ? toMap(trio.entries) : null,
    };

    if (wantsAll) {
      payload.exacta = byType.get('exacta') ? toMap(byType.get('exacta')!.entries) : null;
      payload.quinella = byType.get('quinella') ? toMap(byType.get('quinella')!.entries) : null;
      payload.win = byType.get('win') ? toMap(byType.get('win')!.entries) : null;
      payload.wide = byType.get('wide') ? toRangeMap(byType.get('wide')!.entries) : null;
      payload.place = byType.get('place') ? toRangeMap(byType.get('place')!.entries) : null;
    }

    return NextResponse.json(payload, {
      headers: { 'Cache-Control': `public, s-maxage=${CACHE_SECONDS}` },
    });
  } catch {
    // **失敗しても落とさない。** 呼び出し側は静的な odds.json に戻る
    return NextResponse.json({ error: '公式サイトから取得できませんでした' }, { status: 502 });
  }
}
