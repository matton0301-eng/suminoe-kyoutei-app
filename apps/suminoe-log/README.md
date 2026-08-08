# スミノエ・ログ — 住之江観戦記録アプリ

2026-08-09（日）のボートレース住之江ナイター観戦で、Android を片手操作しながら
1レース分の記録を20秒以内に取るための PWA。**オフラインで完全に動作します。**

確定仕様: [../../docs/01-suminoe-log-spec.md](../../docs/01-suminoe-log-spec.md)

## 画面

| タブ | 内容 |
|---|---|
| 記録 | レース番号・予想・展示・結果1〜3着・決まり手・水面メモをタップで入力 |
| 買い目 | スミノエ・リードの出走表データを取り込み、賭式ごとの買い目を表示 |
| 集計 | 予想的中率、コース別1着率（住之江の基準値と比較）、決まり手内訳、今日の水面の読み |
| 書き出し | 全記録をテキスト／CSV でコピー |

## 開発

```bash
npm install
npm run dev        # 開発サーバー (http://localhost:3000)
npm run build      # 静的エクスポート + Service Worker 生成 → out/
npm test           # 買い目ロジックのテスト (29ケース)
npm run typecheck  # tsc --noEmit
npm run lint
npm run icons      # PWAアイコンを再生成（public/icons/）
```

`npm run build` は `next build` のあとに `scripts/build-sw.mjs` を実行します。
Next.js はアセット名にハッシュを付けるため、**プリキャッシュ一覧はビルド出力を走査して生成**しています。
手書きの一覧は必ずズレるので、`out/sw.js` を直接編集しないでください。

ビルド出力をローカルで確認する:

```bash
npm run start      # out/ を http://localhost:3000 で配信
```

## Vercel へのデプロイ

### 初回

```bash
npm i -g vercel      # 未インストールなら
cd apps/suminoe-log
vercel               # 初回は対話でプロジェクトを作成
vercel --prod        # 本番デプロイ
```

環境変数・データベース・認証は一切使いません。

> ### ⚠ `vercel.json` を消さないこと
>
> `framework: null` / `outputDirectory: "out"` を明示しています。**これがないと `/sw.js` が 404 になります。**
>
> Vercel の Next.js ビルダーは `.next` から `/vercel/output` を独自に組み立てるため、
> `next build` の**後**に `out/` へ足したファイル（= 生成した Service Worker）を拾いません。
> ビルドログには `[build-sw] out/sw.js を生成` と出るのに本番で404になる、という形で現れます。
>
> `framework: null` にすると Vercel は `out/` をそのまま静的配信するので、`sw.js` が届きます。
> 2026-08-07 に実際に踏んで修正しました。

### 2回目以降

```bash
cd apps/suminoe-log
vercel --prod
```

デプロイ後に表示される URL（`https://<project>.vercel.app`）を Android で開きます。

> **更新をデプロイしたとき**: Service Worker はキャッシュ優先なので、端末は一度古い版を表示します。
> 起動時に更新を検知して自動で1回リロードする仕組みを入れてありますが、
> 反映されない場合はアプリを一度閉じて開き直してください。

## Android ホーム画面への追加

1. Chrome で公開 URL を開く
2. 右上の「⋮」→ **ホーム画面に追加**
3. 名前（スミノエ）を確認して「追加」
4. ホーム画面のアイコンから起動すると、アドレスバーなしの全画面で開きます

## オフライン動作の確認（8/8 中に必ず実施）

競艇場は来場者が多く回線が不安定になります。**現地で開けないと何もできない**ので、
事前に必ず次の手順で確認してください。

1. Wi-Fi につないだ状態で、ホーム画面のアイコンからアプリを起動する
2. 4つのタブすべてを開く（ここで全アセットがキャッシュされます）
3. **機内モードをオンにする**
4. アプリを完全に閉じる（タスク一覧からスワイプで消す）
5. もう一度ホーム画面のアイコンから起動する
6. 記録 → 保存 → 集計 → 書き出し が動くことを確認する

機内モードで起動できなければ、キャッシュが完成していません。手順1〜2をやり直してください。

## 買い目タブへのデータ取り込み

1. パソコンで [スミノエ・リード](../../tools/suminoe-read/) を実行する

   ```powershell
   cd tools\suminoe-read
   .\venv\Scripts\Activate.ps1
   python main.py --date 2026-08-09
   ```

2. `output/suminoe_20260809.json` をテキストエディタで開き、**中身を全部コピー**
3. スマホでアプリの「買い目」タブを開き、枠に貼り付けて「取り込む」

一度取り込めば端末に保存されるので、現地ではオフラインで見られます。
（メールや Google ドライブ経由でスマホに送るのが手軽です）

記録の「全記録を消す」では出走表データは消えません。別々のキーで保存しています。

## データの保存場所

すべて端末の localStorage です。サーバーには何も送りません。

| キー | 内容 |
|---|---|
| `suminoe-log-20260809` | 観戦記録 |
| `suminoe-draft` | 入力途中の下書き（保存前にブラウザが落ちても復元） |
| `suminoe-racecard-20260809` | 取り込んだ出走表データ |

**ブラウザのデータを消すと記録も消えます。** こまめに「書き出し」タブからコピーしてください。

## ファイル構成

```
apps/suminoe-log/
├── app/
│   ├── layout.tsx        メタデータ・PWA設定・SW登録
│   ├── page.tsx          単一ページ（タブ切り替えと状態管理）
│   └── globals.css       カラートークン（ナイター向けダークUI）
├── components/
│   ├── BoatPicker.tsx    枠色ボタン6個（艇色がUIの基本言語）
│   ├── RecordTab.tsx     記録タブ
│   ├── BetsTab.tsx       買い目タブ
│   ├── StatsTab.tsx      集計タブ
│   ├── ExportTab.tsx     書き出しタブ
│   ├── TabBar.tsx        下部固定タブ
│   ├── Toast.tsx / ConfirmDialog.tsx
│   └── ServiceWorkerRegister.tsx
├── lib/
│   ├── types.ts          ドメイン型・枠色・決まり手
│   ├── baseline.ts       住之江の基準値（ハードコード）
│   ├── storage.ts        localStorage（使えない環境でも落ちない）
│   ├── formReducer.ts    フォームの状態遷移（着順の重複解消を含む）
│   ├── aggregate.ts      集計と「今日の水面の読み」
│   ├── betting.ts        賭式ごとの買い目生成
│   ├── raceCard.ts       取り込みJSONの検証
│   ├── exporters.ts      テキスト／CSV
│   └── __fixtures__/     リードの実出力（テスト用）
├── scripts/
│   ├── build-sw.mjs      Service Worker 生成（ビルド出力を走査）
│   └── make-icons.mjs    PWAアイコン生成（依存ゼロ、zlibのみ）
└── public/
    ├── manifest.json
    └── icons/            192px / 512px
```
