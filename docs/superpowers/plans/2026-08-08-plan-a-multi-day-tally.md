# Plan A: 節をまたいだ通算分析 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (または subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **先に** [2026-08-08-enhancement-roadmap.md](2026-08-08-enhancement-roadmap.md) の共通制約を読むこと。

**Goal:** 収支タブに「この日/通算」切替を追加し、アーカイブ全日分の賭式別・判定別の通算収支と日別推移を母数付きで表示する。

**Architecture:** アーカイブ(`/archive/index.json` → 各日の racecard+results)を通算表示の初回選択時にまとめて取得し、日ごとに既存の `tallyDay()` を回して純関数 `aggregateDays()` で合算する。取得結果はメモリにキャッシュ。記録(localStorage)がある日は自分の予想的中も併記する。

**Tech Stack:** Next.js 16 静的エクスポート / TypeScript / vitest

**前提知識(このリポジトリの当該箇所):**
- `apps/suminoe-log/lib/tally.ts` — `tallyDay(card, results): DayTally | null`。`DayTally` は
  `byBetType: BetTypeTally[]`(key/name/races/hitRaces/tickets/investedYen/returnedYen/best など)と
  `byVerdict: VerdictTally[]`、`investedYen/returnedYen/balanceYen/recoveryRate` を持つ
- `apps/suminoe-log/lib/archive.ts` — `fetchArchiveIndex(): Promise<ArchiveDay[]>`、
  `fetchArchiveDay(iso): Promise<{card, results}>`(2026-08-08 実装済み)
- `apps/suminoe-log/lib/storage.ts` — `loadLogs(date)`、`countLogsByDate()`
- `apps/suminoe-log/lib/aggregate.ts` — `isHit(log)`(予想と結果1着の照合)
- `apps/suminoe-log/components/TallyTab.tsx` — 現在は `tally: DayTally | null` と `hasCard` を受ける
- `apps/suminoe-log/app/page.tsx` — タブ出し分け。`tally` を useMemo で作って渡している

## Global Constraints(ロードマップ共通制約に加えて)

- 通算表示にも必ず「母数」(日数・レース数)と控除率の注記を出す
- 通算データの取得は「通算」を選んだときだけ(起動時に全日 fetch しない)
- `tally.ts` は変更しない。合算は新モジュール `multiTally.ts` で行う

---

### Task A1: lib/multiTally.ts — 合算ロジック(TDD)

**Files:**
- Create: `apps/suminoe-log/lib/multiTally.ts`
- Create: `apps/suminoe-log/lib/multiTally.test.ts`

**Interfaces:**
- Produces:

```ts
export interface DaySummary {
  date: string;
  racesFinished: number;
  investedYen: number;
  returnedYen: number;
  balanceYen: number;
  recoveryRate: number | null;
  /** 1号艇1着の数 */
  insideWon: number;
  /** 自分の予想が的中した数。その日の記録が無ければ null */
  predictionHit: number | null;
  /** 予想と結果の両方が入っている記録の数。記録が無ければ null */
  predictionTotal: number | null;
}

export interface MultiTally {
  /** 日付降順(新しい日が先頭) */
  days: DaySummary[];
  totalDays: number;
  racesFinished: number;
  investedYen: number;
  returnedYen: number;
  balanceYen: number;
  recoveryRate: number | null;
  insideWon: number;
  insideWonRate: number | null;
  /** 賭式別の通算。tally.ts の BetTypeTally をそのまま合算した形 */
  byBetType: BetTypeTally[];
  byVerdict: VerdictTally[];
}

export interface DayInput {
  date: string;
  tally: DayTally | null;
  /** その日の観戦記録(無ければ空配列) */
  logs: RaceLog[];
}

export function summarizeDay(input: DayInput): DaySummary | null;  // tally が null なら null
export function aggregateDays(inputs: DayInput[]): MultiTally;
```

- Consumes: `DayTally`, `BetTypeTally`, `VerdictTally`(lib/tally)、`RaceLog`(lib/types)、`isHit`(lib/aggregate)

- [ ] **Step 1: 失敗するテストを書く**(`lib/multiTally.test.ts`)

ダミーの `DayTally` を最小限の形で手組みする(実データ fixture は不要。合算の正しさだけ検査する):

```ts
import { describe, expect, it } from 'vitest';

import { aggregateDays, summarizeDay, type DayInput } from './multiTally';
import type { DayTally } from './tally';
import type { RaceLog } from './types';

function fakeTally(overrides: Partial<DayTally>): DayTally {
  return {
    date: '2026-08-07',
    racesTotal: 12,
    racesFinished: 12,
    insideWon: 7,
    insideWonRate: 58.3,
    byBetType: [],
    byVerdict: [],
    perRace: [],
    investedYen: 27600,
    returnedYen: 18170,
    balanceYen: -9430,
    recoveryRate: 65.8,
    unitYen: 2300,
    ...overrides,
  };
}

function fakeLog(raceNo: number, predicted: 1 | 2 | null, resultFirst: 1 | 2 | null): RaceLog {
  return {
    id: `log-${raceNo}`,
    raceNo,
    predictedFirst: predicted,
    tenjiFast: null,
    resultFirst,
    resultSecond: null,
    resultThird: null,
    kimarite: null,
    suimen: null,
    memo: '',
    savedAt: '2026-08-07T12:00:00.000Z',
  };
}

describe('summarizeDay', () => {
  it('tally が null なら null(結果の無い日は通算に入れない)', () => {
    expect(summarizeDay({ date: '2026-08-09', tally: null, logs: [] })).toBeNull();
  });

  it('記録が無い日は予想指標を null にする', () => {
    const summary = summarizeDay({ date: '2026-08-07', tally: fakeTally({}), logs: [] });
    expect(summary?.predictionHit).toBeNull();
    expect(summary?.predictionTotal).toBeNull();
    expect(summary?.investedYen).toBe(27600);
  });

  it('記録がある日は予想の的中を数える', () => {
    const logs = [fakeLog(1, 1, 1), fakeLog(2, 1, 2), fakeLog(3, null, 1)];
    const summary = summarizeDay({ date: '2026-08-07', tally: fakeTally({}), logs });
    expect(summary?.predictionHit).toBe(1);   // 1R のみ的中
    expect(summary?.predictionTotal).toBe(2); // 3R は予想が無いので母数に入れない
  });
});

describe('aggregateDays', () => {
  const day1: DayInput = {
    date: '2026-08-07',
    tally: fakeTally({
      byBetType: [
        {
          key: 'win', name: '単勝', races: 12, hitRaces: 7, hitRate: 58.3,
          tickets: 12, investedYen: 1200, returnedYen: 1460, balanceYen: 260,
          recoveryRate: 121.7, best: { raceNo: 5, ticket: [3], amount: 890 },
        },
      ],
      byVerdict: [
        { verdict: '勝負', races: 2, insideWon: 2, anchorWon: 2, investedYen: 4600, returnedYen: 4000, balanceYen: -600 },
      ],
    }),
    logs: [],
  };
  const day2: DayInput = {
    date: '2026-08-08',
    tally: fakeTally({
      date: '2026-08-08',
      investedYen: 27600, returnedYen: 15610, balanceYen: -11990, insideWon: 8,
      byBetType: [
        {
          key: 'win', name: '単勝', races: 12, hitRaces: 7, hitRate: 58.3,
          tickets: 12, investedYen: 1200, returnedYen: 990, balanceYen: -210,
          recoveryRate: 82.5, best: { raceNo: 8, ticket: [1], amount: 190 },
        },
      ],
      byVerdict: [
        { verdict: '勝負', races: 6, insideWon: 5, anchorWon: 5, investedYen: 13800, returnedYen: 6960, balanceYen: -6840 },
      ],
    }),
    logs: [],
  };

  it('全体を合算し recoveryRate を出し直す', () => {
    const total = aggregateDays([day1, day2]);
    expect(total.totalDays).toBe(2);
    expect(total.racesFinished).toBe(24);
    expect(total.investedYen).toBe(55200);
    expect(total.returnedYen).toBe(33780);
    expect(total.insideWon).toBe(15);
    expect(total.recoveryRate).toBeCloseTo((33780 / 55200) * 100, 5);
  });

  it('賭式別を key ごとにマージし、best は金額の大きい方を残す', () => {
    const total = aggregateDays([day1, day2]);
    const win = total.byBetType.find((entry) => entry.key === 'win');
    expect(win?.races).toBe(24);
    expect(win?.hitRaces).toBe(14);
    expect(win?.investedYen).toBe(2400);
    expect(win?.returnedYen).toBe(2450);
    expect(win?.hitRate).toBeCloseTo((14 / 24) * 100, 5);
    expect(win?.best).toEqual({ raceNo: 5, ticket: [3], amount: 890 });
  });

  it('判定別を verdict ごとにマージする', () => {
    const total = aggregateDays([day1, day2]);
    const shobu = total.byVerdict.find((entry) => entry.verdict === '勝負');
    expect(shobu?.races).toBe(8);
    expect(shobu?.anchorWon).toBe(7);
    expect(shobu?.balanceYen).toBe(-7440);
  });

  it('tally の無い日は無視し、days は日付降順', () => {
    const total = aggregateDays([
      { date: '2026-08-09', tally: null, logs: [] },
      day1,
      day2,
    ]);
    expect(total.totalDays).toBe(2);
    expect(total.days.map((day) => day.date)).toEqual(['2026-08-08', '2026-08-07']);
  });
});
```

**注意: `best` の通算では raceNo だけだと何日の話か分からない。** `HitDetail` に日付を足すため、
`multiTally.ts` 内で `BetTypeTally` をそのまま使いつつ、best の照合用に
`bestDate: string | null` を持つ拡張型 `TotalBetTypeTally extends BetTypeTally { bestDate: string | null }`
を byBetType の要素型にする(テストもそれに合わせて `bestDate: '2026-08-07'` を検査に追加してよい)。

- [ ] **Step 2: 落ちることを確認**

```powershell
cd apps\suminoe-log
npx vitest run lib/multiTally.test.ts
```

Expected: FAIL(multiTally.ts が存在しない)

- [ ] **Step 3: 実装**

要点(コードは Step 1 の期待値を満たすこと):

- `summarizeDay`: `input.tally === null` なら null。予想指標は `input.logs` を `isHit` で数え、
  `predictedFirst !== null && resultFirst !== null` の記録だけを母数にする。記録が 0 件なら両方 null
- `aggregateDays`:
  - `summarizeDay` が null の日はスキップ
  - byBetType は `Map<BetTypeKey, TotalBetTypeTally>` でマージ。races/hitRaces/tickets/invested/returned を加算し、
    最後に `hitRate = hitRaces/races*100`、`recoveryRate = returned/invested*100`、`balanceYen = returned - invested` を出し直す。
    `best` は `amount` の大きい方を採用し `bestDate` を添える
  - byVerdict は `Map<Verdict, VerdictTally>` で同様に加算。表示順は `['勝負', '標準', '見送り']`
  - byBetType の表示順は recoveryRate 降順(TallyTab の既存の並びと同じ思想)ではなく
    **合算後の recoveryRate 降順**で返す
  - days は日付降順でソート

- [ ] **Step 4: テストが通ることを確認**

```powershell
npx vitest run lib/multiTally.test.ts
```

Expected: PASS

---

### Task A2: 通算データの読み込み(lib/totalLoader.ts)

**Files:**
- Create: `apps/suminoe-log/lib/totalLoader.ts`

**Interfaces:**
- Produces: `loadMultiTally(): Promise<MultiTally | null>`
  (アーカイブが空・オフラインなら null)
- Consumes: `fetchArchiveIndex` / `fetchArchiveDay`(lib/archive)、`tallyDay`(lib/tally)、
  `loadLogs`(lib/storage)、`aggregateDays`(lib/multiTally)

- [ ] **Step 1: 実装**

```ts
/**
 * 通算収支のためにアーカイブ全日分を読み込む。
 *
 * 「通算」を開いたときにだけ呼ぶ(起動時には呼ばない)。
 * 呼び出し側(page.tsx)が結果を保持するので、ここではキャッシュしない。
 */

import { fetchArchiveDay, fetchArchiveIndex } from './archive';
import { aggregateDays, type MultiTally } from './multiTally';
import { loadLogs } from './storage';
import { tallyDay } from './tally';

export async function loadMultiTally(): Promise<MultiTally | null> {
  const index = await fetchArchiveIndex();
  const targets = index.filter((day) => day.hasCard && day.hasResults);
  if (targets.length === 0) return null;

  const inputs = await Promise.all(
    targets.map(async (day) => {
      const { card, results } = await fetchArchiveDay(day.date);
      const tally = card && results ? tallyDay(card, results) : null;
      return { date: day.date, tally, logs: loadLogs(day.date).logs };
    }),
  );

  const total = aggregateDays(inputs);
  return total.totalDays > 0 ? total : null;
}
```

- [ ] **Step 2: typecheck**

```powershell
npm run typecheck
```

Expected: エラーなし

---

### Task A3: TallyTab に「この日/通算」切替を追加

**Files:**
- Modify: `apps/suminoe-log/components/TallyTab.tsx`
- Modify: `apps/suminoe-log/app/page.tsx`

**Interfaces:**
- TallyTab の新しい Props:

```ts
interface TallyTabProps {
  tally: DayTally | null;
  hasCard: boolean;
  /** 通算データ。まだ読み込んでいなければ null */
  total: MultiTally | null;
  totalLoading: boolean;
  /** 通算エラー(オフライン等)。無ければ null */
  totalError: string | null;
  /** 「通算」を初めて開いたときに呼ばれる */
  onRequestTotal: () => void;
}
```

- [ ] **Step 1: TallyTab に切替 UI を足す**

- コンポーネント冒頭に `const [mode, setMode] = useState<'day' | 'total'>('day');`
- 最上部にセグメント切替(既存のボタン様式に合わせる。`min-h-11`、選択中は `on-accent bg-accent`、
  非選択は `border border-line bg-bg-raised text-text-main`):
  「この日」「通算」の2ボタン。「通算」を押したとき `total === null && !totalLoading` なら `onRequestTotal()` を呼ぶ
- `mode === 'day'` は既存表示をそのまま
- `mode === 'total'` の表示(上から):
  1. 概況カード: 通算回収率(%)・通算収支(円)・「投資/払戻」・「対象: N開催日 / Mレース」
     (既存の「2026-08-08 の収支」カードと同じ構造。見出しは「通算収支(N開催日)」)
  2. 注記(必ず出す): 「控除率は約25%あるため、続けるほど回収率は75%前後に収束します。
     通算表示は実績の記録であって、成績の保証ではありません。」
  3. 日別の表: 日付 / 確定R / 収支 / 回収率 / 予想的中(predictionTotal が null なら「—」、
     あれば「hit/total」)。行は days の順(新しい日が上)
  4. 賭式別通算の表: 既存の「賭式ごとの当選率」と同じ列構成 + best(「最高配当: 8/7 11R 1-4-6 2,100円」の形式。
     bestDate を `formatDateLabel` で整形)
  5. 判定別通算の表: 既存の「判定ごとの結果」と同じ列構成
- `totalLoading` 中はスピナー代わりに「アーカイブを読み込んでいます…」のテキスト
- `totalError` があれば表示(「通算データを読み込めませんでした。オンラインで開くと見られます。」)

- [ ] **Step 2: page.tsx の配線**

```ts
const [total, setTotal] = useState<MultiTally | null>(null);
const [totalLoading, setTotalLoading] = useState(false);
const [totalError, setTotalError] = useState<string | null>(null);

const handleRequestTotal = useCallback(async () => {
  setTotalLoading(true);
  setTotalError(null);
  try {
    const loaded = await loadMultiTally();
    if (loaded === null) {
      setTotalError('通算データを読み込めませんでした。オンラインで開くと見られます。');
    }
    setTotal(loaded);
  } finally {
    setTotalLoading(false);
  }
}, []);
```

TallyTab の呼び出しに `total={total} totalLoading={totalLoading} totalError={totalError} onRequestTotal={handleRequestTotal}` を追加。

**注意: 過去日の閲覧中(viewing)でも通算は同じデータなのでそのまま渡してよい。**

- [ ] **Step 3: 検証**

```powershell
npm run typecheck
npm run lint
npm test
```

Expected: すべてパス(vitest は 88 + A1 の新規分)

- [ ] **Step 4: ローカルで動作確認**

`npm run build` → `npx --yes serve@14 out -l 4321` で:
1. 収支タブ →「通算」→ 8/7 + 8/8 の合算(投資 55,200円、2開催日 / 24レース)が出る
2. 日別表に 8/8(−11,990円)と 8/7(−9,430円)が並ぶ
3. 「この日」に戻すと従来表示
4. 過去日(8/7)閲覧中でも通算が同じ値で見られる

---

### Task A4: 最終検証

- [ ] リード pytest(53件)とログ vitest 全件、typecheck、lint、build がすべて通る
- [ ] `out/sw.js` に `/archive/` が含まれない(通算機能は precache に影響しないこと)
- [ ] デプロイはユーザーに確認してから(`FORCE=1 bash review-and-deploy.sh <当日>` が既存の手順)
