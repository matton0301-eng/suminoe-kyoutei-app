'use client';

/**
 * 開催予定。
 *
 * 住之江は**月に12日ほどしか開催がない**ので、「次はいつか」がまず知りたい。
 * 節（開催）ごとにまとめて出し、当日と次回だけを目立たせる。
 *
 * 予定が取れないときは「開催なし」と書かない。**分からないことを分からないと書く。**
 */

import {
  daysUntil,
  seriesDays,
  weekdayIndex,
  type Schedule,
  type ScheduleSeries,
} from '@/lib/calendar';
import { formatDateLabel } from '@/lib/raceDate';

interface CalendarTabProps {
  schedule: Schedule | null;
  /** 今日（YYYY-MM-DD） */
  today: string;
  /** はじめての方への案内を開き直す */
  onOpenGuide: () => void;
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;

function weekdayOf(iso: string): string {
  return WEEKDAYS[weekdayIndex(iso)] ?? '';
}

function shortLabel(iso: string): string {
  return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}(${weekdayOf(iso)})`;
}

function SeriesCard({
  entry,
  today,
}: {
  entry: ScheduleSeries;
  today: string;
}) {
  const days = seriesDays(entry);
  const running = entry.start <= today && today <= entry.end;
  const finished = entry.end < today;
  const until = daysUntil(today, entry.start);

  return (
    <section
      className={[
        'border px-2 py-2',
        running ? 'border-accent bg-bg-panel' : 'border-line bg-bg-panel',
        finished ? 'opacity-55' : '',
      ].join(' ')}
    >
      <div className="flex items-baseline gap-2">
        <span className="tnum text-base font-black text-text-main">
          {shortLabel(entry.start)} – {shortLabel(entry.end)}
        </span>
        <span className="ml-auto text-[11px] text-text-mute">
          {entry.grade ?? '—'} / {entry.days}日間
        </span>
      </div>

      <p className="mt-0.5 text-sm font-bold leading-snug text-text-main">{entry.name}</p>

      <p className="mt-1 text-[11px] text-text-mute">
        {running ? (
          <span className="font-bold text-accent">開催中</span>
        ) : finished ? (
          '終了'
        ) : until === 1 ? (
          <span className="font-bold text-accent">明日から</span>
        ) : (
          `あと${until}日`
        )}
      </p>

      {/* 日ごとの粒。今日がどこかを一目で分かるようにする */}
      <ul className="mt-1.5 flex flex-wrap gap-1">
        {days.map((day, index) => (
          <li
            key={day}
            className={[
              'tnum border px-1.5 py-0.5 text-[11px]',
              day === today
                ? 'on-accent border-accent bg-accent font-bold'
                : day < today
                  ? 'border-line text-text-mute opacity-60'
                  : 'border-line text-text-main',
            ].join(' ')}
          >
            {index + 1}日目 {shortLabel(day)}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CalendarTab({ schedule, today, onOpenGuide }: CalendarTabProps) {
  if (!schedule) {
    return (
      <div className="space-y-3">
        <section className="rule-top pt-2">
          <h2 className="paper-heading text-sm">開催予定</h2>
        </section>
        <p className="border border-line bg-bg-panel p-3 text-sm text-text-mute">
          開催予定を読み込めませんでした。オンラインで開き直すと取得できます。
        </p>
      </div>
    );
  }

  const next = schedule.raceDays.find((day) => day >= today) ?? null;
  const racingToday = schedule.raceDays.includes(today);
  const until = next ? daysUntil(today, next) : null;

  return (
    <div className="space-y-3">
      <section className="rule-top pt-2">
        <div className="flex items-baseline gap-2">
          <h2 className="paper-heading text-sm">開催予定</h2>
          <span className="ml-auto text-[11px] text-text-mute">{schedule.venue}</span>
        </div>

        <div className="mt-2 border border-line bg-bg-panel px-3 py-3">
          {racingToday ? (
            <>
              <p className="text-[11px] text-text-mute">今日</p>
              <p className="text-2xl font-black text-accent">開催日</p>
              <p className="tnum mt-0.5 text-sm text-text-main">{formatDateLabel(today)}</p>
            </>
          ) : next ? (
            <>
              <p className="text-[11px] text-text-mute">次の開催</p>
              <p className="tnum text-2xl font-black text-text-main">{shortLabel(next)}</p>
              <p className="mt-0.5 text-sm text-text-mute">
                {until === 1 ? '明日です' : `あと${until}日`}
              </p>
            </>
          ) : (
            <p className="text-sm text-text-mute">
              先の開催はまだ公表されていません。公表され次第ここに出ます。
            </p>
          )}
        </div>
      </section>

      <div className="space-y-2">
        {schedule.series.map((entry) => (
          <SeriesCard key={`${entry.start}-${entry.name}`} entry={entry} today={today} />
        ))}
      </div>

      <button
        type="button"
        onClick={onOpenGuide}
        className="min-h-12 w-full border border-line bg-bg-panel text-sm font-bold text-text-main"
      >
        はじめての方へ（アプリの使いかた・舟券の種類）
      </button>

      <p className="text-[11px] leading-relaxed text-text-mute">
        公式の月間スケジュールから取り込んでいます。
        <strong className="text-text-main">開催の無い日はデータを取りに行きません。</strong>
        先の月は公表され次第に増えます。
      </p>
    </div>
  );
}
