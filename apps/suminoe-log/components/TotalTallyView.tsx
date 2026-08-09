'use client';

/**
 * 通算収支の表示（収支タブの「通算」）。
 *
 * アーカイブに残っている全開催日を合算する。**母数（日数・レース数）を必ず一緒に出す。**
 * 母数が増えるほど回収率は控除率どおり75%前後へ寄っていく。それを自分のデータで
 * 確かめられることがこの画面の目的であって、成績を良く見せるためのものではない。
 */

import { Balance, Disclaimer, Rate } from '@/components/TallyParts';
import type { MultiTally } from '@/lib/multiTally';
import { formatDateLabel } from '@/lib/raceDate';
import { formatYen } from '@/lib/review';

interface TotalTallyViewProps {
  total: MultiTally | null;
  loading: boolean;
  error: string | null;
}

export function TotalTallyView({ total, loading, error }: TotalTallyViewProps) {
  if (loading) {
    return (
      <section className="rounded-xl border border-line bg-bg-panel p-6 text-center">
        <p className="text-sm text-text-mute">アーカイブを読み込んでいます…</p>
      </section>
    );
  }

  if (error !== null) {
    return (
      <section className="rounded-xl border border-line bg-bg-panel p-6 text-center">
        <p className="text-sm text-text-main">{error}</p>
      </section>
    );
  }

  if (total === null || total.totalDays === 0) {
    return (
      <section className="rounded-xl border border-line bg-bg-panel p-6 text-center">
        <p className="text-sm text-text-main">まだ通算できる開催日がありません。</p>
        <p className="mt-1 text-xs text-text-mute">
          結果が確定した日が増えると、ここに通算の収支が並びます。
        </p>
      </section>
    );
  }

  return (
    <>
      {/* 全体 */}
      <section className="rounded-xl border border-accent bg-bg-panel p-4">
        <div className="rule-start">
          <h2 className="text-[13px] font-bold tracking-wide text-text-main">
            通算収支（{total.totalDays}開催日）
          </h2>
          <p className="mt-0.5 text-[11px] text-text-mute">
            提示した8賭式すべてを1点{formatYen(100)}で買った場合
          </p>
        </div>

        <p className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="tnum text-3xl font-black text-text-main">
            {total.recoveryRate === null ? '—' : `${total.recoveryRate.toFixed(0)}%`}
          </span>
          <span className="text-xs text-text-mute">回収率</span>
          <span className="ml-auto">
            <Balance value={total.balanceYen} />
          </span>
        </p>

        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
          <div className="flex justify-between">
            <dt className="text-text-mute">投資</dt>
            <dd className="tnum text-text-main">{formatYen(total.investedYen)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-text-mute">払戻</dt>
            <dd className="tnum text-text-main">{formatYen(total.returnedYen)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-text-mute">対象</dt>
            <dd className="tnum text-text-main">
              {total.totalDays}日 / {total.racesFinished}R
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-text-mute">1号艇が1着</dt>
            <dd className="tnum text-text-main">
              {total.insideWon}本（<Rate value={total.insideWonRate} />）
            </dd>
          </div>
        </dl>

        <p className="mt-3 rounded-lg bg-bg-deep p-2 text-[10px] leading-relaxed text-text-mute">
          控除率は約25%あるため、続けるほど回収率は75%前後に収束します。
          通算表示は実績の記録であって、成績の保証ではありません。
          母数は {total.totalDays}開催日 / {total.racesFinished}レースです。
        </p>
      </section>

      {/* 日別 */}
      <section className="rounded-xl border border-line bg-bg-panel p-3">
        <div className="rule-start">
          <h2 className="text-[13px] font-bold tracking-wide text-text-main">日別の推移</h2>
          <p className="mt-0.5 text-[11px] text-text-mute">新しい開催日が上</p>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[22rem] text-xs">
            <thead>
              <tr className="text-text-mute">
                <th className="pb-1.5 text-left font-normal">日付</th>
                <th className="pb-1.5 text-right font-normal">確定R</th>
                <th className="pb-1.5 text-right font-normal">回収率</th>
                <th className="pb-1.5 text-right font-normal">収支</th>
              </tr>
            </thead>
            <tbody>
              {total.days.map((day) => (
                <tr key={day.date} className="border-t border-line">
                  <td className="tnum py-1.5 text-text-main">{formatDateLabel(day.date)}</td>
                  <td className="tnum py-1.5 text-right text-text-mute">{day.racesFinished}</td>
                  <td
                    className={[
                      'tnum py-1.5 text-right font-bold',
                      (day.recoveryRate ?? 0) >= 100 ? 'text-accent' : 'text-text-mute',
                    ].join(' ')}
                  >
                    {day.recoveryRate === null ? '—' : `${day.recoveryRate.toFixed(0)}%`}
                  </td>
                  <td className="py-1.5 text-right">
                    <Balance value={day.balanceYen} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 賭式ごと */}
      <section className="rounded-xl border border-line bg-bg-panel p-3">
        <div className="rule-start">
          <h2 className="text-[13px] font-bold tracking-wide text-text-main">賭式ごとの通算</h2>
          <p className="mt-0.5 text-[11px] text-text-mute">
            母数は {total.racesFinished} レース（{total.totalDays}開催日）。1点{formatYen(100)}換算
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
              {total.byBetType.map((row) => (
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

        {(() => {
          const best = total.byBetType
            .filter((row) => row.best !== null)
            .sort((a, b) => (b.best?.amount ?? 0) - (a.best?.amount ?? 0))[0];
          if (!best || best.best === null) return null;
          return (
            <p className="mt-2 text-[11px] text-text-mute">
              最高配当: {best.bestDate === null ? '' : `${formatDateLabel(best.bestDate)} `}
              {best.best.raceNo}R{' '}
              <span className="tnum text-text-main">{best.best.ticket.join('-')}</span>{' '}
              <span className="tnum font-bold text-accent">{formatYen(best.best.amount)}</span>
            </p>
          );
        })()}
      </section>

      {/* 判定ごと */}
      {total.byVerdict.length > 0 ? (
        <section className="rounded-xl border border-line bg-bg-panel p-3">
          <div className="rule-start">
            <h2 className="text-[13px] font-bold tracking-wide text-text-main">判定ごとの通算</h2>
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
                {total.byVerdict.map((row) => (
                  <tr key={row.verdict} className="border-t border-line">
                    <td className="py-1.5 font-bold text-text-main">{row.verdict}</td>
                    <td className="tnum py-1.5 text-right text-text-main">{row.races}</td>
                    <td className="tnum py-1.5 text-right text-text-main">
                      {row.insideWon}（
                      <Rate value={row.races > 0 ? (row.insideWon / row.races) * 100 : null} />）
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

      <Disclaimer />
    </>
  );
}
