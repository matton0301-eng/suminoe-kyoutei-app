#!/usr/bin/env bash
#
# 競走成績を取得して事前の読みと照合し、アプリに反映してデプロイする。
#
#   bash review-and-deploy.sh                     # 当日分
#   bash review-and-deploy.sh 2026-08-09          # 日付を指定
#   FORCE=1 bash review-and-deploy.sh 2026-08-09  # 同じ日付でも取り直す
#
# **冪等**: すでに同じ日付の結果がアプリに入っていれば何もせず終了する。
# 成績が未確定なら、更新もデプロイもせずに終了コード 3 を返す。
#
# 成績は**全レースが終わってから確定**する（住之江のナイターは21時頃。
# 8/6 は 20:53 JST に確定した）。レース前の成績ファイルは中身が空のまま存在するため、
# 取得側でサイズを見て弾いている。

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$HERE/../../apps/suminoe-log" && pwd)"
RESULTS_JSON="$APP_DIR/public/results.json"
LOG_DIR="$HERE/logs"
PYTHON="$HERE/venv/Scripts/python.exe"

TARGET_DATE="${1:-$(date +%Y-%m-%d)}"

mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/review-$TARGET_DATE.log"

log() {
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

# JSON から date を読む。Git Bash の POSIX パスは Windows の Python が開けないため grep で抜く。
read_json_date() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  grep -oE '"date":"[0-9]{4}-[0-9]{2}-[0-9]{2}"' "$file" \
    | head -1 \
    | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}'
}

log "=== 対象日 $TARGET_DATE の照合を開始 ==="

if [[ ! -x "$PYTHON" ]]; then
  log "エラー: venv が見つかりません ($PYTHON)。"
  exit 1
fi

# --- すでに反映済みなら何もしない（冪等） ---
if [[ -f "$RESULTS_JSON" && "${FORCE:-}" != "1" ]]; then
  CURRENT_DATE="$(read_json_date "$RESULTS_JSON")"
  if [[ "$CURRENT_DATE" == "$TARGET_DATE" ]]; then
    log "すでに $TARGET_DATE の結果が入っています。何もしません。"
    exit 0
  fi
  log "現在アプリに入っている結果は ${CURRENT_DATE:-（なし）} 分。$TARGET_DATE 分に更新します。"
fi

REVIEW_ARGS=(--date "$TARGET_DATE")
if [[ "${FORCE:-}" == "1" ]]; then
  log "FORCE=1 のためキャッシュを捨てて再取得します。"
  REVIEW_ARGS+=(--no-cache)
fi

log "成績を取得して照合します..."
if ! PYTHONIOENCODING=utf-8 "$PYTHON" "$HERE/review.py" "${REVIEW_ARGS[@]}" >>"$LOG_FILE" 2>&1; then
  log "照合できませんでした（成績が未確定の可能性）。デプロイは行いません。"
  log "  → 成績は全レース終了後（21時頃）に確定します。時間をおいて再実行してください。"
  exit 3
fi

WROTE_DATE="$(read_json_date "$RESULTS_JSON")"
if [[ "$WROTE_DATE" != "$TARGET_DATE" ]]; then
  log "エラー: 書き出した結果の日付が ${WROTE_DATE:-（空）} で、期待した $TARGET_DATE と違います。デプロイを中止します。"
  exit 1
fi
log "結果データを更新しました（$WROTE_DATE）。"

# 照合の要点をログに残す（あとで見返せるように）
if [[ -f "$HERE/output/review_${TARGET_DATE//-/}.md" ]]; then
  log "--- 照合の要点 ---"
  grep -E "^当日の1号艇1着|^枠なり進入" "$HERE/output/review_${TARGET_DATE//-/}.md" \
    | while read -r line; do log "  $line"; done
fi

if ! command -v vercel >/dev/null 2>&1; then
  log "エラー: vercel コマンドが見つかりません。"
  log "  データは更新済みなので 'cd apps/suminoe-log && vercel --prod' で反映できます。"
  exit 1
fi

log "Vercel にデプロイします..."
if ! (cd "$APP_DIR" && vercel --prod --yes >>"$LOG_FILE" 2>&1); then
  log "デプロイに失敗しました。ログを確認してください: $LOG_FILE"
  exit 1
fi

PUBLIC_URL="https://suminoe-log.vercel.app"
sleep 3
LIVE_DATE="$(curl -fsS "$PUBLIC_URL/results.json" 2>/dev/null \
  | grep -oE '"date":"[0-9]{4}-[0-9]{2}-[0-9]{2}"' | head -1 \
  | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}')"

if [[ "$LIVE_DATE" == "$TARGET_DATE" ]]; then
  log "完了: $PUBLIC_URL の買い目タブに $TARGET_DATE の結果が並びました。"
  exit 0
fi

log "警告: デプロイは成功しましたが、公開URLの結果の日付が '${LIVE_DATE:-取得できず}' です（反映待ちの可能性）。"
exit 0
