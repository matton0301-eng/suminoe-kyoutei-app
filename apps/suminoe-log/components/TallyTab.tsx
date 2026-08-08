'use client';

/**
 * 収支タブ。その日の当選率と、1点100円で買った場合の収支を出す。
 *
 * **控除率は約25%あるので、続ければ回収率は75%前後に収束する。**
 * ここで100%を超えていても1日ぶんのばらつきなので、母数を必ず併記する。
 *
 * 「通算」は開催日をまたいだ集計（{@link TotalTallyView}）。
 * アーカイブを全日分読むので、**押されて初めて**取得する（起動時には読まない）。
 */

import { useState } from 'react';

import { Balance, Disclaimer, Rate } from '@/components/TallyParts';
import { TotalTallyView } from '@/components/TotalTallyView';
import type { MultiTally } from '@/lib/multiTally';
import { formatYen } from '@/lib/review';
import type { DayTally } from '@/lib/tally';
import { BOAT_COLORS, type Boat } from '@/lib/types';

type Mode = 'day' | 'total';

interface TallyTabProps {
  tally: DayTally | null;
  /** 出走表があるか（無ければ取り込みを促す） */
  hasCard: boolean;
  /** 通算データ。まだ読み込んでいなければ null */
  total: MultiTally | null;
  totalLoading: boolean;
  /** 通算の読み込みに失敗したときの案内。無ければ null */
  totalError: string | null;
  /** 「通算」を初めて開いたときに呼ばれる */
  onRequestTotal: () => void;
}

function OrderMini({ order }: { order: Boat[] }) {
  if (order.length === 0) return <span className="text-text-mute">—</span>;
  return (
    <span className="inline-flex items-center gap-0.5">
      {order.map((boat, index) => (
        <span key={`${boat}-${index}`} className="inline-flex items-center gap-0.5">
          {index > 0 ? <span className="text-[9px] text-text-mute">-</span> : null}
          <span
            style={{ backgroundColor: BOAT_COLORS[boat].bg, color: BOAT_COLORS[boat].fg }}
            className="tnum inline-flex h-4 w-4 items-center justify-center rounded-sm text-[10px] font-black"
          >
            {boat}
          </span>
        </span>
      ))}
    </span>
  );
}

export function TallyTab({
  tally,
  hasCard,
  total,
  totalLoading,
  totalError,
  onRequestTotal,
}: TallyTabProps) {
  const [mode, setMode] = useState<Mode>('day');

  const handleMode = (next: Mode) => {
    setMode(next);
    // 通算はアーカイブ全日分の取得を伴うので、初回に押されたときだけ読む
    if (next === 'total' && total === null && !totalLoading) onRequestTotal();
  };

  return (
    <div className="space-y-3 pb-20">
      <div className="flex gap-2">
        {(['day', 'total'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => handleMode(value)}
            aria-pressed={mode === value}
            className={[
              'min-h-11 flex-1 rounded-lg text-sm font-bold',
              mode === value
                ? 'on-accent bg-accent'
                : 'border border-line bg-bg-raised text-text-main',
            ].join(' ')}
          >
            {value === 'day' ? 'この日' : '通算'}
          </button>
        ))}
      </div>

      {mode === 'day' ? (
        <DayView tally={tally} hasCard={hasCard} />
      ) : (
        <TotalTallyView total={total} loading={totalLoading} error={totalError} />
      )}
    </div>
  );
}

function DayView({ tally, hasCard }: { tally: DayTally | null; hasCard: boolean }) {
  if (!hasCard) {
    return (
      <section className="rounded-xl border border-line bg-bg-panel p-4">
        <p className="text-sm text-text-main">出走表がまだありません。</p>
        <p className="mt-1 text-xs text-text-mute">
          買い目タブで出走表を取り込むと、レース後にここで収支が出ます。
        </p>
      </section>
    );
  }

  if (!tally) {
    return (
      <>
        <section className="rounded-xl border border-line bg-bg-panel p-4">
          <h2 className="text-base font-bold text-text-main">まだ結果が出ていません</h2>
          <p className="mt-1 text-sm text-text-mute">
            全レースが終わると結果が確定します（住之江のナイターは21時頃）。
            確定するとここに当選率と収支が並びます。
          </p>
        </section>
        <Disclaimer />
      </>
    );
  }

  return (
    <>
      {/* 全体 */}
      <section className="rounded-xl border border-accent bg-bg-panel p-4">
        <div className="rule-start">
          <h2 className="text-[13px] font-bold tracking-wide text-text-main">{tally.date} の収支</h2>
          <p className="mt-0.5 text-[11px] text-text-mute">
            提示した8賭式すべてを1点{formatYen(100)}で買った場合
          </p>
        </div>

        <p className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="tnum text-3xl font-black text-text-main">
            {tally.recoveryRate === null ? '—' : `${tally.recoveryRate.toFixed(0)}%`}
          </span>
          <span className="text-xs text-text-mute">回収率</span>
          <span className="ml-auto">
            <Balance value={tally.balanceYen} />
          </span>
        </p>

        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
          <div className="flex justify-between">
            <dt className="text-text-mute">投資</dt>
            <dd className="tnum text-text-main">{formatYen(tally.investedYen)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-text-mute">払戻</dt>
            <dd className="tnum text-text-main">{formatYen(tally.returnedYen)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-text-mute">確定レース</dt>
            <dd className="tnum text-text-main">
              {tally.racesFinished} / {tally.racesTotal}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-text-mute">1号艇が1着</dt>
            <dd className="tnum text-text-main">
              {tally.insideWon}本（<Rate value={tally.insideWonRate} />）
            </dd>
          </div>
        </dl>

        <p className="mt-3 rounded-lg bg-bg-deep p-2 text-[10px] leading-relaxed text-text-mute">
          1レースあたり{formatYen(tally.unitYen)}（8賭式の合計{Math.round(tally.unitYen / 100)}点）を
          {tally.racesFinished}レース買った前提です。実際に全賭式を同時に買うことはないので、
          目安として見てください。
        </p>
      </section>

      {/* 賭式ごとの当選率 */}
      <section className="rounded-xl border border-line bg-bg-panel p-3">
        <div className="rule-start">
          <h2 className="text-[13px] font-bold tracking-wide text-text-main">賭式ごとの当選率</h2>
          <p className="mt-0.5 text-[11px] text-text-mute">
            母数は {tally.racesFinished} レース。1点{formatYen(100)}換算
          </p>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[24rem] text-xs">
            <thead>
              <tr className="text-text-mute">
                <th className="pb-1.5 text-left font-normal">賭式</th>
                <th className="pb-1.5 text-right font-normal">当選</th>
                <th className="pb-1.5 text-right font-normal">当選率</th>
                <th className="pb-1.5 text-right font-normal">投資</th>
                <th className="pb-1.5 text-right font-normal">払戻</th>
                <th className="pb-1.5 text-right font-normal">回収率</th>
              </tr>
            </thead>
            <tbody>
              {[...tally.byBetType]
                .sort((a, b) => (b.recoveryRate ?? -1) - (a.recoveryRate ?? -1))
                .map((row) => (
                  <tr key={row.key} className="border-t border-line">
                    <td className="py-1.5 text-text-main">{row.name}</td>
                    <td className="tnum py-1.5 text-right text-text-main">
                      {row.hitRaces}/{row.races}
                    </td>
                    <td className="py-1.5 text-right text-text-main">
                      <Rate value={row.hitRate} />
                    </td>
                    <td className="tnum py-1.5 text-right text-text-mute">
                      {row.investedYen.toLocaleString('ja-JP')}
                    </td>
                    <td className="tnum py-1.5 text-right text-text-main">
                      {row.returnedYen.toLocaleString('ja-JP')}
                    </td>
                    <td
                      className={[
                        'tnum py-1.5 text-right font-bold',
                        (row.recoveryRate ?? 0) >= 100 ? 'text-accent' : 'text-text-mute',
                      ].join(' ')}
                    >
                      {row.recoveryRate === null ? '—' : `${row.recoveryRate.toFixed(0)}%`}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {/* 一番大きく当たった1点 */}
        {(() => {
          const best = tally.byBetType
            .map((row) => row.best)
            .filter((hit): hit is NonNullable<typeof hit> => hit !== null)
            .sort((a, b) => b.amount - a.amount)[0];
          if (!best) return null;
          return (
            <p className="mt-2 text-[11px] text-text-mute">
              最高配当: {best.raceNo}R{' '}
              <span className="tnum text-text-main">{best.ticket.join('-')}</span>{' '}
              <span className="tnum font-bold text-accent">{formatYen(best.amount)}</span>
            </p>
          );
        })()}
      </section>

      {/* 判定ごと */}
      {tally.byVerdict.length > 0 ? (
        <section className="rounded-xl border border-line bg-bg-panel p-3">
          <div className="rule-start">
            <h2 className="text-[13px] font-bold tracking-wide text-text-main">判定ごとの結果</h2>
            <p className="mt-0.5 text-[11px] text-text-mute">
              事前の「勝負／標準／見送り」が当たっていたか
            </p>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[20rem] text-xs">
              <thead>
                <tr className="text-text-mute">
                  <th className="pb-1.5 text-left font-normal">判定</th>
                  <th className="pb-1.5 text-right font-normal">R数</th>
                  <th className="pb-1.5 text-right font-normal">1号艇1着</th>
                  <th className="pb-1.5 text-right font-normal">軸が1着</th>
                  <th className="pb-1.5 text-right font-normal">収支</th>
                </tr>
              </thead>
              <tbody>
                {tally.byVerdict.map((row) => (
                  <tr key={row.verdict} className="border-t border-line">
                    <td className="py-1.5 font-bold text-text-main">{row.verdict}</td>
                    <td className="tnum py-1.5 text-right text-text-main">{row.races}</td>
                    <td className="tnum py-1.5 text-right text-text-main">
                      {row.insideWon}（{((row.insideWon / row.races) * 100).toFixed(0)}%）
                    </td>
                    <td className="tnum py-1.5 text-right text-text-main">{row.anchorWon}</td>
                    <td className="py-1.5 text-right">
                      <Balance value={row.balanceYen} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* レースごと */}
      <section className="rounded-xl border border-line bg-bg-panel p-3">
        <div className="rule-start">
          <h2 className="text-[13px] font-bold tracking-wide text-text-main">レースごと</h2>
        </div>
        <ul className="mt-3 space-y-1.5">
          {tally.perRace.map((row) => (
            <li
              key={row.raceNo}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-line bg-bg-raised/40 px-2 py-1.5"
            >
              <span className="tnum w-8 text-sm font-black text-text-main">{row.raceNo}R</span>
              <span className="text-[10px] text-text-mute">{row.verdict ?? '—'}</span>
              <OrderMini order={row.order} />
              {row.kimarite ? (
                <span className="text-[10px] text-text-mute">{row.kimarite}</span>
              ) : null}
              <span className="ml-auto">
                <Balance value={row.balanceYen} />
              </span>
              {row.hitNames.length > 0 ? (
                <span className="w-full text-[10px] text-accent">
                  的中: {row.hitNames.join(' / ')}
                </span>
              ) : (
                <span className="w-full text-[10px] text-text-mute">的中なし</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <Disclaimer />
    </>
  );
}
