/**
 * ヘッダーに同化させた水面のシーン。写実的なイラスト素材を層に重ねて動かす。
 *
 * ベクター図形をアニメーションさせるのではなく、**一枚絵そのものが生きて動いて
 * 見えること**を狙っている。艇を大きく移動させず、上下動・旋回方向へのわずかな
 * 傾き・しぶきの発生と後退・水面の流れを重ねる。
 *
 * ## なぜヘッダーなのか
 *
 * 最初は画面下部に置いた。しかしそこは**親指の操作領域**で、記録タブが一番使う
 * 場所でもある。130px の帯を置くとコンテンツを横に断ち切り、操作面積も奪った。
 * ヘッダーは操作領域から最も遠く、アプリの identity を置くべき場所なので、
 * 装飾はここに寄せる。左にタイトルと日付、右に艇という構図になる。
 *
 * ## 「画像を貼っただけ」に見せないための処置
 *
 * 1. **上端を溶かす**（各水面層の top マスク）。硬い線が出ると板を貼ったように見える
 * 2. **左端を溶かす**（`.scene` 自体のマスク）。全幅の写真帯に見えるのを防ぐ。
 *    艇としぶきは右 60% にあるので、左のフェードは絵の主題に当たらない
 * 3. **背景の色域へ寄せる**（`opacity` と `saturate`）。彩度の高い水色のままだと
 *    淡い背景から浮く。艇だけは主題なので彩度を落とさない
 * 4. **艇を水に沈める**（接地影と手前の水面の重なり）。載せただけだと切り抜きに見える
 * 5. 下端はヘッダーの `border-b` が境界になる。これは UI の線なので違和感が出ない
 *
 * ## 素材
 *
 * `public/scene/`。原本は `scene_assets/` にあり、`tools/build-scene-assets.py`
 * が透過の切り出し・水面のシームレス化・WebP 化をして配置する。**手で置き換えない。**
 *
 * ## 幾何
 *
 * **すべて globals.css にある。** この階層は「どの層をどの順で重ねるか」だけを持つ。
 * 重ねる順（奥→手前）: 奥の水面 → しぶき2枚 → 接地影 → 艇 → 手前の水面 → 近景の飛沫。
 *
 * 装飾なので `aria-hidden` と `pointer-events: none`。
 * ライト／ダークは CSS 変数で素材を差し替える（使う側だけ取得される）。
 * `prefers-reduced-motion` では動きを止める。
 */
export function WaveScene() {
  return (
    <div className="scene" aria-hidden>
      <div className="scene-water scene-water-far" />
      <div className="scene-spray scene-spray-back-b" />
      <div className="scene-spray scene-spray-back-a" />
      <div className="scene-shadow" />
      <div className="scene-boat" />
      <div className="scene-water scene-water-near" />
      <div className="scene-spray scene-spray-front" />
    </div>
  );
}
