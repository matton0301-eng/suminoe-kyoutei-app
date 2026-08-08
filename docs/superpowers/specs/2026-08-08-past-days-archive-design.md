# 過去日アーカイブ機能 設計書

- 日付: 2026-08-08
- 状態: 設計承認済み(実装前)
- 対象: スミノエ・ログ(apps/suminoe-log)+ スミノエ・リード(tools/suminoe-read)

## 背景

アプリの出走表・結果は「いま扱う1件」だけをサーバー(`/racecard.json` / `/results.json`)に置く設計のため、
新しい開催日のデータがデプロイされると前日の出走表・結果・収支がアプリから見られなくなる。
観戦記録(localStorage)は日付ごとのキーで端末に残っているが、UI に過去日へ切り替える手段がない。

利用者はこのアプリを 2026-08-09 の初観戦後も継続利用する予定であり、
「過去の開催日を振り返れること」は継続利用の土台になる。

## 目的

過去の開催日を選んで、その日の観戦記録・出走表・買い目・結果・収支を**閲覧専用**で見られるようにする。

## スコープ

**やること**

- サーバーに日付付きの出走表・結果を蓄積する(`/archive/`)
- アプリのヘッダーから日付を切り替える UI
- 過去日の全タブ表示(記録・買い目・統計・収支・書き出し)
- 過去日は閲覧専用(保存・編集・削除の操作を出さない)
- 8/7・8/8 分のアーカイブ復元

**やらないこと(YAGNI)**

- 過去日の記録の編集(「翌日に前日分を直す」は現行の自動日付でカバー済み)
- 過去日データのオフライン対応(SW キャッシュ)
- 日をまたいだ通算集計(節間収支など)。将来の機能強化案として別途検討
- 住之江以外の場への対応

## データ設計

### アーカイブファイル(サーバー)

```
apps/suminoe-log/public/archive/
  racecard-20260807.json   ← main.py が racecard.json と同時に書く(同一内容)
  results-20260807.json    ← review.py が results.json と同時に書く(同一内容)
  index.json               ← ビルド時に自動生成。手書きしない
```

- ファイル形式は既存の racecard.json / results.json と同一(schemaVersion 1)。変換しない
- git にコミットして蓄積する(1日あたり約50KB)
- 同じ日付の再取得(FORCE=1)では上書きされる(冪等)

### index.json のスキーマ

```json
{
  "schemaVersion": 1,
  "days": [
    { "date": "2026-08-08", "hasCard": true, "hasResults": true },
    { "date": "2026-08-07", "hasCard": true, "hasResults": true }
  ]
}
```

- 新しい日付が先頭。`days` はビルドスクリプトが `public/archive/` のファイル名から生成する
- 日付は ISO 形式(`YYYY-MM-DD`)。ファイル名の `YYYYMMDD` から復元する

## リード側の変更(tools/suminoe-read)

1. **main.py**: `public/racecard.json` を書くとき、`public/archive/racecard-YYYYMMDD.json` にも同じ内容を書く
2. **review.py**: `public/results.json` を書くとき、`public/archive/results-YYYYMMDD.json` にも同じ内容を書く
3. デプロイスクリプト(refresh-and-deploy.sh / review-and-deploy.sh)は**変更不要**
4. 自動タスク(タスクスケジューラ)も**変更不要**

書き出し元が責任を持つ(コピーをシェルに任せない)。

## アプリ側の変更(apps/suminoe-log)

### ビルド

- `scripts/build-archive-index.mjs`(新規): `public/archive/` を走査して `index.json` を生成
- `npm run build` のチェーンに組み込む(`next build && node scripts/build-archive-index.mjs && node scripts/build-sw.mjs`)
  - build-sw.mjs より先に実行する(index.json も out/ に含まれるため)
- **build-sw.mjs に `/archive/` の precache 除外を追加**。過去日データは precache しない。
  SW の 500KB 検査対象からも外れる

### 状態(page.tsx)

- `viewDate: string | null` を追加。`null` = 通常運用(現行どおり)
- `archiveView: { card: RaceCard | null; results: ResultDay | null; logs: RaceLog[] } | null` を追加。
  過去日表示用のデータ一式。**当日の state(logs / raceCard / results / form / draft)には一切触れない**
- 過去日を選ぶと: `/archive/racecard-*.json` と `/archive/results-*.json` を fetch し、
  `loadLogs(viewDate)` で記録を読み、`archiveView` に格納
- 「今日に戻る」で `viewDate = null`、`archiveView = null`。当日 state は無変更なので再読込不要

### 日付リスト UI

- ヘッダーの日付ラベルをタップ → 日付リスト(モーダルシート)
- リストの内容 = `index.json` の日付 ∪ localStorage に記録キー(`suminoe-log-YYYYMMDD`)がある日付
- 各行の表示例: `8/7(木) 出走表・結果あり / 記録3件`
  - `hasCard` / `hasResults` / 記録件数に応じて文言を変える(結果が未確定の日は「出走表あり」だけ)
- 当日(通常運用の日)には「今日」と表示。選ぶと `viewDate = null`

### 閲覧専用の挙動

| タブ | 過去日での表示 |
|---|---|
| 記録 | 入力フォームの代わりに**記録一覧**(新コンポーネント)。1Rから順に予想・結果・決まり手・水面・メモ・記録時刻を読み取り専用で表示。記録が無い日は「この日の記録はありません」 |
| 買い目 | そのまま(データ源が過去日)。取り込み・クリアのボタンは隠す。展示の反映は過去日の記録の値を使う |
| 統計 | そのまま(過去日の記録で集計) |
| 収支 | そのまま(過去日の出走表・結果で計算) |
| 書き出し | そのまま(読み取り操作のため)。「全記録を消す」ボタンは隠す |

- 上部に常時バナー「閲覧専用 — 8/7(木) のデータを表示中 [今日に戻る]」
  (既存の `viewingPastDay` バナーを置き換える)
- 締切の自動選択・残り時間表示は過去日では出さない

### エラー処理

- `index.json` が取得できない(オフライン等): 日付リストには localStorage の記録がある日だけ出し、
  「過去の出走表・結果はオンラインで見られます」と添える
- アーカイブの fetch 失敗・パース失敗: その日の記録と統計だけ表示し、同じ案内を出す。
  買い目・収支タブは「この日の出走表・結果は取得できませんでした」
- パースは既存の `parseRaceCard` / `parseResults` をそのまま使う(不正データはここで弾かれる)
- index.json のパースも型を検査し、形が合わない要素は捨てる(既存方針)

## テスト

- `lib/archive.ts`(新規。index のパースと日付リストのマージを持つ)に vitest:
  - index.json の正常系・不正データ(型違い・日付形式違い)の排除
  - 「アーカイブの日付 ∪ 記録がある日付」のマージと降順ソート
  - 記録キー(`suminoe-log-YYYYMMDD`)からの日付抽出
- 既存テストが全て通ること(リード pytest 53 / ログ vitest 72)
- 手動確認: ビルド後の `sw.js` に `/archive/` が含まれないこと

## 復元・展開手順

1. 実装完了後、リードを再実行して 8/7・8/8 のアーカイブを生成
   - 8/7: `main.py --date 2026-08-07 --local-file cache/B260807.TXT` + `review.py --date 2026-08-07`
   - 8/8: 同様(キャッシュ済みデータで完結。ネット再取得は不要)
   - このとき「いま扱う1件」(`racecard.json` / `results.json`)は**必ず 8/8 の状態で終わらせる**
     (8/7 の再実行が上書きした場合は 8/8 を最後にもう一度実行する)
2. ビルド → デプロイ
3. 8/9 朝以降の自動タスクは無変更でアーカイブが増えていく

## 制約(設計思想の維持)

- 外部通信は同一オリジンのみ(archive も同一オリジン)。外部 API は呼ばない
- 買い目・収支の計算ロジックには触れない(データ源が変わるだけ)
- 過去日の収支表示にも既存の注意書き(母数・控除率)がそのまま付く
