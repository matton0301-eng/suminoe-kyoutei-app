'use client';

/**
 * 過去の開催日を選ぶモーダル。ヘッダーの日付タップで開く。
 *
 * リストは「アーカイブにある日 ∪ 記録が端末に残っている日」。
 * いま運用中の日（currentDate）は「今日」の行として先頭固定で出す。
 */

import { useEffect } from 'react';

import type { DayEntry } from '@/lib/archive';
import { formatDateLabel } from '@/lib/raceDate';

interface DayPickerProps {
  open: boolean;
  entries: DayEntry[];
  /** いま運用中の日（出走表の日付。閲覧専用にならない日） */
  currentDate: string;
  /** 閲覧中の過去日。通常運用なら null */
  viewDate: string | null;
  onSelect: (date: string | null) => void;
  onClose: () => void;
}

function entryLabel(entry: DayEntry): string {
  const parts: string[] = [];
  if (entry.hasCard && entry.hasResults) parts.push('出走表・結果あり');
  else if (entry.hasCard) parts.push('出走表あり');
  if (entry.logCount > 0) parts.push(`記録${entry.logCount}件`);
  return parts.length > 0 ? parts.join(' / ') : '記録なし';
}

export function DayPicker({
  open,
  entries,
  currentDate,
  viewDate,
  onSelect,
  onClose,
}: DayPickerProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const pastEntries = entries.filter((entry) => entry.date !== currentDate);

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/70"
      role="dialog"
      aria-modal="true"
      aria-labelledby="day-picker-title"
      onClick={onClose}
    >
      <div
        className="max-h-[70vh] w-full max-w-lg overflow-y-auto rounded-t-xl border border-line bg-bg-panel p-4 pb-8"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="day-picker-title" className="text-base font-bold text-text-main">
          日付を選ぶ
        </h2>
        <ul className="mt-3 space-y-2">
          <li>
            <button
              type="button"
              onClick={() => onSelect(null)}
              className={[
                'flex min-h-12 w-full items-center justify-between rounded-lg border px-3 text-left',
                viewDate === null ? 'border-accent bg-bg-raised' : 'border-line bg-bg-raised',
              ].join(' ')}
            >
              <span className="font-bold text-text-main">
                今日（<span className="tnum">{formatDateLabel(currentDate)}</span>）
              </span>
              {viewDate === null ? <span className="text-xs text-accent">表示中</span> : null}
            </button>
          </li>
          {pastEntries.map((entry) => (
            <li key={entry.date}>
              <button
                type="button"
                onClick={() => onSelect(entry.date)}
                className={[
                  'flex min-h-12 w-full items-center justify-between gap-2 rounded-lg border px-3 text-left',
                  viewDate === entry.date ? 'border-accent bg-bg-raised' : 'border-line bg-bg-raised',
                ].join(' ')}
              >
                <span className="tnum font-bold text-text-main">{formatDateLabel(entry.date)}</span>
                <span className="text-xs text-text-mute">{entryLabel(entry)}</span>
              </button>
            </li>
          ))}
        </ul>
        {pastEntries.length === 0 ? (
          <p className="mt-3 text-sm text-text-mute">まだ過去の日のデータがありません。</p>
        ) : null}
      </div>
    </div>
  );
}
