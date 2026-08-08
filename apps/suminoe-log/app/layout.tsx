import type { Metadata, Viewport } from 'next';

import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';

import './globals.css';

export const metadata: Metadata = {
  title: 'スミノエ・ログ',
  description: '住之江の観戦記録アプリ。タップだけで1レース分の記録が終わります。',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'スミノエ・ログ',
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  themeColor: '#061A1F',
  width: 'device-width',
  initialScale: 1,
  // 誤操作でズームすると片手操作しづらくなるため、拡大は許可しつつ初期倍率を固定する
  maximumScale: 5,
};

/**
 * 保存したテーマを描画前に当てる。
 * これがないと light で一度描いてから dark に切り替わり、画面がちらつく。
 */
const THEME_INIT = `try{var t=localStorage.getItem('suminoe-theme');if(t==='dark'){document.documentElement.dataset.theme='dark'}}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className="h-full">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="flex min-h-full flex-col">
        {/* 水面シーン（WaveScene）は page.tsx が描く。帯の位置が
            「保存バーの有無」で変わり、それはタブを知る側にしか判定できない */}
        <div className="relative z-10 flex min-h-full flex-1 flex-col">{children}</div>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
