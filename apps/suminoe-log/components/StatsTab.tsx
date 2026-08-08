'use client';

/**
 * 集計タブ。当日の傾向を住之江の基準値と並べて表示する。
 * これがこのアプリの中核価値。
 */

import { formatDiff, formatRate, type Stats } from '@/lib/aggregate';
import { BASELINE_PERIOD } from '@/lib/baseline';
import { BOAT_COLORS } from '@/lib/types';

interface StatsTabProps {
  stats: Stats;
}

export function StatsTab({ stats }: StatsTabProps) {
  if (stats.totalLogs === 0) {
    return (
      <div className="rounded-xl border border-line bg-bg-panel p-6 text-center">
        <p className="text-base text-text-main">まだ記録がありません。</p>
        <p className="mt-1 text-sm text-text-mute">記録タブから1レース目を入れてください。</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 pb-20">
      {/* ① 予想の的中率 */}
      <section className="rounded-xl border border-line bg-bg-panel p-4">
        <h2 className="text-sm font-bold text-text-mute">1着予想の的中</h2>
        <p className="mt-1 flex items-baseline gap-2">
          <span className="tnum text-4xl font-black text-text-main">
            {stats.hitRate.hit}
            <span className="text-2xl text-text-mute"> / {stats.hitRate.total}</span>
          </span>
          <span className="text-base text-text-mute">レース</span>
          <span className="tnum ml-auto text-2xl font-bold text-accent">
            {formatRate(stats.hitRate.rate)}
          </span>
        </p>
        {stats.hitRate.total === 0 ? (
          <p className="mt-1 text-xs text-text-mute">
            予想と結果1着の両方が入ったレースが母数です。
          </p>
        ) : null}
      </section>

      {/* ② コース別1着率 */}
      <section className="rounded-xl border border-line bg-bg-panel p-4">
        <h2 className="text-base font-bold text-text-main">コース別1着率</h2>
        <p className="mt-0.5 text-xs text-text-mute">
          当日 {stats.resultCount} レース分 ／ 破線は住之江の基準値（{BASELINE_PERIOD}）
        </p>
        <div className="mt-3 space-y-2">
          {stats.courses.map((course) => (
            <CourseBar key={course.course} {...course} />
          ))}
        </div>
        {stats.resultCount < 6 ? (
          <p className="mt-3 text-xs text-text-mute">
            ※ 母数 {stats.resultCount} レースはまだ少なく、基準との差は偶然の範囲に収まります。
          </p>
        ) : null}
      </section>

      {/* ③ 決まり手の内訳 */}
      <section className="rounded-xl border border-line bg-bg-panel p-4">
        <h2 className="text-base font-bold text-text-main">決まり手の内訳</h2>
        <ul className="mt-3 space-y-1.5">
          {stats.kimarite.map((entry) => (
            <li key={entry.kimarite} className="flex items-baseline gap-2">
              <span className="w-24 text-sm text-text-main">{entry.kimarite}</span>
              <span className="tnum text-lg font-bold text-text-main">{entry.count}</span>
              <span className="text-sm text-text-mute">件</span>
              <span className="tnum ml-auto text-sm text-text-mute">
                {formatRate(entry.rate)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* ④ 今日の水面の読み */}
      <section className="rounded-xl border border-line bg-bg-panel p-4">
        <h2 className="text-base font-bold text-text-main">今日の水面の読み</h2>
        <p
          className={[
            'mt-2 text-lg font-bold',
            stats.reading.ready ? 'text-accent' : 'text-text-mute',
          ].join(' ')}
        >
          {stats.reading.text}
        </p>
        {stats.reading.ready ? (
          <p className="mt-2 text-xs text-text-mute">
            記録から自動生成した目安です。母数が小さいうちは参考程度に。
          </p>
        ) : null}
      </section>
    </div>
  );
}

function CourseBar({
  course,
  count,
  rate,
  baseline,
  diff,
  emphasize,
}: Stats['courses'][number]) {
  const color = BOAT_COLORS[course];
  // 基準値と当日値のどちらも収まる目盛りにする（最低70%まで）
  const scaleMax = Math.max(70, baseline + 15, rate ?? 0);
  const barWidth = rate === null ? 0 : (rate / scaleMax) * 100;
  const baselineLeft = (baseline / scaleMax) * 100;

  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden
        style={{ backgroundColor: color.bg, color: color.fg }}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-sm font-black tnum ring-1 ring-line"
      >
        {course}
      </span>
      <span className="sr-only">{course}コース</span>

      <div className="relative h-7 flex-1 overflow-hidden rounded bg-bg-raised">
        <div
          className="h-full rounded-r"
          style={{ width: `${barWidth}%`, backgroundColor: color.bg, opacity: 0.85 }}
        />
        {/* 基準値マーカー */}
        <div
          aria-hidden
          className="absolute inset-y-0 border-l-2 border-dashed border-text-mute"
          style={{ left: `${baselineLeft}%` }}
        />
      </div>

      <span className="tnum w-14 shrink-0 text-right text-sm font-bold text-text-main">
        {formatRate(rate)}
      </span>
      <span
        className={[
          'tnum w-12 shrink-0 text-right text-sm',
          emphasize ? 'font-black text-accent' : 'text-text-mute',
        ].join(' ')}
      >
        {formatDiff(diff)}
      </span>
      <span className="tnum w-8 shrink-0 text-right text-xs text-text-mute">{count}件</span>
    </div>
  );
}
