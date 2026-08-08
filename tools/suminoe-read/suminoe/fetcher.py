"""番組表・競走成績データの取得。

URL 規則（docs/03-bangumihyou-format.md §1 で実測・検証済み）:
    番組表:   https://www1.mbrace.or.jp/od2/B/{YYYYMM}/b{YY}{MM}{DD}.lzh
    競走成績: https://www1.mbrace.or.jp/od2/K/{YYYYMM}/k{YY}{MM}{DD}.lzh

**公開タイミングの注意（§2 実測）**:
  番組表   当日早朝5時台。翌日分は前夜には存在せず 404 になる（異常ではない）
  競走成績 全レース終了後（8/6 は 20:53 JST に確定）。レース前は中身が空のまま存在する
"""

from __future__ import annotations

import re
import time
from datetime import date
from pathlib import Path

import requests

BASE_ROOT = "https://www1.mbrace.or.jp/od2"

#: 取得できるデータの種類。B=番組表（出走表）、K=競走成績（結果）
KIND_PROGRAM = "B"
KIND_RESULT = "K"

#: 中身が空のプレースホルダを弾くための下限バイト数。
#: レース前の成績ファイルは 300 バイト程度で存在する（8/7 で実測）。
MIN_CONTENT_BYTES = 2000

USER_AGENT = "suminoe-read/1.0 (personal race-program analysis; individual use)"

#: サーバ負荷への配慮。連続リクエスト時の最小間隔（秒）
MIN_INTERVAL_SEC = 1.5

REQUEST_TIMEOUT = 30
MAX_RETRIES = 2


class FetchError(Exception):
    """取得に失敗した。原因に応じた対処をメッセージに含める。"""


def lzh_filename(target: date, kind: str = KIND_PROGRAM) -> str:
    return f"{kind.lower()}{target:%y%m%d}.lzh"


def lzh_url(target: date, kind: str = KIND_PROGRAM) -> str:
    return f"{BASE_ROOT}/{kind}/{target:%Y%m}/{lzh_filename(target, kind)}"


def index_url(kind: str = KIND_PROGRAM) -> str:
    return f"{BASE_ROOT}/{kind}/dmenu.html"


def _session() -> requests.Session:
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    return session


def _get(session: requests.Session, url: str) -> requests.Response:
    """指数バックオフ付きの GET。404 はリトライせず即返す。"""
    last_error: Exception | None = None
    for attempt in range(MAX_RETRIES + 1):
        if attempt:
            time.sleep(MIN_INTERVAL_SEC * (2**attempt))
        try:
            response = session.get(url, timeout=REQUEST_TIMEOUT)
        except requests.RequestException as exc:
            last_error = exc
            continue
        if response.status_code == 404:
            return response
        if response.ok:
            return response
        last_error = FetchError(f"HTTP {response.status_code}")
    raise FetchError(f"{url} の取得に失敗しました: {last_error}")


def _resolve_from_index(
    session: requests.Session, target: date, kind: str = KIND_PROGRAM
) -> str | None:
    """命名規則が外れた場合に、インデックスページからリンクを探す。"""
    response = _get(session, index_url(kind))
    if not response.ok:
        return None
    html = response.content.decode("cp932", errors="replace")
    stem = f"{kind.lower()}{target:%y%m%d}"
    for match in re.finditer(r"['\"]?([\w./]*%s\.lzh)" % re.escape(stem), html, re.IGNORECASE):
        path = match.group(1)
        if path.startswith("http"):
            return path
        return f"{BASE_ROOT}/{kind}/{target:%Y%m}/{Path(path).name}"
    return None


def not_published_message(target: date, kind: str = KIND_PROGRAM) -> str:
    if kind == KIND_RESULT:
        return (
            f"{target:%Y-%m-%d} の競走成績はまだ確定していません。\n"
            "  成績は全レースが終わってから確定します（住之江のナイターは21時頃）。\n"
            "  時間をおいて再実行してください。"
        )
    return (
        f"{target:%Y-%m-%d} 分の番組表はまだ公開されていない可能性があります。\n"
        "  公式の配布は当日早朝（5〜6時頃）です。時間をおいて再実行してください。\n"
        "  すでに公開されているはずの日付でこのメッセージが出る場合は、\n"
        "  https://www1.mbrace.or.jp/od2/B/dindex.html を直接確認してください。"
    )


def fetch_lzh(
    target: date,
    cache_dir: Path,
    use_cache: bool = True,
    kind: str = KIND_PROGRAM,
    log=print,
) -> Path:
    """番組表または競走成績の LZH を取得し、キャッシュ上のパスを返す。

    同じデータを何度も取りに行かないよう、既にキャッシュがあれば再利用する。

    成績ファイルはレース前でも中身が空のまま存在するため、
    サイズが {MIN_CONTENT_BYTES} バイト未満なら「まだ確定していない」として扱う。

    Raises:
        FetchError: 未公開（404）、中身が空、または通信失敗。
    """
    cache_dir.mkdir(parents=True, exist_ok=True)
    cached = cache_dir / lzh_filename(target, kind)

    if use_cache and cached.is_file() and cached.stat().st_size >= MIN_CONTENT_BYTES:
        log(f"  キャッシュを使用: {cached.name} ({cached.stat().st_size:,} バイト)")
        return cached

    session = _session()
    url = lzh_url(target, kind)
    log(f"  取得: {url}")
    response = _get(session, url)

    if response.status_code == 404:
        log("  404。インデックスページからリンクを解決を試行")
        resolved = _resolve_from_index(session, target, kind)
        if not resolved or resolved == url:
            raise FetchError(not_published_message(target, kind))
        log(f"  取得（解決後）: {resolved}")
        response = _get(session, resolved)
        if response.status_code == 404:
            raise FetchError(not_published_message(target, kind))

    if not response.content:
        raise FetchError(f"{url} から空のレスポンスが返りました")

    # レース前の成績ファイルはヘッダだけの数百バイトで存在する
    if len(response.content) < MIN_CONTENT_BYTES:
        raise FetchError(
            f"{url} は {len(response.content)} バイトしかなく、中身が空です。\n"
            + not_published_message(target, kind)
        )

    cached.write_bytes(response.content)
    log(f"  取得成功: {cached.name} ({len(response.content):,} バイト)")
    return cached


def read_text(path: Path, log=print) -> str:
    """番組表 TXT を cp932 で読む。失敗文字は置換し、該当箇所を警告に出す。"""
    raw = path.read_bytes()
    try:
        return raw.decode("cp932")
    except UnicodeDecodeError as exc:
        log(f"  警告: cp932 でデコードできない箇所があります（位置 {exc.start}）。置換して継続します")
        text = raw.decode("cp932", errors="replace")
        for i, line in enumerate(text.splitlines(), start=1):
            if "�" in line:
                log(f"    行 {i}: {line[:60]}")
        return text
