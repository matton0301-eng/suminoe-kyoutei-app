# Plan C: 直前情報(展示タイム・チルト・部品交換)の取り込み 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (または subagent-driven-development) to implement this plan task-by-task.
> **先に** [2026-08-08-enhancement-roadmap.md](2026-08-08-enhancement-roadmap.md) の共通制約を読むこと。

**Goal:** 公式サイトの直前情報(展示タイム・チルト・部品交換・スタート展示)を開催日に自動取得して `/tenji.json` としてデプロイし、アプリの買い目タブに表示する。過去日アーカイブにも `tenji-YYYYMMDD.json` として残す。

**Architecture:** リード側に `beforeinfo.py`(新規 CLI)を作り、公開済みレースの直前情報をスクレイピングして JSON を書き出す。`tenji-and-deploy.sh` が差分のあるときだけビルド+デプロイし、タスクスケジューラで開催日に30分おきに回す。アプリは同一オリジンの `/tenji.json` を読んで買い目タブの出走表に列を足すだけ。**買い目の評価(スコア)には反映しない** — 手動の「展示で速そう」入力と二重に効かせないため。

**Tech Stack:** Python 3.14 / requests / BeautifulSoup4(要追加) / pytest / Next.js / vitest

## Global Constraints(ロードマップ共通制約に加えて)

- 直前情報は**表示のみ**。`betting.ts` のスコアには入れない(手動の展示入力が既にあり、二重に効かせない)
- 公式サイトへのアクセスは 1.5 秒間隔、連続3回失敗で打ち切り(collect-history.py の流儀)
- 直前情報は各レースの周回展示後(締切の10〜15分前)に順次公開される。
  **未公開のレースはエラーではなく「まだ」**として扱う
- パッケージ追加(beautifulsoup4)はユーザーの承認を得てから
- デプロイの冪等性: 前回と内容が同じなら何もしない(タスクは30分おきに走るため)

## データ契約: tenji.json のスキーマ

```json
{
  "schemaVersion": 1,
  "date": "2026-08-09",
  "updatedAt": "2026-08-09T15:42:00+09:00",
  "races": [
    {
      "raceNo": 1,
      "available": true,
      "entries": [
        {
          "teiban": 1,
          "tenjiTime": 6.72,
          "tilt": -0.5,
          "weight": 52.0,
          "partsChanged": ["リング"],
          "stCourse": 1,
          "stTime": 0.12
        }
      ],
      "weather": { "temp": 31.0, "windM": 3, "windDir": "北", "waveCm": 2 }
    },
    { "raceNo": 2, "available": false, "entries": [], "weather": null }
  ]
}
```

- 取れない項目は null。`available: false` は「まだ公開されていない」
- `stTime` はスタート展示のタイミング(F は負値、例 -0.02)
- アーカイブ用は同一内容を `public/archive/tenji-YYYYMMDD.json` にも書く

---

### Task C0: 直前情報ページの実地検証(fixture 収集)

**Files:**
- Create: `tools/suminoe-read/tests/fixtures/beforeinfo_sample.html`(公開済みレース)
- Create: `tools/suminoe-read/tests/fixtures/beforeinfo_pending.html`(未公開レース)

- [ ] **Step 1: ページの実在確認**

直近の住之江開催日・公開済みレースで取得(URL はロードマップ参照):

```
https://www.boatrace.jp/owpc/pc/race/beforeinfo?rno=1&jcd=12&hd=<開催日YYYYMMDD>
```

- [ ] **Step 2: fixture を2枚保存**(公開済み / 未公開)。
  展示タイム・チルト・部品交換・スタート展示・気象が HTML のどこにあるかをメモし、
  期待値を各項目1つ以上書き出す(Task C1 のテストに使う)
- [ ] **Step 3: 未公開ページの判別条件を確認**(空テーブルか、専用の文言か)

---

### Task C1: suminoe/beforeinfo_parser.py — パーサ(TDD)

**Files:**
- Create: `tools/suminoe-read/suminoe/beforeinfo_parser.py`
- Create: `tools/suminoe-read/tests/test_beforeinfo_parser.py`

**Interfaces:**

```python
@dataclass(frozen=True)
class TenjiEntry:
    teiban: int
    tenji_time: float | None
    tilt: float | None
    weight: float | None
    parts_changed: tuple[str, ...]
    st_course: int | None
    st_time: float | None

@dataclass(frozen=True)
class RaceBeforeInfo:
    race_no: int
    available: bool
    entries: tuple[TenjiEntry, ...]
    weather: WeatherInfo | None   # temp / wind_m / wind_dir / wave_cm

def parse_beforeinfo(html: str, race_no: int) -> RaceBeforeInfo:
    """未公開ページは available=False で返す。パース不能は BeforeInfoParseError。"""
```

- [ ] **Step 1: ユーザーに beautifulsoup4 追加の承認を得る**(`requirements.txt` に追記、venv に install)
- [ ] **Step 2: fixture でテストを書く**(C0 の期待値。公開済み: 6艇分の展示タイム等 / 未公開: available=False / 壊れた HTML: 例外)
- [ ] **Step 3: 落ちることを確認** → **Step 4: BeautifulSoup で実装** → **Step 5: pytest パス**

既存の流儀に合わせる: パーサは suminoe/ パッケージ内・純関数・frozen dataclass
(parser.py / result_parser.py と同じ形)。

---

### Task C2: beforeinfo.py — CLI と JSON 書き出し

**Files:**
- Create: `tools/suminoe-read/beforeinfo.py`
- Modify: `tools/suminoe-read/suminoe/fetcher.py`(HTML 取得の共通関数があれば再利用。無ければ
  beforeinfo.py 内に requests + リトライ + 1.5秒間隔を実装)

**Interfaces:**
- CLI: `python beforeinfo.py [--date 2026-08-09] [--races 1-12]`
- 出力: `apps/suminoe-log/public/tenji.json` と `apps/suminoe-log/public/archive/tenji-YYYYMMDD.json`
  (スキーマは冒頭の「データ契約」)

- [ ] **Step 1: 実装**

- 全12R(または --races 指定分)を順に取得。**1.5秒間隔、連続3回失敗で打ち切り**
- **JSON のキーは冒頭の「データ契約」どおり camelCase**(Python 側 dataclass は snake_case なので
  書き出し時に変換する。アプリ側 parseBeforeInfo と食い違うとプラン C4 が壊れる)
- 12R 全部が `available: false` でも JSON は書く(updatedAt で鮮度が分かる)
- 標準出力は UTF-8 reconfigure(main.py の `_configure_stdout` と同じ)
- 出力前に既存の tenji.json と `races` 部分を比較し、**同一なら書き換えない**で
  終了コード 3 を返す(deploy スクリプトが「変化なし」を判定できるように)

- [ ] **Step 2: 手動実行で検証**(開催日なら実データ、非開催日なら
  `--local-file tests/fixtures/beforeinfo_sample.html` 的なテスト用オプションを足して確認)
- [ ] **Step 3: pytest 全件パス**

---

### Task C3: tenji-and-deploy.sh と自動タスク

**Files:**
- Create: `tools/suminoe-read/tenji-and-deploy.sh`(+ `.cmd` ラッパー。**CRLF 必須**)
- Modify: `tools/suminoe-read/make-task-xml.py`(`--action tenji` を追加)

- [ ] **Step 1: シェルスクリプト**

`review-and-deploy.sh` を雛形にする。流れ:
1. `beforeinfo.py` を実行
2. 終了コード 3(変化なし)なら「変化なし。デプロイしません」で正常終了
3. 変化があれば `npm run build` + `vercel deploy --prod`(review-and-deploy.sh と同じ手順)
4. ログは `logs/tenji-<date>.log`

- [ ] **Step 2: make-task-xml.py に --action tenji を追加**

30分おき × 10時間(初回 12:00 起動。住之江ナイターの1Rは15時台、余裕を持って昼から)。
使い方の想定:

```powershell
python make-task-xml.py --action tenji --date 2026-08-09 --time 12:00
schtasks /create /xml "...task-tenji.xml" /tn "Suminoe-Tenji-0809" /f
```

- [ ] **Step 3: タスク登録はユーザーに確認してから**(schtasks はシステム状態の変更)

---

### Task C4: アプリでの表示

**Files:**
- Create: `apps/suminoe-log/lib/beforeInfo.ts`(型 + `parseBeforeInfo(raw)` + `fetchBeforeInfo()`)
- Create: `apps/suminoe-log/lib/beforeInfo.test.ts`
- Modify: `apps/suminoe-log/components/BetsTab.tsx`(出走表テーブルに列を追加)
- Modify: `apps/suminoe-log/app/page.tsx`(起動時 fetch と BetsTab への受け渡し)
- Modify: `apps/suminoe-log/lib/archive.ts` + `scripts/build-archive-index.mjs`
  (index に `hasTenji` を追加。`tenji-(\d{8})\.json` を走査対象に足す)
- Modify: `apps/suminoe-log/lib/totalLoader.ts` は変更不要(直前情報は収支に関係しない)

**Interfaces:**

```ts
// lib/beforeInfo.ts
export interface TenjiEntry {
  teiban: Boat; tenjiTime: number | null; tilt: number | null; weight: number | null;
  partsChanged: string[]; stCourse: number | null; stTime: number | null;
}
export interface TenjiRace { raceNo: number; available: boolean; entries: TenjiEntry[] }
export interface TenjiDay { date: string; updatedAt: string; races: TenjiRace[] }
export function parseBeforeInfo(raw: string): TenjiDay | null;  // schemaVersion 検証、境界検証(既存流儀)
export function fetchBeforeInfo(): Promise<TenjiDay | null>;    // '/tenji.json'
export function fetchArchiveTenji(iso: string): Promise<TenjiDay | null>; // '/archive/tenji-YYYYMMDD.json'
```

- [ ] **Step 1: parseBeforeInfo の TDD**(正常 / schemaVersion 違い / 型崩れの排除。
  archive.test.ts と同じ形式で 4 ケース以上)
- [ ] **Step 2: BetsTab の出走表テーブルに列を足す**

- 「展示T」列: `tenjiTime`。**そのレースの最速値を太字+アクセント色**にする
- チルトは値があるときだけ選手名の下に小さく(列を増やしすぎない。幅360pxの横スクロール禁止を実測で確認)
- 部品交換があれば選手名の横に「部品」バッジ(内容はタップで title 表示ではなく、レース情報の注記欄に文字列で出す)
- データが無い(`available: false` / tenji.json 自体が無い)ときは列ごと出さない(空列を出さない)
- 日付が合わない tenji.json(前日のもの)は使わない(`tenji.date === card.date` を検査)

- [ ] **Step 3: page.tsx の配線**

- 起動時に `fetchBeforeInfo()`(fetchResults と同じ並び)。
  過去日閲覧(`viewing`)では `fetchArchiveTenji(viewDate)` を archiveView と一緒に取得
- 5分おきに `/tenji.json` を再取得して更新する(締切前に最新が入る。
  `setInterval` は既存の時計 effect と同様の形。**画面が開いている間だけ**)

- [ ] **Step 4: 検証**

```powershell
npm run typecheck && npm run lint && npm test && npm run build
```

- `out/sw.js` に `/archive/` が含まれないこと(tenji-*.json も archive 配下なので自動で除外される)
- `/tenji.json` 自体は precache されてよい(racecard.json と同じ扱い)
- 幅360px で横スクロールが出ないこと(ブラウザ実測。CLAUDE.md の絶対ルール)

---

### Task C5: 最終検証と展開

- [ ] リード pytest / ログ vitest / typecheck / lint / build 全パス
- [ ] 開催日に手動で `beforeinfo.py` → デプロイ → 実機で展示タイムが見えることを確認
- [ ] `docs/00-overview.md` か CLAUDE.md の自動化表に Suminoe-Tenji タスクの行を追記
  (登録したタスク名・起動時刻・内容。**登録済みのものだけ**書く)
