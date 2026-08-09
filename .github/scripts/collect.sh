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

case "$JOB" in
  refresh)
    # 番組表。当日早朝に公開される。取れたらアプリ用の JSON に反映する
    (cd "$READ_DIR" && run python main.py --date "$TARGET_DATE")
    ;;

  tenji)
    # 直前情報（展示タイム）とオッズ。レースごとに順次公開される
    (cd "$READ_DIR" && run python beforeinfo.py --date "$TARGET_DATE")
    run "$TSX" "$MCP_SCRIPTS/fetch-odds.ts" --date "$TARGET_DATE"
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
