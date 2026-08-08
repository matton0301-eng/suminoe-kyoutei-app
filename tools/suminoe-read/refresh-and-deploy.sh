#!/usr/bin/env bash
#
# 番組表を取得してアプリに反映し、Vercel へデプロイする。
#
#   bash refresh-and-deploy.sh                     # 当日分
#   bash refresh-and-deploy.sh 2026-08-09          # 日付を指定
#   FORCE=1 bash refresh-and-deploy.sh 2026-08-09  # 同じ日付でも取り直す
#
# **冪等**: すでに同じ日付のデータがアプリに入っていれば何もせず終了する。
# そのため、朝5時から数時間おきに何度呼んでも無害。
# 番組表が未公開（404）なら、更新もデプロイもせずに終了コード 3 を返す。
#
# 番組表の公開は当日早朝5〜6時頃（docs/03-bangumihyou-format.md §2 で実測）。
# 前日以前に翌日分を取ろうとしても 404 になるのは正常。
# 当日の昼に選手変更などで再更新されることがあるため、
# 取り直したいときは FORCE=1 を付ける（キャッシュを捨てて再取得する）。

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$HERE/../../apps/suminoe-log" && pwd)"
CARD_JSON="$APP_DIR/public/racecard.json"
LOG_DIR="$HERE/logs"
PYTHON="$HERE/venv/Scripts/python.exe"

TARGET_DATE="${1:-$(date +%Y-%m-%d)}"

mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/refresh-$TARGET_DATE.log"

log() {
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

# JSON から date を読む。
# Python に渡すと Git Bash の POSIX パス (/c/...) を Windows の Python が開けないため、
# grep で抜き出す（JSON は1行で出力されている）。
read_card_date() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  grep -oE '"date":"[0-9]{4}-[0-9]{2}-[0-9]{2}"' "$file" \
    | head -1 \
    | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}'
}

log "=== 対象日 $TARGET_DATE の更新を開始 ==="

if [[ ! -x "$PYTHON" ]]; then
  log "エラー: venv が見つかりません ($PYTHON)。先に python -m venv venv を実行してください。"
  exit 1
fi

# --- すでに反映済みなら何もしない（冪等） ---
if [[ -f "$CARD_JSON" && "${FORCE:-}" != "1" ]]; then
  CURRENT_DATE="$(read_card_date "$CARD_JSON")"
  if [[ "$CURRENT_DATE" == "$TARGET_DATE" ]]; then
    log "すでに $TARGET_DATE のデータが入っています。何もしません。"
    exit 0
  fi
  log "現在アプリに入っているのは ${CURRENT_DATE:-（未設定）} 分。$TARGET_DATE 分に更新します。"
fi

# --- 番組表の取得と分析 ---
FETCH_ARGS=(--date "$TARGET_DATE")
if [[ "${FORCE:-}" == "1" ]]; then
  log "FORCE=1 のためキャッシュを捨てて再取得します。"
  FETCH_ARGS+=(--no-cache)
fi

log "番組表を取得して分析します..."
if ! PYTHONIOENCODING=utf-8 "$PYTHON" "$HERE/main.py" "${FETCH_ARGS[@]}" >>"$LOG_FILE" 2>&1; then
  log "取得できませんでした（未公開の可能性）。デプロイは行いません。"
  log "  → 番組表の公開は当日5〜6時頃です。時間をおいて再実行してください。"
  exit 3
fi

# --- 書き出しを検証 ---
WROTE_DATE="$(read_card_date "$CARD_JSON")"
if [[ "$WROTE_DATE" != "$TARGET_DATE" ]]; then
  log "エラー: アプリ用データの日付が $WROTE_DATE で、期待した $TARGET_DATE と違います。デプロイを中止します。"
  exit 1
fi
log "アプリ用データを更新しました（$WROTE_DATE）。"

# --- デプロイ ---
if ! command -v vercel >/dev/null 2>&1; then
  log "エラー: vercel コマンドが見つかりません。npm i -g vercel を実行してください。"
  log "  データは更新済みなので、手動で 'cd apps/suminoe-log && vercel --prod' を実行すれば反映されます。"
  exit 1
fi

log "Vercel にデプロイします..."
if ! (cd "$APP_DIR" && vercel --prod --yes >>"$LOG_FILE" 2>&1); then
  log "デプロイに失敗しました。ログを確認してください: $LOG_FILE"
  exit 1
fi

# --- 公開URLで反映を確認 ---
PUBLIC_URL="https://suminoe-log.vercel.app"
sleep 3
LIVE_DATE="$(curl -fsS "$PUBLIC_URL/racecard.json" 2>/dev/null   | grep -oE '"date":"[0-9]{4}-[0-9]{2}-[0-9]{2}"' | head -1   | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}')"

if [[ "$LIVE_DATE" == "$TARGET_DATE" ]]; then
  log "完了: $PUBLIC_URL に $TARGET_DATE 分が反映されました。"
  exit 0
fi

log "警告: デプロイは成功しましたが、公開URLの日付が '$LIVE_DATE' です（反映待ちの可能性）。"
log "  数分後に $PUBLIC_URL を開いて確認してください。"
exit 0
