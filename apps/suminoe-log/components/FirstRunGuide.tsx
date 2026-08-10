'use client';

/**
 * はじめて開いた人への案内。
 *
 * **このアプリは当てるための道具ではない**ということを、最初に書く。
 * 期待値や的中率が並ぶ画面なので、それを伝えずに使わせるのは不誠実になる。
 *
 * 一度閉じたら出さない（localStorage に残す）。
 * 「開催予定」タブからいつでも開き直せるようにしてある。
 */

import { BET_TYPE_GUIDE } from '@/lib/glossary';

const SEEN_KEY = 'suminoe-guide-seen';

export function markGuideSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* 使えない環境でも動作は続ける */
  }
}

export function hasSeenGuide(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true; // 読めないなら出さない（毎回出るほうが困る）
  }
}

interface FirstRunGuideProps {
  onClose: () => void;
}

export function FirstRunGuide({ onClose }: FirstRunGuideProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="はじめての方へ"
      className="fixed inset-0 z-40 overflow-y-auto bg-bg-deep"
    >
      <div className="mx-auto w-full max-w-lg px-3 py-4">
        <h1 className="paper-heading text-base">はじめての方へ</h1>

        <section className="rule-top mt-3 pt-2">
          <h2 className="text-sm font-black text-text-main">これは何のアプリか</h2>
          <p className="mt-1 text-sm leading-relaxed text-text-main">
            ボートレース住之江を<strong>根拠を持って見るための道具</strong>です。
            出走表・オッズ・直前情報を集めて、買い方の型と、その型が過去にどうだったかを出します。
          </p>
          <p className="mt-2 border-l-2 border-accent pl-2 text-sm leading-relaxed text-text-main">
            <strong className="text-accent">当てるための道具ではありません。</strong>
            過去743レースで、このアプリの買い方をそのまま試したときの回収率は
            <strong> 75%</strong> でした。1万円ぶん買って7,500円戻る計算です。
          </p>
        </section>

        <section className="rule-top mt-4 pt-2">
          <h2 className="text-sm font-black text-text-main">なぜ平均すると減るのか</h2>
          <p className="mt-1 text-sm leading-relaxed text-text-main">
            賭けられたお金のうち<strong>25%は主催者の取り分</strong>で、
            残りの75%が的中した人に配られます（控除率といいます）。
            <strong>誰が予想しても、全員の合計では75%しか戻りません。</strong>
            長く買えば平均して減る、という前提で遊ぶものです。
          </p>
          <p className="mt-2 text-sm leading-relaxed text-text-mute">
            このアプリが「回収率170%」のような数字を出すことがありますが、
            <strong className="text-text-main">それは予想が当たる前提の見立て</strong>
            で、儲かる保証ではありません。
          </p>
        </section>

        <section className="rule-top mt-4 pt-2">
          <h2 className="text-sm font-black text-text-main">舟券は7種類。100円から買えます</h2>
          <p className="mt-1 text-[11px] text-text-mute">当てやすい順</p>
          <ul className="mt-1.5 border border-line bg-bg-panel">
            {BET_TYPE_GUIDE.map((entry) => (
              <li
                key={entry.key}
                className="flex items-baseline gap-2 border-b border-line px-2 py-1.5 last:border-b-0"
              >
                <span className="w-14 shrink-0 text-sm font-bold text-text-main">{entry.term}</span>
                <span className="min-w-0 flex-1 text-[11px] leading-snug text-text-mute">
                  {entry.short}
                </span>
                <span className="tnum shrink-0 text-[11px] text-text-mute">
                  {entry.combinations}通り
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] leading-relaxed text-text-mute">
            通りが多いほど当たりにくく、当たったときの配当は大きくなります。
            はじめてなら<strong className="text-text-main">単勝か複勝</strong>から。
          </p>
        </section>

        <section className="rule-top mt-4 pt-2">
          <h2 className="text-sm font-black text-text-main">艇の色は決まっています</h2>
          <p className="mt-1 text-[11px] text-text-mute">
            世界共通で、どの競艇場でも同じです
          </p>
          <ul className="mt-1.5 grid grid-cols-3 gap-1">
            {[
              { no: 1, name: '白', bg: '#FFFFFF', fg: '#1A1A1A' },
              { no: 2, name: '黒', bg: '#2B2B2B', fg: '#FFFFFF' },
              { no: 3, name: '赤', bg: '#D83A34', fg: '#FFFFFF' },
              { no: 4, name: '青', bg: '#2A6FC9', fg: '#FFFFFF' },
              { no: 5, name: '黄', bg: '#F2C230', fg: '#1A1A1A' },
              { no: 6, name: '緑', bg: '#3F9A54', fg: '#FFFFFF' },
            ].map((entry) => (
              <li
                key={entry.no}
                className="boat-edge flex items-center justify-center gap-1 py-1.5 text-sm font-black"
                style={{ backgroundColor: entry.bg, color: entry.fg }}
              >
                {entry.no}
                <span className="text-[11px] font-normal">{entry.name}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] leading-relaxed text-text-mute">
            内側（1号艇）ほど有利です。
            <strong className="text-text-main">住之江では1号艇が56%で1着</strong>
            になります。
          </p>
        </section>

        <section className="rule-top mt-4 pt-2">
          <h2 className="text-sm font-black text-text-main">画面の見かた</h2>
          <ul className="mt-1 space-y-1 text-sm leading-relaxed text-text-main">
            <li>
              <strong>買い目</strong> — レースごとの買い方の型。ここから見てください
            </li>
            <li>
              <strong>オッズ</strong> — 公式のオッズをそのまま。判断は入れていません
            </li>
            <li>
              <strong>記録</strong> — 買った舟券を残す。配当は夜に自動で入ります
            </li>
            <li>
              <strong>開催</strong> — 次はいつ開催か
            </li>
          </ul>
          <p className="mt-2 text-[11px] leading-relaxed text-text-mute">
            画面のあちこちにある
            <span className="underline decoration-dotted underline-offset-2">
              点線の言葉<span className="align-super text-[9px]">?</span>
            </span>
            を押すと、その用語の意味が出ます。
          </p>
        </section>

        <button
          type="button"
          onClick={onClose}
          className="on-accent mt-5 min-h-14 w-full border border-accent bg-accent text-base font-black"
        >
          はじめる
        </button>

        <p className="mt-2 pb-6 text-center text-[11px] text-text-mute">
          この案内は「開催」タブからいつでも開き直せます
        </p>
      </div>
    </div>
  );
}
