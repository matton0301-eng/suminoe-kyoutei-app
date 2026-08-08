# 住之江観戦ツール（2026-08-09）

ボートレース住之江の現地観戦（2026-08-09 ナイター・優勝戦日）のための2ツール。

| ツール | 場所 | 概要 |
|---|---|---|
| スミノエ・リード | [tools/suminoe-read/](tools/suminoe-read/) | 出走表アナライザ（Python CLI）。当日朝に全12Rの判断材料をmd化。レース後は結果と照合 |
| スミノエ・ログ | [apps/suminoe-log/](apps/suminoe-log/) | 観戦記録PWA（Next.js）。現地でAndroid片手操作・オフライン動作・賭式別の買い目表示 |

**公開URL**: https://suminoe-log.vercel.app （Android Chrome で開き、⋮→「ホーム画面に追加」）

## 当日（8/9）は何もしなくてよい

Windows タスクスケジューラに登録済みのタスクが、**8/9 朝5:10 から番組表を自動で取得し、
アプリに反映してデプロイ**します。アプリを開けば12レース分の出走表と買い目が入っています。

- PCが起動していれば自動で走ります（5:10 に起動していなくても、**起動した時点で実行**されます）
- PCが一日中オフだった場合は、手動で1コマンド:
  ```bash
  bash tools/suminoe-read/refresh-and-deploy.sh 2026-08-09
  ```
- 実行ログ: `tools/suminoe-read/logs/refresh-2026-08-09.log`

**レースが終わった夜も自動で動きます。** 21:30 から成績を取得し、事前の読みと突き合わせて
アプリの買い目タブに結果を並べます（着順・決まり手・提示した型が当たったか・払戻金）。

## ドキュメント

- [全体像・スケジュール・リスク](docs/00-overview.md)
- [スミノエ・ログ 確定仕様](docs/01-suminoe-log-spec.md)
- [スミノエ・リード 確定仕様](docs/02-suminoe-read-spec.md)
- [番組表フォーマット検証レポート](docs/03-bangumihyou-format.md)（実データで桁位置確定済み）

開発の進め方は [CLAUDE.md](CLAUDE.md) を参照。
