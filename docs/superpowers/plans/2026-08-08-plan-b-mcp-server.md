# Plan B: MCP サーバー(記録・アーカイブ・オッズ) 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (または subagent-driven-development) to implement this plan task-by-task.
> **先に** [2026-08-08-enhancement-roadmap.md](2026-08-08-enhancement-roadmap.md) の共通制約を読むこと。
> mcp-server-patterns スキル(Node/TypeScript SDK)が利用可能なら参照してよい。

**Goal:** 蓄積した出走表・結果・収支・照合レポートと、公式サイトの現在オッズを Claude から読めるローカル MCP サーバー(stdio)を作る。「昨日の観戦を振り返って」「いまのオッズと読みの乖離は?」に対話で答えられるようにする。

**Architecture:** `tools/suminoe-mcp/`(Node/TypeScript、独立 package)。データ読み取りはファイルシステム(`apps/suminoe-log/public/archive/` と `tools/suminoe-read/output/`)から行い、収支計算はアプリの `lib/tally.ts` を**相対 import でそのまま再利用**する(アプリの lib はすべて相対 import で書かれているため、tsx 実行でエイリアス設定なしに動く)。オッズだけは公式サイトをその場で取得する(60秒キャッシュ、1.5秒間隔)。

**Tech Stack:** Node 24 / TypeScript / @modelcontextprotocol/sdk / zod / cheerio / tsx / vitest

## Global Constraints(ロードマップ共通制約に加えて)

- **すべてのツールは読み取り専用。** ファイルを書かない、状態を持たない(オッズキャッシュはメモリのみ)
- オッズを返すときは必ず「オッズは変動する。取得時刻: HH:MM:SS」を応答に含める
- ツールの応答に賭け金の推奨・断定的な的中予測を含めない(データを返すだけ。判断は対話側)
- **パッケージ追加(npm install)はユーザーに目的を説明して承認を得てから**(グローバル安全ルール)
- アプリ(apps/suminoe-log)のコードは変更しない。import して使うだけ

---

### Task B0: オッズ・データ配置の実地検証(fixture 収集)

**Files:**
- Create: `tools/suminoe-mcp/tests/fixtures/odds3t.html`(実ページの保存)
- Create: `tools/suminoe-mcp/tests/fixtures/odds3t-empty.html`(締切後 or 発売前のページ)

- [ ] **Step 1: オッズページの実在確認**

WebFetch または curl で以下を取得し、HTTP 200 と中身を確認する
(開催日でないとオッズは出ない。**直近の住之江開催日**の日付を使う。過去日は確定オッズが出ることがある):

```
https://www.boatrace.jp/owpc/pc/race/odds3t?rno=12&jcd=12&hd=<直近開催日YYYYMMDD>
```

- [ ] **Step 2: fixture を保存**

取得した HTML をそのまま `tests/fixtures/odds3t.html` に保存する。
オッズ表が空のケース(発売前のレース or 開催のない日)も1枚保存する。
**HTML 内のどのテーブル・クラス名にオッズが入っているかをメモし、Task B4 のパーサはこの fixture で TDD する。**

- [ ] **Step 3: レース一覧の組み合わせ順を確認**

3連単オッズ表は「1着艇ごとの列 × 2着3着の行」形式が通例。fixture を目視して、
組み合わせ(例: 1-2-3)とオッズ値の対応を確認し、テストの期待値を3点以上書き出す。

---

### Task B1: パッケージの土台

**Files:**
- Create: `tools/suminoe-mcp/package.json`
- Create: `tools/suminoe-mcp/tsconfig.json`
- Create: `tools/suminoe-mcp/vitest.config.ts`

- [ ] **Step 1: ユーザーに依存パッケージの承認を得る**

追加するもの(すべて `tools/suminoe-mcp/` ローカル):
- `@modelcontextprotocol/sdk` — MCP 公式 SDK(サーバー本体)
- `zod` — ツール入力の検証
- `cheerio` — オッズ HTML のパース
- `tsx` — TypeScript を直接実行(ビルド工程を持たないため)
- `vitest` — テスト(アプリ側と同じ)
- `typescript`, `@types/node` — 型

- [ ] **Step 2: package.json**

```json
{
  "name": "suminoe-mcp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx server.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

`npm install @modelcontextprotocol/sdk zod cheerio && npm install -D tsx vitest typescript @types/node`

- [ ] **Step 3: tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": false,
    "esModuleInterop": true
  },
  "include": ["server.ts", "lib/**/*.ts", "tests/**/*.ts", "../../apps/suminoe-log/lib/**/*.ts"]
}
```

注: アプリの lib を include するのは型検査のため。アプリ側 tsconfig には触れない。
拡張子なし相対 import が nodenext で通らない場合は `module: esnext` + `moduleResolution: bundler` に切り替える
(tsx はどちらでも実行できる)。

- [ ] **Step 4: 動作確認**

```powershell
cd tools\suminoe-mcp
npx tsx -e "import { tallyDay } from '../../apps/suminoe-log/lib/tally'; console.log(typeof tallyDay)"
```

Expected: `function`(アプリ lib の再利用が成立している)

---

### Task B2: lib/data.ts — アーカイブ・レポートの読み取り(TDD)

**Files:**
- Create: `tools/suminoe-mcp/lib/data.ts`
- Create: `tools/suminoe-mcp/tests/data.test.ts`

**Interfaces:**
- Produces:

```ts
export interface DayFiles { date: string; hasCard: boolean; hasResults: boolean; hasReview: boolean }
export function listDays(): DayFiles[];                       // archive/ と output/ を走査。日付降順
export function readCard(date: string): RaceCard | null;      // parseRaceCard で検証して返す
export function readResults(date: string): ResultDay | null;
export function readReviewMarkdown(date: string): string | null;
export function computeTally(date: string): DayTally | null;  // readCard + readResults + tallyDay
export function readExportedLogs(date: string): string | null; // data/logs/suminoe-log-YYYYMMDD.csv
```

- Consumes: `parseRaceCard`(apps 側 lib/raceCard)、`parseResults`(lib/results)、`tallyDay`(lib/tally)

パスの規約(`lib/paths.ts` に定数化):

```ts
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, '..', '..', '..');
export const ARCHIVE_DIR = join(REPO_ROOT, 'apps', 'suminoe-log', 'public', 'archive');
export const REVIEW_DIR = join(REPO_ROOT, 'tools', 'suminoe-read', 'output');
/** アプリの書き出しタブから保存した CSV の置き場(ユーザーが手で置く) */
export const EXPORTED_LOGS_DIR = join(HERE, '..', 'data', 'logs');
```

- [ ] **Step 1: テストを書く** — 実データ(archive/ に 8/7・8/8 が存在する)を使い:
  - `listDays()` が 2026-08-08, 2026-08-07 を降順で返し、hasCard/hasResults が true
  - `readCard('2026-08-08')?.races` が 12 件
  - `computeTally('2026-08-08')?.investedYen` が 27600
  - `readCard('9999-99-99')` が null(存在しない日付)
  - `readCard('../etc/passwd')` が null(**日付形式 `^\d{4}-\d{2}-\d{2}$` を検証してから
    ファイル名を組み立てる。パス結合に生の入力を使わない**)
- [ ] **Step 2: 落ちることを確認** → **Step 3: 実装** → **Step 4: パス**

```powershell
npx vitest run tests/data.test.ts
```

---

### Task B3: server.ts — MCP サーバー本体(データツール)

**Files:**
- Create: `tools/suminoe-mcp/server.ts`

**Interfaces:**
- ツール名と入出力(すべて zod で検証):

| ツール | 入力 | 返すもの |
|---|---|---|
| `suminoe_list_days` | なし | 日付一覧と各日のデータ有無 |
| `suminoe_get_racecard` | `{ date, raceNo? }` | raceNo 指定: そのレースの判定・理由・買い目型・6艇の全属性。無指定: 12R分の要約(raceNo/判定/軸/betShape のみ) |
| `suminoe_get_results` | `{ date, raceNo? }` | 着順・決まり手・払戻(全賭式)。無指定は12R分の要約(order と 3連単配当) |
| `suminoe_get_tally` | `{ date }` | tallyDay の結果(JSON そのまま) |
| `suminoe_get_review` | `{ date }` | review_YYYYMMDD.md の全文 |
| `suminoe_get_my_logs` | `{ date }` | エクスポート CSV の中身。無ければ置き場の案内文 |

- [ ] **Step 1: 実装**

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { computeTally, listDays, readCard, readExportedLogs, readResults, readReviewMarkdown } from './lib/data.js';

const server = new McpServer({ name: 'suminoe', version: '0.1.0' });

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 形式');
const RACE_NO = z.number().int().min(1).max(12).optional();

function jsonResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 1) }] };
}

server.registerTool(
  'suminoe_list_days',
  { description: '住之江観戦ツールに蓄積された開催日の一覧(出走表・結果・照合レポートの有無つき)', inputSchema: {} },
  async () => jsonResult(listDays()),
);

server.registerTool(
  'suminoe_get_racecard',
  {
    description: '指定日の出走表と事前分析(判定・買い目の型)。raceNo 指定でそのレースの詳細、無指定で12R要約',
    inputSchema: { date: DATE, raceNo: RACE_NO },
  },
  async ({ date, raceNo }) => {
    const card = readCard(date);
    if (!card) return jsonResult({ error: `${date} の出走表はありません` });
    if (raceNo === undefined) {
      return jsonResult(card.races.map((race) => ({
        raceNo: race.raceNo, name: race.name, verdict: race.verdict, betShape: race.betShape,
      })));
    }
    return jsonResult(card.races.find((race) => race.raceNo === raceNo) ?? { error: `${raceNo}R がありません` });
  },
);

// suminoe_get_results / suminoe_get_tally / suminoe_get_review / suminoe_get_my_logs も同じ形で登録
// (get_my_logs は readExportedLogs が null のとき:
//  「記録はブラウザ内にあります。アプリの書き出しタブで CSV をコピーし、
//   tools/suminoe-mcp/data/logs/suminoe-log-YYYYMMDD.csv に保存してください」を返す)

const transport = new StdioServerTransport();
await server.connect(transport);
```

**stdio サーバーでは console.log を使わない**(プロトコルが壊れる)。ログは console.error へ。

- [ ] **Step 2: 手動で疎通確認**

```powershell
npx tsx server.ts
```

起動したら(入力待ちになる)、別ターミナルは使わず Ctrl+C で終了してよい。
クラッシュせず待機することを確認。

---

### Task B4: lib/odds.ts — オッズ取得(TDD、fixture ベース)

**Files:**
- Create: `tools/suminoe-mcp/lib/odds.ts`
- Create: `tools/suminoe-mcp/tests/odds.test.ts`

**Interfaces:**

```ts
export type OddsBetType = 'trifecta' | 'trio' | 'exacta' | 'quinella' | 'wide' | 'win' | 'place';

export interface OddsEntry { combo: number[]; odds: number | null; oddsMax?: number | null }
export interface RaceOdds {
  date: string; raceNo: number; betType: OddsBetType;
  fetchedAt: string;              // ISO
  entries: OddsEntry[];           // 全組み合わせ
}

/** fixture でテストする純関数 */
export function parseOdds3t(html: string, date: string, raceNo: number): RaceOdds | null;
/** 取得(60秒メモリキャッシュ、リクエスト間隔 1.5 秒、UA 固定) */
export function fetchOdds(date: string, raceNo: number, betType: OddsBetType): Promise<RaceOdds | null>;
```

- [ ] **Step 1: fixture でパーサのテストを書く**(B0 で確認した期待値3点以上 + 空ページで null)
- [ ] **Step 2: 落ちることを確認** → **Step 3: cheerio で実装** → **Step 4: パス**
- [ ] **Step 5: fetchOdds の実装**

- URL はロードマップの表のとおり。初版は 3連単(odds3t)のみ実装し、他は
  `{ error: 'この賭式は未対応です(初版は3連単のみ)' }` を返す。**未対応を隠さない**
- モジュールスコープの `Map<string, { at: number; data: RaceOdds }>` で 60 秒キャッシュ
- 直前のリクエストから 1.5 秒未満なら待つ(単純な await sleep)
- HTTP エラー・パース失敗は null(呼び出し側でエラーメッセージ化)

---

### Task B5: オッズツールの登録と Claude Code への接続

**Files:**
- Modify: `tools/suminoe-mcp/server.ts`
- Create: `.mcp.json`(リポジトリルート)

- [ ] **Step 1: ツール登録**

```ts
server.registerTool(
  'suminoe_get_odds',
  {
    description:
      '住之江の現在オッズ(公式サイトから取得)。オッズは変動するため取得時刻を必ず添えて返す。' +
      '事前の読み(suminoe_get_racecard の betShape)と合わせて乖離を見る用途。初版は3連単のみ',
    inputSchema: { date: DATE.optional(), raceNo: z.number().int().min(1).max(12) },
  },
  async ({ date, raceNo }) => {
    const target = date ?? new Date().toISOString().slice(0, 10);
    const odds = await fetchOdds(target, raceNo, 'trifecta');
    if (!odds) return jsonResult({ error: 'オッズを取得できませんでした(発売前・締切後・非開催日の可能性)' });
    return jsonResult({ ...odds, note: `オッズは変動します。取得時刻: ${odds.fetchedAt}` });
  },
);
```

- [ ] **Step 2: .mcp.json をリポジトリルートに作成**

```json
{
  "mcpServers": {
    "suminoe": {
      "command": "cmd",
      "args": ["/c", "npx", "tsx", "tools/suminoe-mcp/server.ts"]
    }
  }
}
```

(Windows の stdio サーバーは `cmd /c` 経由が確実。`claude mcp list` で認識を確認)

- [ ] **Step 3: 結合確認**

Claude Code を再起動して次を試す(ユーザーと一緒に):
- 「suminoe_list_days を呼んで」→ 8/7・8/8 が返る
- 「8/8 の収支は?」→ suminoe_get_tally 経由で −11,990円が返る
- 開催日中なら「12R のオッズは?」→ 取得時刻つきで返る

---

### Task B6: 最終検証

- [ ] `npm test`(tools/suminoe-mcp)全パス、`npm run typecheck` エラーなし
- [ ] アプリ側 vitest・リード pytest に影響がない(ファイルを1つも変更していないこと)
- [ ] README を `tools/suminoe-mcp/README.md` に書く: 目的 / ツール一覧 / 記録CSVの置き場の運用 /
  「読み取り専用。賭け金の推奨はしない」という方針
