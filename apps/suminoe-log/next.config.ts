import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /**
   * 静的エクスポート。サーバー機能を一切使わないため、
   * Service Worker で全アセットをプリキャッシュすればオフラインで完全に動作する。
   */
  output: 'export',

  /** 静的エクスポートでは next/image の最適化が使えない（画像は未使用） */
  images: { unoptimized: true },

  /** /path/ 形式で出力し、SW のキャッシュキーと実リクエストを一致させる */
  trailingSlash: true,
};

export default nextConfig;
