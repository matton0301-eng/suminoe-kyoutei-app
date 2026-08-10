/**
 * 券面の読み取りのテスト。
 *
 * **入力は実物の券から起こしたもの**（`docs/04-funaken-format.md`）。
 * 場によって詰め物の記号が違う（福岡◆／芦屋★）ので、その差も入れてある。
 *
 * いちばん守りたいのは「合わない読み取りを通さないこと」。
 * 券面の組合せ数・合計と一致しなければ `ok: false` になる。
 */

import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { specOf } from './betBuilder';
import { expandFormation, normalize, parseTicket, TicketParseError } from './ticketParse';
import type { Boat } from './types';

/** 住之江 2026-08-09 11R 3連複 4点（手元の実物） */
const SUMINOE_TRIO = `
BOAT RACE 住之江  にっぽん未来プロジェクト
主催 大阪府都市企業団
11レース
08年度 第05回06日
2026年08月09日
3連複
1◆2◆5 ◆◆◆2,000円
1◆5◆6 ◆◆◆2,000円
1◆4◆5 ◆◆◆2,000円
1◆2◆3 ◆◆◆1,000円
合計◆◆◆70枚 ◆◆◆◆7,000円
`;

/** 福岡 2024-04-13 12R 3連単 1点 */
const FUKUOKA_TRIFECTA = `
BOAT RACE 福岡  ヴィーナスシリーズ第1戦
主催 福岡市
12レース
06年度 第01回05日
2024年04月13日
3連単
1◆2◆3 ◆◆◆◆100円
1. 渡邊 優美
2. 三浦 永理
3. 藤原 菜希
合計◆◆◆1枚 ◆◆◆◆100円
`;

/** 芦屋 2024-07-28 3R 拡連複 1点（詰め物が★） */
const ASHIYA_WIDE = `
芦屋競艇 BTS高城開設26周年記念
3レース '24年7月28日
拡連複
1★3 ★★★100円
1. 喜多須 杏奈
3. 石丸 海渡
合計★★★★1枚券★★★★100円
`;

/** 住之江 2026-02-23 1R 3連単ボックス（3艇→6点） */
const SUMINOE_BOX = `
BOAT RACE 住之江  トランスワードトロフィー
主催 大阪府都市企業団
01レース
07年度 第11回02日
2026年02月23日
ボックス
3連単
1 山本 兼士
2 品川 二千翔
5 中 亮太
組合せ数 ◆◆6
各組 ◆◆◆100円
合計 ◆◆◆◆6枚 ◆◆◆◆600円
`;

/** びわこ 2021-07-13 7R 3連単フォーメーション（2×1×3=6点） */
const BIWAKO_FORMATION = `
BOAT RACE びわこ 平和島場外
07レース
03年度 第04回07日
2021年07月13日
フォーメーション
3連単
1着-45
2着-45
3着-126
組合せ数 ◆◆6
各組 ◆◆◆100円
合計 ◆◆◆6枚 ◆◆◆600円
`;

describe('normalize', () => {
  it('詰め物の記号を落とす（場によって違うので意味を持たせない）', () => {
    assert.equal(normalize('1◆2◆5'), '1 2 5');
    assert.equal(normalize('1★3'), '1 3');
  });

  it('全角数字を半角にする', () => {
    assert.equal(normalize('１２レース'), '12レース');
  });
});

describe('通常券', () => {
  it('住之江の3連複4点を読める', () => {
    const parsed = parseTicket(SUMINOE_TRIO);
    assert.equal(parsed.style, 'normal');
    assert.equal(parsed.betType, 'trio');
    assert.equal(parsed.raceNo, 11);
    assert.equal(parsed.date, '2026-08-09');
    assert.equal(parsed.bets.length, 4);
    assert.deepEqual(
      parsed.bets.map((bet) => bet.combo.join('=')),
      ['1=2=5', '1=5=6', '1=4=5', '1=2=3'],
    );
    assert.deepEqual(
      parsed.bets.map((bet) => bet.amountYen),
      [2000, 2000, 2000, 1000],
    );
  });

  it('合計金額が券面と一致する', () => {
    const parsed = parseTicket(SUMINOE_TRIO);
    assert.equal(parsed.printed.totalYen, 7000);
    const check = parsed.checks.find((entry) => entry.label === '合計金額')!;
    assert.equal(check.ok, true);
  });

  it('福岡の3連単1点を読める（着順どおり）', () => {
    const parsed = parseTicket(FUKUOKA_TRIFECTA);
    assert.equal(parsed.betType, 'trifecta');
    assert.deepEqual(parsed.bets[0].combo, [1, 2, 3]);
    assert.equal(parsed.bets[0].amountYen, 100);
    assert.equal(parsed.ok, true);
  });

  it('詰め物が★の券（芦屋）も読める', () => {
    const parsed = parseTicket(ASHIYA_WIDE);
    assert.equal(parsed.betType, 'wide');
    assert.deepEqual(parsed.bets[0].combo, [1, 3]);
    assert.equal(parsed.bets[0].amountYen, 100);
  });

  it('区切り記号で賭式を判定していない（同じ記号でも券種で分かれる）', () => {
    assert.equal(parseTicket(FUKUOKA_TRIFECTA).betType, 'trifecta');
    assert.equal(parseTicket(SUMINOE_TRIO).betType, 'trio');
  });
});

describe('ボックス券', () => {
  const parsed = parseTicket(SUMINOE_BOX);

  it('3艇の3連単ボックスは6点に展開される', () => {
    assert.equal(parsed.style, 'box');
    assert.equal(parsed.bets.length, 6);
    assert.equal(parsed.printed.points, 6);
  });

  it('券面の組合せ数と一致する', () => {
    assert.equal(parsed.checks.find((entry) => entry.label === '点数')!.ok, true);
  });

  it('合計金額が一致する（各組100円 × 6点 = 600円）', () => {
    assert.equal(parsed.printed.totalYen, 600);
    assert.equal(parsed.checks.find((entry) => entry.label === '合計金額')!.ok, true);
    assert.equal(parsed.ok, true);
  });

  it('着順の違うものが別々に入っている', () => {
    const keys = parsed.bets.map((bet) => bet.combo.join('-'));
    assert.ok(keys.includes('1-2-5'));
    assert.ok(keys.includes('5-2-1'));
  });
});

describe('フォーメーション券', () => {
  const parsed = parseTicket(BIWAKO_FORMATION);

  it('1着45 / 2着45 / 3着126 が6点に展開される', () => {
    assert.equal(parsed.style, 'formation');
    assert.equal(parsed.bets.length, 6);
    assert.equal(parsed.printed.points, 6);
    assert.equal(parsed.ok, true);
  });

  it('同じ艇を2か所に使わない', () => {
    for (const bet of parsed.bets) {
      assert.equal(new Set(bet.combo).size, bet.combo.length);
    }
  });

  it('1着と2着が入れ替わったものは別の点', () => {
    const keys = parsed.bets.map((bet) => bet.combo.join('-'));
    assert.ok(keys.includes('4-5-1'));
    assert.ok(keys.includes('5-4-1'));
  });

  it('順不同の賭式では並びの違うものを1点にまとめる', () => {
    // 公式カードの「重複する組合せは1点として計算します」
    const rows = new Map<number, Boat[]>([
      [1, [1, 2]],
      [2, [1, 2]],
      [3, [3, 4]],
    ]);
    const trio = expandFormation(rows, specOf('trio'));
    // 1-2-3 と 2-1-3 は同じ点。1=2=3 と 1=2=4 の2点になる
    assert.equal(trio.length, 2);
    assert.deepEqual(
      trio.map((combo) => combo.join('=')).sort(),
      ['1=2=3', '1=2=4'],
    );
  });
});

describe('合わない読み取りを通さない', () => {
  it('合計金額が券面と違えば ok=false', () => {
    const broken = SUMINOE_BOX.replace('600円', '900円');
    const parsed = parseTicket(broken);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.checks.find((entry) => entry.label === '合計金額')!.ok, false);
  });

  it('組合せ数が合わなければ ok=false', () => {
    const broken = SUMINOE_BOX.replace('組合せ数 ◆◆6', '組合せ数 ◆◆12');
    assert.equal(parseTicket(broken).ok, false);
  });

  it('検算する材料が1つも無ければ ok=false（無検査で通さない）', () => {
    const parsed = parseTicket('3連単\n1◆2◆3 ◆◆100円\n');
    assert.equal(parsed.ok, false);
  });
});

describe('読み取れないときは黙って通さない', () => {
  it('券種が無ければ例外', () => {
    assert.throws(() => parseTicket('BOAT RACE 住之江\n11レース\n'), TicketParseError);
  });

  it('買い目が無ければ例外', () => {
    assert.throws(() => parseTicket('3連単\n11レース\n合計 1枚 100円'), TicketParseError);
  });

  it('フォーメーションで着順欄が欠けていれば例外', () => {
    const broken = BIWAKO_FORMATION.replace('3着-126', '');
    assert.throws(() => parseTicket(broken), TicketParseError);
  });
});
