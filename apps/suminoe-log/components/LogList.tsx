'use client';

/**
 * 過去日の観戦記録の一覧（読み取り専用）。
 *
 * 過去日の記録タブは入力フォームではなくこれを出す。
 * フォームは入力装置であって、振り返りには一覧の方が向く。
 */

import { formatResult } from '@/lib/aggregate';
import type { RaceLog } from '@/lib/types';

interface LogListProps {
  logs: RaceLog[];
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0">{label}</dt>
      <dd className="whitespace-pre-wrap text-text-main">{value}</dd>
    </div>
  );
}

export function LogList({ logs }: LogListProps) {
  if (logs.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-bg-panel p-6 text-center">
        <p className="text-base text-text-main">この日の記録はありません。</p>
        <p className="mt-1 text-sm text-text-mute">出走表・結果・収支は他のタブで見られます。</p>
      </div>
    );
  }

  const sorted = [...logs].sort((a, b) => a.raceNo - b.raceNo);

  return (
    <ul className="space-y-2 pb-20">
      {sorted.map((log) => (
        <li key={log.id} className="rounded-xl border border-line bg-bg-panel p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-base font-bold text-text-main">{log.raceNo}R</span>
            <span className="tnum text-sm text-text-mute">結果 {formatResult(log)}</span>
          </div>
          <dl className="mt-1 space-y-0.5 text-sm text-text-mute">
            {log.predictedFirst !== null ? (
              <Row label="予想1着" value={`${log.predictedFirst}号艇`} />
            ) : null}
            {log.tenjiFast !== null ? (
              <Row label="展示で速そう" value={`${log.tenjiFast}号艇`} />
            ) : null}
            {log.kimarite !== null ? <Row label="決まり手" value={log.kimarite} /> : null}
            {log.suimen !== null ? <Row label="水面" value={log.suimen} /> : null}
            {log.memo.trim() !== '' ? <Row label="メモ" value={log.memo} /> : null}
          </dl>
        </li>
      ))}
    </ul>
  );
}
