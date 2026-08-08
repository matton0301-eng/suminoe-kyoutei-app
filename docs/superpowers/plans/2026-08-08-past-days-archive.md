# 過去日アーカイブ機能 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 過去の開催日を選んで、その日の観戦記録・出走表・買い目・結果・収支を閲覧専用で見られるようにする。

**Architecture:** リード(Python)が出走表・結果を日付付きファイルとして `public/archive/` にも書き出し、ビルド時に一覧 `index.json` を自動生成する。アプリはヘッダーの日付タップで過去日に切り替え、アーカイブ+localStorage から読んだデータを「表示専用の状態」に載せる(当日の state には触れない)。

**Tech Stack:** Next.js 16 (静的エクスポート) / TypeScript / vitest / Python 3.14 / pytest

**Spec:** `docs/superpowers/specs/2026-08-08-past-days-archive-design.md`

## Global Constraints

- **git コミットはユーザーの明示指示があるまで行わない**(リポジトリに初回コミットが未作成のため。各タスク末尾のコミットは省略している)
- 外部通信は同一オリジンのみ。外部 API を呼ばない
- 買い目・収支の計算ロジック(betting.ts / tally.ts / review.ts)には触れない
- 過去日は閲覧専用。当日の state(logs / form / draft / raceCard / results)を汚さない
- SW は `/archive/` を precache しない
- 日付をハードコードしない
- Python の標準出力は UTF-8(既存の `_configure_stdout` 流儀)
- 既存テストを緩めない(リード pytest 53 / ログ vitest 72 が全部通ること)

---

### Task 1: main.py — 出走表をアーカイブにも書く

**Files:**
- Modify: `tools/suminoe-read/main.py`(33行目付近の定数と、219-224行の書き出し部)

**Interfaces:**
- Produces: `apps/suminoe-log/public/archive/racecard-YYYYMMDD.json`(内容は `racecard.json` と同一)

- [ ] **Step 1: 定数を足す**

`APP_DATA_PATH`(33行目)の直後に:

```python
APP_ARCHIVE_DIR = APP_DATA_PATH.parent / "archive"
```

- [ ] **Step 2: 書き出し部を拡張**

既存(219-224行):

```python
            if APP_DATA_PATH.parent.is_dir():
                APP_DATA_PATH.write_text(payload, encoding="utf-8")
                print(f"  出力: {APP_DATA_PATH}")
```

を次に置き換える(else 側の警告はそのまま):

```python
            if APP_DATA_PATH.parent.is_dir():
                APP_DATA_PATH.write_text(payload, encoding="utf-8")
                print(f"  出力: {APP_DATA_PATH}")
                # 過去日を振り返れるよう、日付付きの控えも残す(アプリの /archive/ 配信用)
                APP_ARCHIVE_DIR.mkdir(exist_ok=True)
                archive_path = APP_ARCHIVE_DIR / f"racecard-{target:%Y%m%d}.json"
                archive_path.write_text(payload, encoding="utf-8")
                print(f"  出力: {archive_path}")
```

`target` は main() 内で定義済みの `date` オブジェクト(139行目)。

- [ ] **Step 3: 実行して検証**

```powershell
cd tools\suminoe-read
.\venv\Scripts\python.exe main.py --date 2026-08-08
```

Expected: `public/archive/racecard-20260808.json` が生成され、`racecard.json` と同一内容(`fc /b` または diff で確認)。

- [ ] **Step 4: pytest が全件通ることを確認**

```powershell
.\venv\Scripts\python.exe -m pytest -q
```

Expected: 53 passed

---

### Task 2: review.py — 結果をアーカイブにも書く

**Files:**
- Modify: `tools/suminoe-read/review.py`(37行目付近の定数と、233-239行の書き出し部)

**Interfaces:**
- Produces: `apps/suminoe-log/public/archive/results-YYYYMMDD.json`(内容は `results.json` と同一)

- [ ] **Step 1: 定数を足す**

`APP_RESULTS_PATH`(37行目)の直後に:

```python
APP_ARCHIVE_DIR = APP_RESULTS_PATH.parent / "archive"
```

- [ ] **Step 2: 書き出し部を拡張**

既存(234-236行):

```python
        if APP_RESULTS_PATH.parent.is_dir():
            APP_RESULTS_PATH.write_text(_results_payload(review, results), encoding="utf-8")
            print(f"  出力: {APP_RESULTS_PATH}")
```

を次に置き換える(else 側の警告はそのまま):

```python
        if APP_RESULTS_PATH.parent.is_dir():
            payload = _results_payload(review, results)
            APP_RESULTS_PATH.write_text(payload, encoding="utf-8")
            print(f"  出力: {APP_RESULTS_PATH}")
            # 過去日を振り返れるよう、日付付きの控えも残す(アプリの /archive/ 配信用)
            APP_ARCHIVE_DIR.mkdir(exist_ok=True)
            archive_path = APP_ARCHIVE_DIR / f"results-{target:%Y%m%d}.json"
            archive_path.write_text(payload, encoding="utf-8")
            print(f"  出力: {archive_path}")
```

- [ ] **Step 3: 実行して検証**

```powershell
.\venv\Scripts\python.exe review.py --date 2026-08-08
```

Expected: `public/archive/results-20260808.json` が生成され、`results.json` と同一内容。

- [ ] **Step 4: pytest 全件パス**

```powershell
.\venv\Scripts\python.exe -m pytest -q
```

Expected: 53 passed

---

### Task 3: index.json のビルド時生成と SW 除外

**Files:**
- Create: `apps/suminoe-log/scripts/build-archive-index.mjs`
- Modify: `apps/suminoe-log/package.json`(build スクリプト)
- Modify: `apps/suminoe-log/scripts/build-sw.mjs`(52-61行の walk 結果フィルタ)

**Interfaces:**
- Produces: `public/archive/index.json` — `{ schemaVersion: 1, days: [{ date, hasCard, hasResults }] }` 新しい日付が先頭
- Produces: `sw.js` に `/archive/` 配下が含まれない保証

- [ ] **Step 1: build-archive-index.mjs を書く**

```js
/**
 * public/archive/ を走査して index.json を生成する(`next build` の前に実行)。
 *
 * どの日のデータがあるかの一覧。手書きすると必ずズレるので、
 * Service Worker の一覧(build-sw.mjs)と同じく実ファイルから生成する。
 *
 *   node scripts/build-archive-index.mjs
 */

import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ARCHIVE_DIR = join(HERE, '..', 'public', 'archive');
const INDEX_PATH = join(ARCHIVE_DIR, 'index.json');

mkdirSync(ARCHIVE_DIR, { recursive: true });

const days = new Map();
for (const name of readdirSync(ARCHIVE_DIR)) {
  const match = /^(racecard|results)-(\d{8})\.json$/.exec(name);
  if (!match) continue;
  const compact = match[2];
  const iso = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  const day = days.get(iso) ?? { date: iso, hasCard: false, hasResults: false };
  if (match[1] === 'racecard') day.hasCard = true;
  else day.hasResults = true;
  days.set(iso, day);
}

const sorted = [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
const payload = { schemaVersion: 1, days: sorted };
writeFileSync(INDEX_PATH, JSON.stringify(payload, null, 1), 'utf8');
console.log(`[build-archive-index] ${sorted.length} 日分を index.json に書き出しました`);
for (const day of sorted) {
  console.log(`  ${day.date} card=${day.hasCard} results=${day.hasResults}`);
}
```

- [ ] **Step 2: package.json の build チェーンに組み込む**

`index.json` も `out/` に含める必要があるため、**`next build` より前**に実行する:

```json
"build": "node scripts/build-archive-index.mjs && next build && node scripts/build-sw.mjs",
```

- [ ] **Step 3: build-sw.mjs に /archive/ の除外を足す**

53-55行の for ループ内、EXCLUDE 判定の直後に1行:

```js
for (const file of files) {
  const urlPath = toUrlPath(file);
  if (EXCLUDE.has(urlPath.slice(1))) continue;
  // 過去日のアーカイブは precache しない(蓄積で肥大するため。過去日閲覧はオンライン前提)
  if (urlPath.startsWith('/archive/')) continue;
  urls.add(urlPath);
```

- [ ] **Step 4: ビルドして検証**

```powershell
cd apps\suminoe-log
npm run build
```

Expected:
- `out/archive/index.json` が存在し、`2026-08-08` のエントリ(card=true, results=true)を含む
- `out/sw.js` 内に `/archive/` の文字列が**現れない**(`Select-String -Path out\sw.js -Pattern "archive"` がヒット0件)

---

### Task 4: lib/archive.ts — index のパースと日付リスト(TDD)

**Files:**
- Create: `apps/suminoe-log/lib/archive.ts`
- Create: `apps/suminoe-log/lib/archive.test.ts`
- Modify: `apps/suminoe-log/lib/raceDate.ts`(isoFromCompact を追加)
- Modify: `apps/suminoe-log/lib/storage.ts`(countLogsByDate を追加)

**Interfaces:**
- Produces:
  - `interface ArchiveDay { date: string; hasCard: boolean; hasResults: boolean }`
  - `interface DayEntry extends ArchiveDay { logCount: number }`
  - `parseArchiveIndex(raw: string): ArchiveDay[]`
  - `mergeDayEntries(archive: ArchiveDay[], logCounts: Record<string, number>): DayEntry[]`(日付降順)
  - `archiveCardUrl(iso: string): string` / `archiveResultsUrl(iso: string): string`
  - `fetchArchiveIndex(): Promise<ArchiveDay[]>`
  - `fetchArchiveDay(iso: string): Promise<{ card: RaceCard | null; results: ResultDay | null }>`
  - `raceDate.ts` に `isoFromCompact(compact: string): string | null`("20260807" → "2026-08-07")
  - `storage.ts` に `countLogsByDate(): Record<string, number>`(iso 日付 → 記録件数)

- [ ] **Step 1: 失敗するテストを書く**(`lib/archive.test.ts`)

```ts
import { describe, expect, it } from 'vitest';

import { archiveCardUrl, archiveResultsUrl, mergeDayEntries, parseArchiveIndex } from './archive';

const VALID_INDEX = JSON.stringify({
  schemaVersion: 1,
  days: [
    { date: '2026-08-08', hasCard: true, hasResults: true },
    { date: '2026-08-07', hasCard: true, hasResults: false },
  ],
});

describe('parseArchiveIndex', () => {
  it('正常な index を読める', () => {
    const days = parseArchiveIndex(VALID_INDEX);
    expect(days).toHaveLength(2);
    expect(days[0]).toEqual({ date: '2026-08-08', hasCard: true, hasResults: true });
  });

  it('JSON として壊れていれば空を返す', () => {
    expect(parseArchiveIndex('{oops')).toEqual([]);
  });

  it('schemaVersion が違えば空を返す', () => {
    expect(parseArchiveIndex(JSON.stringify({ schemaVersion: 2, days: [] }))).toEqual([]);
  });

  it('日付形式が不正な要素は捨てる', () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      days: [
        { date: '2026/08/07', hasCard: true, hasResults: true },
        { date: '2026-08-08', hasCard: true, hasResults: true },
        { date: 20260806, hasCard: true, hasResults: true },
      ],
    });
    expect(parseArchiveIndex(raw)).toEqual([
      { date: '2026-08-08', hasCard: true, hasResults: true },
    ]);
  });
});

describe('mergeDayEntries', () => {
  it('アーカイブと記録の日付を統合して降順に並べる', () => {
    const archive = [
      { date: '2026-08-07', hasCard: true, hasResults: true },
      { date: '2026-08-08', hasCard: true, hasResults: true },
    ];
    const entries = mergeDayEntries(archive, { '2026-08-09': 3 });
    expect(entries.map((entry) => entry.date)).toEqual(['2026-08-09', '2026-08-08', '2026-08-07']);
    expect(entries[0]).toEqual({ date: '2026-08-09', hasCard: false, hasResults: false, logCount: 3 });
  });

  it('同じ日付は1行にまとめて記録件数を付ける', () => {
    const archive = [{ date: '2026-08-08', hasCard: true, hasResults: true }];
    const entries = mergeDayEntries(archive, { '2026-08-08': 5 });
    expect(entries).toEqual([{ date: '2026-08-08', hasCard: true, hasResults: true, logCount: 5 }]);
  });
});

describe('archive URL', () => {
  it('日付付きのパスを組み立てる', () => {
    expect(archiveCardUrl('2026-08-07')).toBe('/archive/racecard-20260807.json');
    expect(archiveResultsUrl('2026-08-07')).toBe('/archive/results-20260807.json');
  });
});
```

- [ ] **Step 2: 落ちることを確認**

```powershell
cd apps\suminoe-log
npx vitest run lib/archive.test.ts
```

Expected: FAIL(archive.ts が存在しない)

- [ ] **Step 3: lib/archive.ts を実装**

```ts
/**
 * 過去日アーカイブ(/archive/)の取り込み。
 *
 * リードが日付付きの出走表・結果を書き出し、ビルド時に index.json が生成される。
 * ここはその読み取り側。外から来るデータなので境界で厳密に検証する。
 * 過去日の閲覧はオンライン前提(SW は /archive/ を precache しない)。
 */

import { parseRaceCard, type RaceCard } from './raceCard';
import { compactDate, isIsoDate } from './raceDate';
import { parseResults, type ResultDay } from './results';

const SUPPORTED_SCHEMA_VERSION = 1;

export interface ArchiveDay {
  date: string;
  hasCard: boolean;
  hasResults: boolean;
}

/** 日付リストの1行。アーカイブの有無と、その日の観戦記録の件数 */
export interface DayEntry extends ArchiveDay {
  logCount: number;
}

export const ARCHIVE_INDEX_URL = '/archive/index.json';

export function archiveCardUrl(iso: string): string {
  return `/archive/racecard-${compactDate(iso)}.json`;
}

export function archiveResultsUrl(iso: string): string {
  return `/archive/results-${compactDate(iso)}.json`;
}

export function parseArchiveIndex(raw: string): ArchiveDay[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) return [];
  const record = parsed as Record<string, unknown>;
  if (record.schemaVersion !== SUPPORTED_SCHEMA_VERSION) return [];
  if (!Array.isArray(record.days)) return [];

  const days: ArchiveDay[] = [];
  for (const rawDay of record.days) {
    if (typeof rawDay !== 'object' || rawDay === null) continue;
    const day = rawDay as Record<string, unknown>;
    if (typeof day.date !== 'string' || !isIsoDate(day.date)) continue;
    days.push({
      date: day.date,
      hasCard: day.hasCard === true,
      hasResults: day.hasResults === true,
    });
  }
  return days;
}

/** アーカイブの日付と「記録が端末に残っている日付」を統合し、新しい日付から並べる */
export function mergeDayEntries(
  archive: ArchiveDay[],
  logCounts: Record<string, number>,
): DayEntry[] {
  const byDate = new Map<string, DayEntry>();
  for (const day of archive) {
    byDate.set(day.date, { ...day, logCount: logCounts[day.date] ?? 0 });
  }
  for (const [date, count] of Object.entries(logCounts)) {
    if (!isIsoDate(date) || byDate.has(date)) continue;
    byDate.set(date, { date, hasCard: false, hasResults: false, logCount: count });
  }
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export async function fetchArchiveIndex(): Promise<ArchiveDay[]> {
  try {
    const response = await fetch(ARCHIVE_INDEX_URL);
    if (!response.ok) return [];
    return parseArchiveIndex(await response.text());
  } catch {
    return [];
  }
}

/** 過去日の出走表と結果を取り込む。取れない・壊れているものは null */
export async function fetchArchiveDay(
  iso: string,
): Promise<{ card: RaceCard | null; results: ResultDay | null }> {
  const [card, results] = await Promise.all([
    (async () => {
      try {
        const response = await fetch(archiveCardUrl(iso));
        if (!response.ok) return null;
        return parseRaceCard(await response.text()).card;
      } catch {
        return null;
      }
    })(),
    (async () => {
      try {
        const response = await fetch(archiveResultsUrl(iso));
        if (!response.ok) return null;
        return parseResults(await response.text());
      } catch {
        return null;
      }
    })(),
  ]);
  return { card, results };
}
```

- [ ] **Step 4: raceDate.ts に isoFromCompact を追加**(`compactDate` の直後)

```ts
/** "20260809" を "2026-08-09" にする。8桁の数字でなければ null */
export function isoFromCompact(compact: string): string | null {
  if (!/^\d{8}$/.test(compact)) return null;
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}
```

- [ ] **Step 5: storage.ts に countLogsByDate を追加**(clearAll の直後)

```ts
/**
 * 記録が保存されている日付ごとの件数(日付リスト用)。
 * localStorage のキーを走査する。日数は高々数十なので毎回読んで問題ない。
 */
export function countLogsByDate(): Record<string, number> {
  const storage = getStorage();
  if (!storage) return {};
  const counts: Record<string, number> = {};
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    const match = key === null ? null : /^suminoe-log-(\d{8})$/.exec(key);
    if (!match) continue;
    const iso = isoFromCompact(match[1]);
    if (iso === null) continue;
    counts[iso] = loadLogs(iso).logs.length;
  }
  return counts;
}
```

storage.ts の import に `isoFromCompact` を足す:

```ts
import { CARD_KEY, RESULTS_KEY, draftKey, isoFromCompact, logsKey } from './raceDate';
```

- [ ] **Step 6: テストが通ることを確認**

```powershell
npx vitest run lib/archive.test.ts
```

Expected: PASS(8ケース)

- [ ] **Step 7: 全テストと typecheck**

```powershell
npm test
npm run typecheck
```

Expected: 既存72 + 新規8 = 80ケース PASS / 型エラーなし

---

### Task 5: LogList — 過去日の記録一覧(読み取り専用)

**Files:**
- Create: `apps/suminoe-log/components/LogList.tsx`

**Interfaces:**
- Consumes: `RaceLog`(lib/types)、`formatResult`(lib/aggregate)
- Produces: `<LogList logs={RaceLog[]} />`

- [ ] **Step 1: LogList.tsx を書く**

```tsx
'use client';

/**
 * 過去日の観戦記録の一覧(読み取り専用)。
 *
 * 過去日の記録タブは入力フォームではなくこれを出す。
 * フォームは入力装置であって、振り返りには一覧の方が向く。
 */

import { formatResult } from '@/lib/aggregate';
import type { RaceLog } from '@/lib/types';

interface LogListProps {
  logs: RaceLog[];
}

export function LogList({ logs }: LogListProps) {
  if (logs.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-bg-panel p-6 text-center">
        <p className="text-base text-text-main">この日の記録はありません。</p>
        <p className="mt-1 text-sm text-text-mute">出走表・結果・収支は他のタブで見られます。</p>
      </div>
    );
  }

  const sorted = [...logs].sort((a, b) => a.raceNo - b.raceNo);

  return (
    <ul className="space-y-2 pb-20">
      {sorted.map((log) => (
        <li key={log.id} className="rounded-xl border border-line bg-bg-panel p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-base font-bold text-text-main">{log.raceNo}R</span>
            <span className="tnum text-sm text-text-mute">結果 {formatResult(log)}</span>
          </div>
          <dl className="mt-1 space-y-0.5 text-sm text-text-mute">
            {log.predictedFirst !== null ? (
              <div className="flex gap-2">
                <dt>予想1着</dt>
                <dd className="tnum text-text-main">{log.predictedFirst}号艇</dd>
              </div>
            ) : null}
            {log.tenjiFast !== null ? (
              <div className="flex gap-2">
                <dt>展示で速そう</dt>
                <dd className="tnum text-text-main">{log.tenjiFast}号艇</dd>
              </div>
            ) : null}
            {log.kimarite !== null ? (
              <div className="flex gap-2">
                <dt>決まり手</dt>
                <dd className="text-text-main">{log.kimarite}</dd>
              </div>
            ) : null}
            {log.suimen !== null ? (
              <div className="flex gap-2">
                <dt>水面</dt>
                <dd className="text-text-main">{log.suimen}</dd>
              </div>
            ) : null}
            {log.memo.trim() !== '' ? (
              <div className="flex gap-2">
                <dt>メモ</dt>
                <dd className="whitespace-pre-wrap text-text-main">{log.memo}</dd>
              </div>
            ) : null}
          </dl>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: typecheck と lint**

```powershell
npm run typecheck
npm run lint
```

Expected: エラーなし(未使用でも import 循環がないことの確認)

---

### Task 6: DayPicker — 日付リストのモーダル

**Files:**
- Create: `apps/suminoe-log/components/DayPicker.tsx`

**Interfaces:**
- Consumes: `DayEntry`(lib/archive)、`formatDateLabel`(lib/raceDate)
- Produces: `<DayPicker open entries currentDate viewDate onSelect onClose />`
  - `onSelect(date: string | null)` — `null` は「今日に戻る」

- [ ] **Step 1: DayPicker.tsx を書く**

ConfirmDialog と同じモーダルの流儀(overlay / role="dialog" / Escape で閉じる):

```tsx
'use client';

/**
 * 過去の開催日を選ぶモーダル。ヘッダーの日付タップで開く。
 *
 * リストは「アーカイブにある日 ∪ 記録が端末に残っている日」。
 * いま運用中の日(currentDate)は「今日」の行として先頭固定で出す。
 */

import { useEffect } from 'react';

import type { DayEntry } from '@/lib/archive';
import { formatDateLabel } from '@/lib/raceDate';

interface DayPickerProps {
  open: boolean;
  entries: DayEntry[];
  /** いま運用中の日(出走表の日付。閲覧専用にならない日) */
  currentDate: string;
  /** 閲覧中の過去日。通常運用なら null */
  viewDate: string | null;
  onSelect: (date: string | null) => void;
  onClose: () => void;
}

function entryLabel(entry: DayEntry): string {
  const parts: string[] = [];
  if (entry.hasCard && entry.hasResults) parts.push('出走表・結果あり');
  else if (entry.hasCard) parts.push('出走表あり');
  if (entry.logCount > 0) parts.push(`記録${entry.logCount}件`);
  return parts.length > 0 ? parts.join(' / ') : '記録なし';
}

export function DayPicker({ open, entries, currentDate, viewDate, onSelect, onClose }: DayPickerProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const pastEntries = entries.filter((entry) => entry.date !== currentDate);

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/70"
      role="dialog"
      aria-modal="true"
      aria-labelledby="day-picker-title"
      onClick={onClose}
    >
      <div
        className="max-h-[70vh] w-full max-w-lg overflow-y-auto rounded-t-xl border border-line bg-bg-panel p-4 pb-8"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="day-picker-title" className="text-base font-bold text-text-main">
          日付を選ぶ
        </h2>
        <ul className="mt-3 space-y-2">
          <li>
            <button
              type="button"
              onClick={() => onSelect(null)}
              className={[
                'flex min-h-12 w-full items-center justify-between rounded-lg border px-3 text-left',
                viewDate === null ? 'border-accent bg-bg-raised' : 'border-line bg-bg-raised',
              ].join(' ')}
            >
              <span className="font-bold text-text-main">今日({formatDateLabel(currentDate)})</span>
              {viewDate === null ? <span className="text-xs text-accent">表示中</span> : null}
            </button>
          </li>
          {pastEntries.map((entry) => (
            <li key={entry.date}>
              <button
                type="button"
                onClick={() => onSelect(entry.date)}
                className={[
                  'flex min-h-12 w-full items-center justify-between rounded-lg border px-3 text-left',
                  viewDate === entry.date ? 'border-accent bg-bg-raised' : 'border-line bg-bg-raised',
                ].join(' ')}
              >
                <span className="tnum font-bold text-text-main">{formatDateLabel(entry.date)}</span>
                <span className="text-xs text-text-mute">{entryLabel(entry)}</span>
              </button>
            </li>
          ))}
        </ul>
        {pastEntries.length === 0 ? (
          <p className="mt-3 text-sm text-text-mute">まだ過去の日のデータがありません。</p>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: typecheck と lint**

```powershell
npm run typecheck
npm run lint
```

Expected: エラーなし

---

### Task 7: BetsTab / ExportTab に readOnly を足す

**Files:**
- Modify: `apps/suminoe-log/components/BetsTab.tsx`(Props と取り込み UI の出し分け)
- Modify: `apps/suminoe-log/components/ExportTab.tsx`(Props と全消去ボタンの出し分け)

**Interfaces:**
- Produces: `BetsTabProps.readOnly?: boolean`(既定 false)/ `ExportTabProps.readOnly?: boolean`(既定 false)

- [ ] **Step 1: BetsTab の Props に追加**

```ts
interface BetsTabProps {
  card: RaceCard | null;
  actualCourseRates: Partial<Record<Boat, number | null>>;
  resultCount: number;
  results: ResultDay | null;
  focusRaceNo: number;
  tenjiFastFor: (raceNo: number) => Boat | null;
  onImport: (raw: string) => void;
  onClearCard: () => void;
  importError: string | null;
  /** 過去日の閲覧中。取り込み・クリアなどの操作を出さない */
  readOnly?: boolean;
}
```

- [ ] **Step 2: BetsTab 内の操作 UI を出し分ける**

BetsTab の実装を読み、以下の2箇所を `readOnly` で分岐する:
- `card === null` のときの取り込みフォーム → readOnly なら代わりに
  `<p className="rounded-xl border border-line bg-bg-panel p-6 text-center text-sm text-text-mute">この日の出走表・結果は取得できませんでした。オンラインで開くと見られます。</p>`
- 出走表があるときの「出走表データを消す」ボタン(onClearCard を呼ぶ要素)→ readOnly なら描画しない

- [ ] **Step 3: ExportTab の Props に追加**

```ts
interface ExportTabProps {
  text: string;
  csv: string;
  hasLogs: boolean;
  onRequestClearAll: () => void;
  onToast: (message: string) => void;
  /** 過去日の閲覧中。全消去ボタンを出さない */
  readOnly?: boolean;
}
```

「全記録を消す」ボタン(onRequestClearAll を呼ぶ要素)を `readOnly` なら描画しない。コピー・ダウンロードは読み取り操作なのでそのまま。

- [ ] **Step 4: 検証**

```powershell
npm run typecheck
npm test
```

Expected: 型エラーなし / 80ケース PASS(readOnly は省略可能なので既存呼び出しは壊れない)

---

### Task 8: page.tsx — 過去日表示の配線

**Files:**
- Modify: `apps/suminoe-log/app/page.tsx`

**Interfaces:**
- Consumes: Task 4-7 の全インターフェース

- [ ] **Step 1: import と状態を足す**

import に追加:

```ts
import { DayPicker } from '@/components/DayPicker';
import { LogList } from '@/components/LogList';
import { fetchArchiveDay, fetchArchiveIndex, mergeDayEntries, type DayEntry } from '@/lib/archive';
```

storage の import に `countLogsByDate` を追加。

状態(既存の `raceDate` の直後):

```ts
/** 閲覧中の過去日。通常運用(今日)なら null */
const [viewDate, setViewDate] = useState<string | null>(null);
/** 過去日表示用のデータ一式。当日の state には触れない */
const [archiveView, setArchiveView] = useState<{
  card: RaceCard | null;
  results: ResultDay | null;
  logs: RaceLog[];
} | null>(null);
const [dayPickerOpen, setDayPickerOpen] = useState(false);
const [dayEntries, setDayEntries] = useState<DayEntry[]>([]);
/** 過去日のアーカイブが取得できなかったときの案内 */
const [archiveNotice, setArchiveNotice] = useState<string | null>(null);
```

- [ ] **Step 2: 開閉と選択のハンドラを足す**

```ts
const openDayPicker = useCallback(async () => {
  setDayPickerOpen(true);
  const index = await fetchArchiveIndex();
  setDayEntries(mergeDayEntries(index, countLogsByDate()));
}, []);

const handleSelectDay = useCallback(
  async (date: string | null) => {
    setDayPickerOpen(false);
    if (date === null || date === raceDate) {
      setViewDate(null);
      setArchiveView(null);
      setArchiveNotice(null);
      return;
    }
    const stored = loadLogs(date);
    const { card, results } = await fetchArchiveDay(date);
    setViewDate(date);
    setArchiveView({ card, results, logs: stored.logs });
    setArchiveNotice(
      card === null
        ? 'この日の出走表・結果は取得できませんでした。オンラインで開くと見られます。'
        : null,
    );
  },
  [raceDate],
);
```

注: `openDayPicker` はモーダルを先に開いてから index を読む(体感を軽くする)。fetch 失敗時は
`fetchArchiveIndex` が `[]` を返すので、記録のある日だけのリストになる(スペックのエラー方針どおり)。

- [ ] **Step 3: 表示用のデータ源を切り替える**

```ts
const viewing = viewDate !== null;
const activeDate = viewDate ?? raceDate;
const activeLogs = viewing ? (archiveView?.logs ?? []) : logs;
const activeCard = viewing ? (archiveView?.card ?? null) : raceCard;
const activeResults = viewing ? (archiveView?.results ?? null) : results;
```

既存の派生値を付け替える(**締切・自動選択まわり(schedule / currentRace / selectedMinutesLeft)は
raceCard のまま**。過去日では記録タブ自体を出さないため):

```ts
const stats = useMemo(() => aggregate(activeLogs), [activeLogs]);
const exportText = useMemo(() => toPlainText(activeLogs, activeDate), [activeLogs, activeDate]);
const exportCsv = useMemo(() => toCsv(activeLogs), [activeLogs]);
const tally = useMemo(
  () => (activeCard && activeResults ? tallyDay(activeCard, activeResults) : null),
  [activeCard, activeResults],
);
```

`tenjiFastFor` は過去日ではその日の記録だけから引く:

```ts
const tenjiFastFor = useCallback(
  (raceNo: number): Boat | null => {
    const source = viewing ? (archiveView?.logs ?? []) : logs;
    const saved = [...source].reverse().find((log) => log.raceNo === raceNo);
    if (saved) return saved.tenjiFast;
    if (viewing) return null;
    return form.raceNo === raceNo ? form.tenjiFast : null;
  },
  [viewing, archiveView, logs, form.raceNo, form.tenjiFast],
);
```

`actualCourseRates` は `stats.courses` 由来なので自動で過去日に追従する(変更不要)。

- [ ] **Step 4: ヘッダーの日付をボタンにする**

既存:

```tsx
<p className="tnum text-sm text-text-mute">{formatDateLabel(raceDate)}</p>
```

を:

```tsx
<button
  type="button"
  onClick={openDayPicker}
  className="tnum min-h-11 rounded-lg px-2 text-sm text-text-mute underline decoration-dotted underline-offset-4"
  aria-label="日付を選ぶ"
>
  {formatDateLabel(activeDate)}
</button>
```

- [ ] **Step 5: バナーを差し替える**

既存の `viewingPastDay` バナー(「今日ではなく…」)を次に置き換える:

```tsx
{viewing ? (
  <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-accent bg-bg-panel px-3 py-2">
    <p className="text-xs text-text-main">
      閲覧専用 — <span className="tnum">{formatDateLabel(activeDate)}</span> のデータを表示中
    </p>
    <button
      type="button"
      onClick={() => handleSelectDay(null)}
      className="on-accent min-h-9 shrink-0 rounded-lg bg-accent px-3 text-xs font-bold"
    >
      今日に戻る
    </button>
  </div>
) : viewingPastDay ? (
  <p className="mb-3 rounded-lg border border-line bg-bg-panel px-3 py-2 text-xs text-text-mute">
    今日ではなく <span className="tnum text-text-main">{formatDateLabel(raceDate)}</span>{' '}
    のデータを表示しています。新しい出走表が用意されると自動で切り替わります。
  </p>
) : null}
{viewing && archiveNotice ? (
  <p className="mb-3 rounded-lg border border-line bg-bg-panel px-3 py-2 text-xs text-text-mute">
    {archiveNotice}
  </p>
) : null}
```

- [ ] **Step 6: タブの出し分けを変える**

```tsx
{tab === 'record' ? (
  viewing ? (
    <LogList logs={activeLogs} />
  ) : (
    <RecordTab ...既存のまま... />
  )
) : null}

{tab === 'bets' ? (
  <BetsTab
    card={activeCard}
    actualCourseRates={actualCourseRates}
    resultCount={stats.resultCount}
    results={activeResults}
    focusRaceNo={form.raceNo}
    tenjiFastFor={tenjiFastFor}
    onImport={handleImportCard}
    onClearCard={handleClearCard}
    importError={importError}
    readOnly={viewing}
  />
) : null}

{tab === 'tally' ? <TallyTab tally={tally} hasCard={activeCard !== null} /> : null}

{tab === 'export' ? (
  <ExportTab
    text={exportText}
    csv={exportCsv}
    hasLogs={activeLogs.length > 0}
    onRequestClearAll={() => setPendingConfirm('clearAll')}
    onToast={setToast}
    readOnly={viewing}
  />
) : null}
```

StatsTab は `stats` が activeLogs 由来になったので変更不要。

- [ ] **Step 7: DayPicker を描画に足す**(ConfirmDialog の並び)

```tsx
<DayPicker
  open={dayPickerOpen}
  entries={dayEntries}
  currentDate={raceDate}
  viewDate={viewDate}
  onSelect={handleSelectDay}
  onClose={() => setDayPickerOpen(false)}
/>
```

- [ ] **Step 8: 検証**

```powershell
npm run typecheck
npm run lint
npm test
```

Expected: すべてエラーなし / 80ケース PASS

- [ ] **Step 9: ローカルで動作確認**

```powershell
npm run build
```

の後、`.claude/launch.json` の `suminoe-log-static`(port 4321)で確認:
1. ヘッダーの日付タップ → リストに「今日(8/8)」と過去日が出る
2. 8/7 を選ぶ → 閲覧専用バナー / 買い目タブに 8/7 の出走表・結果 / 収支タブに 8/7 の収支
3. 「今日に戻る」→ 8/8 の表示に戻り、入力フォームが元のまま
4. 記録タブ(過去日)→ 記録一覧 or「この日の記録はありません」

(手順1-2は Task 10 で 8/7 のアーカイブを入れた後に完全確認。この時点では 8/8 のみで動線を確認)

---

### Task 9: ビルド成果物の検査

**Files:** なし(検証のみ)

- [ ] **Step 1: sw.js に archive が入っていないこと**

```powershell
cd apps\suminoe-log
npm run build
Select-String -Path out\sw.js -Pattern "archive"
```

Expected: ヒット 0 件

- [ ] **Step 2: out/archive/ が配信物に含まれること**

```powershell
Get-ChildItem out\archive
```

Expected: `index.json` / `racecard-20260808.json` / `results-20260808.json`

- [ ] **Step 3: リードの pytest とログの全テストを最終確認**

```powershell
cd ..\..\tools\suminoe-read
.\venv\Scripts\python.exe -m pytest -q
cd ..\..\apps\suminoe-log
npm test
```

Expected: 53 passed / 80 passed

---

### Task 10: 8/7・8/8 の復元とデプロイ

**Files:** なし(運用手順)

- [ ] **Step 1: 8/7 のアーカイブを生成**

```powershell
cd tools\suminoe-read
.\venv\Scripts\python.exe main.py --date 2026-08-07
.\venv\Scripts\python.exe review.py --date 2026-08-07
```

Expected: `archive/racecard-20260807.json` と `archive/results-20260807.json` が生成される。
キャッシュ(B260807/K260807)があるためネット再取得なしで完結する。

- [ ] **Step 2: 「いま扱う1件」を 8/8 に戻す**

Step 1 で `racecard.json` / `results.json` が 8/7 に上書きされているため、必ず 8/8 を再実行:

```powershell
.\venv\Scripts\python.exe main.py --date 2026-08-08
.\venv\Scripts\python.exe review.py --date 2026-08-08
```

Expected: `racecard.json` / `results.json` の `"date"` が `2026-08-08` に戻る。

- [ ] **Step 3: デプロイ**

```bash
cd tools/suminoe-read
FORCE=1 bash review-and-deploy.sh 2026-08-08
```

Expected: `完了: https://suminoe-log.vercel.app の買い目タブに 2026-08-08 の結果が並びました。`
(Vercel 上のビルドで index.json が自動生成される)

- [ ] **Step 4: 本番確認**

https://suminoe-log.vercel.app を開き、Task 8 Step 9 の 1〜4 を 8/7 込みで確認。
8/7 の収支タブに R9=勝負 として集計された数字が出ること(review.py の enrich 修正後の判定)。

---

## Self-Review 済みの注意点

- index.json は **`next build` より前**に生成する(public → out へのコピーに乗せるため)。
  スペック本文の「build-sw.mjs より先」より厳しい制約なので、こちらが正
- Task 10 の実行順は 8/7 → 8/8 の順を厳守(「いま扱う1件」を 8/8 で終わらせる)
- `mergeDayEntries` は記録側の日付も `isIsoDate` で検査する(localStorage のキーも外部入力扱い)
- 過去日の BetsTab で `focusRaceNo={form.raceNo}` のままなのは意図的(害がなく、追加状態を増やさない)
