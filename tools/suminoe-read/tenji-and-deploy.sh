#!/usr/bin/env bash
#
# 開催中の情報（直前情報とオッズ）を取得してアプリに反映し、デプロイする。
#
#   bash tenji-and-deploy.sh                     # 当日分
#   bash tenji-and-deploy.sh 2026-08-09          # 日付を指定
#   FORCE=1 bash tenji-and-deploy.sh             # 中身が同じでも書き出してデプロイする
#
# 取るもの:
#   直前情報（展示タイム・チルト・部品交換・スタート展示） beforeinfo.py
#   オッズ（3連単・3連複）                                 fetch-odds.ts
#
# **冪等**: どちらも変化がなければデプロイしない。30分おきに回す前提なので、
# ここを守らないと1日に20回ビルドが走る。オッズは締切に向けて動き続けるので、
# 発売中はたいてい変化ありになる（それが目的）。
#
# 直前情報は各レースの周回展示後（締切の10〜15分前）に順次公開される。
# まだ公開されていないレースはエラーではなく「まだ」として扱う。
#
# 終了コード:
#   0  デプロイした / 変化がなく何もしなかった（どちらも正常）
#   1  エラー
#   3  どちらも1レースも取得できなかった（公式サイトの不調・通信断。既存データは守った）

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$HERE/../../apps/suminoe-log" && pwd)"
TENJI_JSON="$APP_DIR/public/tenji.json"
ODDS_JSON="$APP_DIR/public/odds.json"
LOG_DIR="$HERE/logs"
PYTHON="$HERE/venv/Scripts/python.exe"
PUBLIC_URL="https://suminoe-log.vercel.app"
#: オッズ取得は MCP 側の実装を使う（公式ページのパーサをアプリと共有するため）
TSX="$HERE/../suminoe-mcp/node_modules/.bin/tsx"
ODDS_SCRIPT="$HERE/../suminoe-mcp/scripts/fetch-odds.ts"

# beforeinfo.py の終了コード（beforeinfo.py の docstring と対応）
EXIT_UNCHANGED=3
EXIT_NO_DATA=4

TARGET_DATE="${1:-$(date +%Y-%m-%d)}"

mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/tenji-$TARGET_DATE.log"

log() {
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

# JSON から文字列フィールドを抜く。
# Git Bash の POSIX パスは Windows の Python が開けないため grep で処理する。
read_json_field() {
  local file="$1" key="$2"
  [[ -f "$file" ]] || return 0
  grep -oE "\"$key\":\"[^\"]+\"" "$file" | head -1 | sed -E "s/.*:\"(.*)\"/\1/"
}

count_available() {
  local file="$1"
  [[ -f "$file" ]] || { echo 0; return 0; }
  grep -oE '"available":true' "$file" | wc -l | tr -d ' '
}

log "=== 対象日 $TARGET_DATE の直前情報を取得 ==="

if [[ ! -x "$PYTHON" ]]; then
  log "エラー: venv が見つかりません ($PYTHON)。"
  exit 1
fi

BEFORE_COUNT="$(count_available "$TENJI_JSON")"

ARGS=(--date "$TARGET_DATE")
if [[ "${FORCE:-}" == "1" ]]; then
  log "FORCE=1 のため、中身が同じでも書き出します。"
  ARGS+=(--force)
fi

log "直前情報を取得します..."
PYTHONIOENCODING=utf-8 "$PYTHON" "$HERE/beforeinfo.py" "${ARGS[@]}" >>"$LOG_FILE" 2>&1
TENJI_STATUS=$?

case "$TENJI_STATUS" in
  0) log "  直前情報: 更新あり" ;;
  "$EXIT_UNCHANGED") log "  直前情報: 変化なし" ;;
  "$EXIT_NO_DATA") log "  直前情報: 1レースも取得できず（既存データは維持）" ;;
  *)
    log "  直前情報: 失敗（終了コード $TENJI_STATUS）。ログを確認してください: $LOG_FILE"
    ;;
esac

# --- オッズ（3連単・3連複） ---
# 実装は MCP 側にある（公式ページのパーサを共有するため）。tsx で直接動かす。
log "オッズを取得します..."
if [[ -x "$TSX" ]]; then
  "$TSX" "$ODDS_SCRIPT" --date "$TARGET_DATE" >>"$LOG_FILE" 2>&1
  ODDS_STATUS=$?
  case "$ODDS_STATUS" in
    0) log "  オッズ: 更新あり" ;;
    "$EXIT_UNCHANGED") log "  オッズ: 変化なし" ;;
    "$EXIT_NO_DATA") log "  オッズ: 発売前（既存データは維持）" ;;
    *) log "  オッズ: 失敗（終了コード $ODDS_STATUS）" ;;
  esac
else
  log "  オッズ: tsx が見つからないため取得を飛ばしました（$TSX）"
  ODDS_STATUS=1
fi

# どちらかが更新されていればデプロイする
if [[ "$TENJI_STATUS" != "0" && "$ODDS_STATUS" != "0" ]]; then
  if [[ "$TENJI_STATUS" == "$EXIT_NO_DATA" && "$ODDS_STATUS" == "$EXIT_NO_DATA" ]]; then
    log "どちらも取得できませんでした。既存データはそのままです。"
    exit 3
  fi
  log "更新がありません。デプロイしません。"
  exit 0
fi

if [[ "$TENJI_STATUS" == "0" ]]; then
  WROTE_DATE="$(read_json_field "$TENJI_JSON" date)"
  if [[ "$WROTE_DATE" != "$TARGET_DATE" ]]; then
    log "エラー: 書き出した日付が ${WROTE_DATE:-（空）} で、期待した $TARGET_DATE と違います。デプロイを中止します。"
    exit 1
  fi
fi

AFTER_COUNT="$(count_available "$TENJI_JSON")"
log "公開済みレース: ${BEFORE_COUNT} → ${AFTER_COUNT} / 12"

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

# 反映確認は updatedAt で行う。同じ日に何度も更新されるので date では判別できない。
# 更新したファイルだけを見る（オッズだけ動いた回に直前情報を見ても変わっていない）。
CHECK_FILE="$TENJI_JSON"
CHECK_NAME="tenji.json"
if [[ "$TENJI_STATUS" != "0" ]]; then
  CHECK_FILE="$ODDS_JSON"
  CHECK_NAME="odds.json"
fi

LOCAL_UPDATED="$(read_json_field "$CHECK_FILE" updatedAt)"
sleep 3
LIVE_UPDATED="$(curl -fsS "$PUBLIC_URL/$CHECK_NAME" 2>/dev/null \
  | grep -oE '"updatedAt":"[^"]+"' | head -1 | sed -E 's/.*:"(.*)"/\1/')"

if [[ "$LIVE_UPDATED" == "$LOCAL_UPDATED" ]]; then
  log "完了: $PUBLIC_URL に反映されました（$CHECK_NAME / 公開済み ${AFTER_COUNT} レース）。"
  exit 0
fi

log "警告: デプロイは成功しましたが、公開URLの $CHECK_NAME の更新時刻が '${LIVE_UPDATED:-取得できず}' です（反映待ちの可能性）。"
exit 0
