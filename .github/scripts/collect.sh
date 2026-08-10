#!/usr/bin/env bash
#
# GitHub Actions から呼ばれる収集処理。
#
# ローカルの refresh/tenji/review-and-deploy.sh から**デプロイ部分を抜いた**もの。
# デプロイはワークフロー側が担当する（変化があったときだけ動かすため）。
#
# 環境変数:
#   JOB          refresh | tenji | review
#   TARGET_DATE  対象日 (YYYY-MM-DD)。空なら JST の今日
#
# 失敗しても全体は止めない。**取れないのは異常ではない**（発売前・レース前・
# 番組表の公開前など、まだ存在しないだけのことが大半）。
# 取れたぶんだけ書き出して、次の回に任せる。

set -uo pipefail

JOB="${JOB:-tenji}"
TARGET_DATE="${TARGET_DATE:-}"
if [ -z "$TARGET_DATE" ]; then
  TARGET_DATE="$(TZ=Asia/Tokyo date +%F)"
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
READ_DIR="$ROOT/tools/suminoe-read"
TSX="$ROOT/tools/suminoe-mcp/node_modules/.bin/tsx"
MCP_SCRIPTS="$ROOT/tools/suminoe-mcp/scripts"

echo "=== $TARGET_DATE / $JOB ==="

run() {
  echo "--- $* ---"
  "$@" || echo "  失敗（終了コード $?）。続けます。"
}

SCHEDULE_JSON="$ROOT/apps/suminoe-log/public/schedule.json"

# 開催予定を更新する。住之江は月に12日ほどしか開催がないので、
# これが無いと非開催日に404を取りに行くだけの実行を繰り返すことになる。
#
# **1日1回だけ取り直す。** 収集は15分おきに回るが、開催予定はその頻度で変わらない。
# 毎回取りに行くと公式サイトへ1日120回問い合わせることになる。
if python "$ROOT/.github/scripts/schedule_status.py" --stale "$SCHEDULE_JSON"; then
  (cd "$READ_DIR" && run python schedule.py --months 2)
else
  echo "開催予定は取得済みです（24時間以内）。取り直しません。"
fi

# 今日が開催日でなければ、ここで終わる。
#
# **予定が読めないときは止めない。** 予定の取得に失敗したせいで収集まで止まると、
# 開催日のオッズを丸ごと失う。オッズは過去に遡って取れないので、
# 「無駄に1回走る」より「1日分を失う」ほうがはるかに高くつく。
STATUS="$(python "$ROOT/.github/scripts/schedule_status.py" --check "$SCHEDULE_JSON" "$TARGET_DATE" 2>/dev/null || echo "unknown")"
case "$STATUS" in
  race)
    echo "$TARGET_DATE は開催日です。収集を続けます。"
    ;;
  no-race:*)
    echo "$TARGET_DATE は住之江の開催がありません。収集しません（次の開催: ${STATUS#no-race:}）。"
    exit 0
    ;;
  *)
    echo "開催予定を判定できませんでした。念のため収集を続けます。"
    ;;
esac

case "$JOB" in
  refresh)
    # 番組表。当日早朝に公開される。取れたらアプリ用の JSON に反映する
    (cd "$READ_DIR" && run python main.py --date "$TARGET_DATE")
    ;;

  tenji)
    # 直前情報（展示タイム）とオッズ。レースごとに順次公開される
    (cd "$READ_DIR" && run python beforeinfo.py --date "$TARGET_DATE")
    run "$TSX" "$MCP_SCRIPTS/fetch-odds.ts" --date "$TARGET_DATE"
    # 終わったレースの結果。**競走成績のファイルは全レース終了後にしか出ない**ので、
    # レース結果ページから1レースずつ拾う。これで当日中に的中と配当が分かる
    run "$TSX" "$MCP_SCRIPTS/fetch-live-results.ts" --date "$TARGET_DATE"
    ;;

  review)
    # 競走成績。全レース終了後にしか出ない
    (cd "$READ_DIR" && run python review.py --date "$TARGET_DATE")
    run "$TSX" "$MCP_SCRIPTS/fetch-odds.ts" --date "$TARGET_DATE"
    # 締切直前のオッズは全レース終了後にしか完成しない
    run "$TSX" "$MCP_SCRIPTS/build-closing-odds.ts" --date "$TARGET_DATE"
    ;;

  *)
    echo "不明な JOB: $JOB" >&2
    exit 1
    ;;
esac

echo "=== 完了 ==="
