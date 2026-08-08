#!/usr/bin/env bash
#
# 直前情報（展示タイム・チルト・部品交換・スタート展示）を取得してアプリに反映し、デプロイする。
#
#   bash tenji-and-deploy.sh                     # 当日分
#   bash tenji-and-deploy.sh 2026-08-09          # 日付を指定
#   FORCE=1 bash tenji-and-deploy.sh             # 中身が同じでも書き出してデプロイする
#
# **冪等**: 前回と中身が同じならデプロイしない。30分おきに回す前提なので、
# ここを守らないと1日に20回ビルドが走る。
#
# 直前情報は各レースの周回展示後（締切の10〜15分前）に順次公開される。
# まだ公開されていないレースはエラーではなく「まだ」として扱い、
# 公開済みのレースが1つでも増えていればデプロイする。
#
# 終了コード:
#   0  デプロイした / 変化がなく何もしなかった（どちらも正常）
#   1  エラー
#   3  1レースも取得できなかった（公式サイトの不調・通信断。既存データは守った）

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$HERE/../../apps/suminoe-log" && pwd)"
TENJI_JSON="$APP_DIR/public/tenji.json"
LOG_DIR="$HERE/logs"
PYTHON="$HERE/venv/Scripts/python.exe"
PUBLIC_URL="https://suminoe-log.vercel.app"

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

PYTHONIOENCODING=utf-8 "$PYTHON" "$HERE/beforeinfo.py" "${ARGS[@]}" >>"$LOG_FILE" 2>&1
STATUS=$?

case "$STATUS" in
  0) ;;
  "$EXIT_UNCHANGED")
    log "前回と中身が同じでした。デプロイしません。"
    exit 0
    ;;
  "$EXIT_NO_DATA")
    log "1レースも取得できませんでした。既存データはそのままです。"
    log "  → 公式サイトの不調か通信断の可能性。次の実行で取り直します。"
    exit 3
    ;;
  *)
    log "取得に失敗しました（終了コード $STATUS）。ログを確認してください: $LOG_FILE"
    exit 1
    ;;
esac

WROTE_DATE="$(read_json_field "$TENJI_JSON" date)"
if [[ "$WROTE_DATE" != "$TARGET_DATE" ]]; then
  log "エラー: 書き出した日付が ${WROTE_DATE:-（空）} で、期待した $TARGET_DATE と違います。デプロイを中止します。"
  exit 1
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
LOCAL_UPDATED="$(read_json_field "$TENJI_JSON" updatedAt)"
sleep 3
LIVE_UPDATED="$(curl -fsS "$PUBLIC_URL/tenji.json" 2>/dev/null \
  | grep -oE '"updatedAt":"[^"]+"' | head -1 | sed -E 's/.*:"(.*)"/\1/')"

if [[ "$LIVE_UPDATED" == "$LOCAL_UPDATED" ]]; then
  log "完了: $PUBLIC_URL に ${AFTER_COUNT} レース分の直前情報が反映されました。"
  exit 0
fi

log "警告: デプロイは成功しましたが、公開URLの更新時刻が '${LIVE_UPDATED:-取得できず}' です（反映待ちの可能性）。"
exit 0
