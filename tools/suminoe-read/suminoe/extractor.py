"""LZH アーカイブの解凍。

解凍手段は docs/03-bangumihyou-format.md §3 の実測結果に基づく優先順:

1. Windows 11 標準の bsdtar (`C:\\Windows\\System32\\tar.exe`) — 実機で成功を確認済み
2. 7-Zip CLI (`7z.exe`)
3. Python `lhafile` パッケージ
4. 全滅 → 明確なエラーで手動解凍の導線を案内（例外を握りつぶさない）

Git Bash の GNU tar は LZH 非対応。**必ずフルパスで System32 の tar.exe を呼ぶ。**
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

#: bsdtar のフルパス候補。PATH 上の `tar` は GNU tar の可能性があるため使わない。
BSDTAR_CANDIDATES = (
    Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "tar.exe",
)

SEVENZIP_CANDIDATES = (
    Path(r"C:\Program Files\7-Zip\7z.exe"),
    Path(r"C:\Program Files (x86)\7-Zip\7z.exe"),
)

MANUAL_HELP = """
LZH ファイルを解凍できませんでした。次のいずれかで解決できます。

  A) 7-Zip をインストールする（https://7-zip.opensource.jp/）
  B) Python パッケージを入れる:  pip install lhafile
  C) 手動で解凍して txt を直接渡す:
       1. {lzh} をエクスプローラで解凍（7-Zip / Lhaplus など）
       2. python main.py --local-file <解凍したTXTのパス> --date <YYYY-MM-DD>
""".strip()


class ExtractError(Exception):
    """解凍に失敗した。手動解凍の導線を案内するためのメッセージを持つ。"""


def _find_executable(candidates: tuple[Path, ...], path_name: str | None = None) -> Path | None:
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    if path_name:
        found = shutil.which(path_name)
        if found:
            return Path(found)
    return None


def _run(cmd: list[str], cwd: Path) -> tuple[bool, str]:
    try:
        proc = subprocess.run(
            cmd, cwd=str(cwd), capture_output=True, text=True, timeout=60, check=False
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, f"{cmd[0]} の実行に失敗: {exc}"
    if proc.returncode != 0:
        return False, f"{cmd[0]} が終了コード {proc.returncode}: {proc.stderr.strip()[:300]}"
    return True, ""


def _extracted_txt(dest_dir: Path, lzh_path: Path) -> Path | None:
    """解凍先から、いま解凍した書庫に対応する TXT を選ぶ。

    **ディレクトリ内の TXT を漁って推測してはいけない。**
    番組表(B)と成績(K)は同じ `cache/` に溜まるため、「B で始まるものを優先」の
    ような選び方をすると、成績を解凍したのに番組表を返してしまう。

    2026-08-07 に実際に踏んだ。`k260807.lzh` を解凍したのに `B260807.TXT` が返り、
    成績パーサが番組表を読んで「場コード 12 の区画がありません（開催なしの可能性）」
    という無関係なエラーになった。実際には区画は存在していた。

    書庫名から対応する TXT 名を導く（`k260807.lzh` → `K260807.TXT`）。
    """
    expected = (lzh_path.stem + ".TXT").upper()
    for path in sorted(dest_dir.iterdir()):
        if path.is_file() and path.name.upper() == expected:
            return path
    return None


def extract_lzh(lzh_path: Path, dest_dir: Path, log=print) -> Path:
    """LZH を dest_dir へ解凍し、取り出した TXT のパスを返す。

    Raises:
        ExtractError: すべての解凍手段が失敗した場合。
    """
    dest_dir.mkdir(parents=True, exist_ok=True)
    attempts: list[str] = []

    bsdtar = _find_executable(BSDTAR_CANDIDATES)
    if bsdtar:
        log(f"  解凍: bsdtar ({bsdtar}) を試行")
        ok, err = _run([str(bsdtar), "-xf", str(lzh_path.resolve())], cwd=dest_dir)
        if ok and (txt := _extracted_txt(dest_dir, lzh_path)):
            log(f"  解凍成功: {txt.name}")
            return txt
        attempts.append(err or f"bsdtar は成功したが {lzh_path.stem.upper()}.TXT が見つからない")
    else:
        attempts.append("bsdtar (System32\\tar.exe) が見つからない")

    sevenzip = _find_executable(SEVENZIP_CANDIDATES, "7z")
    if sevenzip:
        log(f"  解凍: 7-Zip ({sevenzip}) を試行")
        ok, err = _run(
            [str(sevenzip), "x", "-y", f"-o{dest_dir}", str(lzh_path.resolve())], cwd=dest_dir
        )
        if ok and (txt := _extracted_txt(dest_dir, lzh_path)):
            log(f"  解凍成功: {txt.name}")
            return txt
        attempts.append(err or f"7-Zip は成功したが {lzh_path.stem.upper()}.TXT が見つからない")
    else:
        attempts.append("7-Zip が見つからない")

    try:
        import lhafile  # type: ignore[import-not-found]

        log("  解凍: lhafile を試行")
        archive = lhafile.Lhafile(str(lzh_path))
        for info in archive.infolist():
            out = dest_dir / Path(info.filename).name
            out.write_bytes(archive.read(info.filename))
        if txt := _extracted_txt(dest_dir, lzh_path):
            log(f"  解凍成功: {txt.name}")
            return txt
        attempts.append(f"lhafile は成功したが {lzh_path.stem.upper()}.TXT が見つからない")
    except ImportError:
        attempts.append("lhafile が未インストール")
    except Exception as exc:  # noqa: BLE001 - 解凍ライブラリの例外種別は不定
        attempts.append(f"lhafile が失敗: {exc}")

    detail = "\n".join(f"  - {a}" for a in attempts)
    raise ExtractError(
        f"すべての解凍手段が失敗しました。\n{detail}\n\n" + MANUAL_HELP.format(lzh=lzh_path)
    )
