'use client';

/**
 * 収支表示の共通パーツ。
 *
 * 1日の収支（TallyTab）と通算（TotalTallyView）で同じ見え方にするために切り出している。
 * 率は「—」を許し、収支は符号で色を変える（プラスだけアクセント）。
 */

import { formatYen } from '@/lib/review';

export function Rate({ value, digits = 0 }: { value: number | null; digits?: number }) {
  return <span className="tnum">{value === null ? '—' : `${value.toFixed(digits)}%`}</span>;
}

export function Balance({ value }: { value: number }) {
  const positive = value >= 0;
  return (
    <span className={['tnum font-bold', positive ? 'text-accent' : 'text-text-mute'].join(' ')}>
      {positive ? '+' : '−'}
      {formatYen(Math.abs(value))}
    </span>
  );
}

/**
 * 控除率の注意書き。
 *
 * **この文言を弱めないこと。** 数字を見て買い方を変えないでほしい、が設計思想の中核。
 */
export function Disclaimer() {
  return (
    <section className="rounded-xl border border-line bg-bg-deep p-3">
      <p className="text-[11px] leading-relaxed text-text-mute">
        <strong className="text-text-main">舟券の控除率は約25%あります。</strong>
        つまり長く買い続ければ回収率は75%前後に近づきます。ここで100%を超えていても、
        1日ぶんのばらつきであって分析が優れている証拠ではありません。
        逆に大きく負けていても、その日の運の範囲です。
        数字を見て買い方を大きく変えないでください。
      </p>
    </section>
  );
}
