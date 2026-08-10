import type { NextConfig } from 'next';

/**
 * **2026-08-10 に静的エクスポートをやめた。**
 *
 * それまでは `output: 'export'` で完全な静的サイトにし、
 * Service Worker で全アセットをプリキャッシュしてオフライン動作を保証していた。
 *
 * その要件を外した理由:
 *   - オフラインを守る仕組みが、いちばんの故障源だった
 *     （8/9 に端末が4時間前のオッズを返し続け、切り分けに3時間かかった）
 *   - **公式サイトは CORS を許可していない。** ブラウザから直接オッズを取れないので、
 *     「見た瞬間の値」を出すにはサーバー側の処理が要る
 *
 * いまはサーバー機能を持つ通常の Next.js アプリ。
 * Service Worker は `public/sw.js` に手書きで置いてある（プリキャッシュしないので生成不要）。
 */
const nextConfig: NextConfig = {
  /** 画像は未使用。最適化の経路を持たないほうが構成が単純になる */
  images: { unoptimized: true },
};

export default nextConfig;
