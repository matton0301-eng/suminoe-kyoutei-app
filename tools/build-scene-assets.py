"""画面下部の水面シーン用の画像素材を、配布用に下処理する。

入力  scene_assets/scene/{light,dark}/*.png   （生成 AI から受け取った原本）
出力  apps/suminoe-log/public/scene/          （アプリが読む WebP）

**一度だけ走らせる道具で、アプリのビルドには含めない。**
`npm run build` を依存パッケージなしに保つため、出力は成果物として置いておく。

やっていること:

1. **艇の船体から「桐生」を消す。** 受け取った素材は桐生競艇場の艇だった。
   住之江のアプリなので場名は不適切。文字は白いデカールの上にあるので、
   行ごとに左右の清浄な画素から線形補間して埋める（滑らかな面なので跡が出ない）。
2. **透明な余白を切り落とす。** 余白があると配置の基準が原本のキャンバスに
   縛られ、CSS 側で位置を合わせづらい。
3. **水面をシームレスなタイルにする。** 原本は左右端の平均差が 15〜18 あり、
   横スクロールでループさせると継ぎ目が見える。末尾 K 列を先頭 K 列に
   ランプで重ねて巻き込むと、最終列と先頭列が原本の隣接列同士になり連続する。
   ミラー合成と違って左右対称の不自然さが出ない。
4. WebP 化。合計 500KB 以内に収める（Service Worker が precache するため）。

実行: python tools/build-scene-assets.py
"""

from __future__ import annotations

import sys
import warnings
from pathlib import Path

import numpy as np
from PIL import Image

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "scene_assets" / "scene"
DST = ROOT / "apps" / "suminoe-log" / "public" / "scene"

# 船体の場名「桐生」の範囲。原本 600x340 での座標。
# 右の「1」は艇番なので残す（x=278 から始まるので含めない）。
NAME_RECT = (203, 186, 259, 227)
# 文字と判定する明度のしきい値。船体側面は白（明度 200 超）、文字は黒。
NAME_LUMA_MAX = 175
# 文字の下を走る黒いストライプの上端。原本で (190, 211) と (290, 240) を通る。
# **しきい値だけでは文字と区別できない。** 「生」の下端はこのストライプに
# 1〜2 画素で接しているため、連結成分で分けようとすると「生」ごと落ちる。
# 直線で境界を引いて除外する。
STRIPE_ORIGIN = (190, 211)
STRIPE_SLOPE = 0.29
# 水面タイルの巻き込み幅。広いほど継ぎ目が緩やかになるが、絵柄が薄まる。
WRAP_COLS = 120
# 合計サイズの上限（precache に載る量）
TOTAL_BUDGET_BYTES = 500 * 1024


def erase_hull_name(im: Image.Image) -> Image.Image:
    """船体の場名を拡散インペイントで消す。

    行ごとの線形補間では、周囲の階調に追従せず矩形のパッチ跡が残った。
    マスク画素を「マスク外の隣接画素の平均」で繰り返し置き換えると、
    周囲の勾配に沿って埋まるので継ぎ目が出ない。
    """
    a = np.array(im.convert("RGBA"), dtype=np.float64)
    x0, y0, x1, y1 = NAME_RECT
    rgb, alpha = a[:, :, :3], a[:, :, 3]
    luma = rgb.mean(axis=2)

    xs = np.arange(x0, x1)[None, :]
    ys = np.arange(y0, y1)[:, None]
    above_stripe = ys < STRIPE_ORIGIN[1] + STRIPE_SLOPE * (xs - STRIPE_ORIGIN[0]) - 1
    glyphs = (
        (alpha[y0:y1, x0:x1] > 200)
        & (luma[y0:y1, x0:x1] < NAME_LUMA_MAX)
        & above_stripe
    )
    if not glyphs.any():
        raise SystemExit("船体の文字が見つからない。NAME_RECT を確認する")

    mask = np.zeros(luma.shape, dtype=bool)
    mask[y0:y1, x0:x1] = glyphs
    # にじみを拾うため 2 画素ふくらませる
    for _ in range(2):
        mask |= (
            np.roll(mask, 1, axis=0)
            | np.roll(mask, -1, axis=0)
            | np.roll(mask, 1, axis=1)
            | np.roll(mask, -1, axis=1)
        )
    # ふくらませた分がストライプや箱の外に届かないよう戻す
    gy, gx = np.indices(luma.shape)
    mask &= (
        (gy >= y0 - 2)
        & (gy < y1 + 2)
        & (gx >= x0 - 2)
        & (gx < x1 + 2)
        & (gy < STRIPE_ORIGIN[1] + STRIPE_SLOPE * (gx - STRIPE_ORIGIN[0]) - 1)
    )

    filled = rgb.copy()
    filled[mask] = np.nan
    for _ in range(120):
        pad = np.pad(filled, ((1, 1), (1, 1), (0, 0)), constant_values=np.nan)
        neighbours = np.stack(
            [
                pad[:-2, 1:-1],
                pad[2:, 1:-1],
                pad[1:-1, :-2],
                pad[1:-1, 2:],
                pad[:-2, :-2],
                pad[:-2, 2:],
                pad[2:, :-2],
                pad[2:, 2:],
            ]
        )
        with warnings.catch_warnings():
            # 全近傍がマスク内の画素は今回埋まらない。次の反復で外側から届く
            warnings.simplefilter("ignore", RuntimeWarning)
            avg = np.nanmean(neighbours, axis=0)
        target = mask & np.isfinite(avg).all(axis=2)
        filled[target] = avg[target]
        if not np.isnan(filled).any():
            break
    if np.isnan(filled).any():
        raise SystemExit("インペイントが収束しなかった")

    a[:, :, :3] = filled
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGBA")


def trim_alpha(im: Image.Image) -> Image.Image:
    """透明な余白を切り落とす。"""
    box = im.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    if box is None:
        raise SystemExit("不透明な画素が無い")
    return im.crop(box)


def crop_flat_margins(im: Image.Image) -> Image.Image:
    """上下にある単色（白）の帯を切り落とす。"""
    a = np.asarray(im.convert("RGB"), dtype=np.int16)
    flat = (a.min(axis=(1, 2)) > 240) & (a.std(axis=(1, 2)) < 6)
    rows = np.where(~flat)[0]
    if len(rows) == 0:
        return im
    return im.crop((0, int(rows.min()), im.width, int(rows.max()) + 1))


def make_seamless_x(im: Image.Image, cols: int = WRAP_COLS) -> Image.Image:
    """末尾の列を先頭に巻き込んで、横方向に継ぎ目のないタイルにする。

    結果の幅は `width - cols`。最終列が原本の col(width-cols-1)、
    先頭列が原本の col(width-cols) になるため、ループしても隣接列同士で繋がる。
    """
    a = np.asarray(im.convert("RGB"), dtype=np.float64)
    h, w, _ = a.shape
    if cols * 2 >= w:
        raise SystemExit("巻き込み幅が広すぎる")
    base = a[:, : w - cols, :].copy()
    tail = a[:, w - cols :, :]
    ramp = np.linspace(0.0, 1.0, cols)[None, :, None]
    base[:, :cols, :] = tail * (1.0 - ramp) + base[:, :cols, :] * ramp
    return Image.fromarray(base.astype(np.uint8), "RGB")


def seam_error(im: Image.Image) -> float:
    """先頭列と最終列の平均差。ループしたときに継ぎ目として見える量。"""
    a = np.asarray(im.convert("RGB"), dtype=np.float64)
    return float(np.abs(a[:, 0, :] - a[:, -1, :]).mean())


def column_step(im: Image.Image) -> float:
    """隣り合う列どうしの平均差。この絵柄が本来持っている変動量。

    巻き込み後の先頭列と最終列は原本の隣接列同士になるので、継ぎ目の差は
    最良でもこの値になる。固定のしきい値と比べても意味がないため、
    継ぎ目が「テクスチャ本来の変動と同程度か」で判定する。
    """
    a = np.asarray(im.convert("RGB"), dtype=np.float64)
    return float(np.abs(np.diff(a, axis=1)).mean())


def save_webp(im: Image.Image, path: Path, quality: int) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "WEBP", quality=quality, method=6)
    return path.stat().st_size


def main() -> None:
    written: list[tuple[str, str, int]] = []

    # --- 艇。light と dark で同一ファイルなので 1 本に統合する ---
    lo = Image.open(SRC / "light" / "boat.png").convert("RGBA")
    hi = Image.open(SRC / "dark" / "boat.png").convert("RGBA")
    if not np.array_equal(np.array(lo), np.array(hi)):
        # 黙って light を使うと、用意した夜用の絵が反映されないことに気づけない
        raise SystemExit(
            "light/dark の boat.png が異なる。共用をやめてテーマごとに書き出し、\n"
            "globals.css の --scene-boat-filter を外して素材差し替えに切り替える必要がある"
        )
    note = "light/dark 同一のため共用"
    boat = trim_alpha(erase_hull_name(lo))
    size = save_webp(boat, DST / "boat.webp", 84)
    written.append(("scene/boat.webp", f"{boat.width}x{boat.height} {note}", size))

    for theme in ("light", "dark"):
        for name in ("spray-back", "spray-front"):
            im = trim_alpha(Image.open(SRC / theme / f"{name}.png").convert("RGBA"))
            size = save_webp(im, DST / theme / f"{name}.webp", 80)
            written.append((f"scene/{theme}/{name}.webp", f"{im.width}x{im.height}", size))

        raw = Image.open(SRC / theme / "water.png")
        cropped = crop_flat_margins(raw)
        tile = make_seamless_x(cropped)
        before, after = seam_error(cropped), seam_error(tile)
        natural = column_step(tile)
        size = save_webp(tile, DST / theme / "water.webp", 82)
        written.append(
            (
                f"scene/{theme}/water.webp",
                f"{tile.width}x{tile.height} 継ぎ目差 {before:.1f}→{after:.2f}"
                f"（列間変動 {natural:.2f}）",
                size,
            )
        )
        # 継ぎ目が列間変動の 2 倍を超えるなら、巻き込みが効いていない
        if after > natural * 2:
            raise SystemExit(
                f"{theme}/water: 継ぎ目が残っている（差 {after:.2f} / 列間変動 {natural:.2f}）"
            )

    total = sum(s for _, _, s in written)
    width = max(len(p) for p, _, _ in written)
    for path, note, size in written:
        print(f"{path:<{width}}  {size / 1024:6.1f}KB  {note}")
    print(f"{'合計':<{width}}  {total / 1024:6.1f}KB  / 予算 {TOTAL_BUDGET_BYTES / 1024:.0f}KB")
    if total > TOTAL_BUDGET_BYTES:
        raise SystemExit("予算超過。quality を下げるか寸法を縮める")


if __name__ == "__main__":
    main()
