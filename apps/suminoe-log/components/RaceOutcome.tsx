'use client';

/**
 * レースの結果と、提示した買い目の型がどうだったかを表示する。
 *
 * 「当たった/外れた」を正直に出す。1日ぶんの母数の小ささを画面から消さない。
 */

import { formatYen, summarizeOutcomes, type PlanOutcome } from '@/lib/review';
import type { ResultRace } from '@/lib/results';
import { BOAT_COLORS, type Boat } from '@/lib/types';

interface RaceOutcomeProps {
  race: ResultRace;
  outcomes: PlanOutcome[];
}

function OrderBadges({ order }: { order: Boat[] }) {
  return (
    <div className="flex items-center gap-1.5">
      {order.map((boat, index) => (
        <span key={`${boat}-${index}`} className="flex items-center gap-1.5">
          {index > 0 ? <span className="text-text-mute">→</span> : null}
          <span
            style={{ backgroundColor: BOAT_COLORS[boat].bg, color: BOAT_COLORS[boat].fg }}
            className="tnum flex h-9 w-9 items-center justify-center rounded text-lg font-black ring-1 ring-line"
          >
            {boat}
          </span>
        </span>
      ))}
    </div>
  );
}

export function RaceOutcome({ race, outcomes }: RaceOutcomeProps) {
  const summary = summarizeOutcomes(outcomes);
  const balance = summary.returnedYen - summary.investedYen;

  return (
    <section className="rounded-xl border border-accent bg-bg-panel p-3">
      <div className="rule-start">
        <h2 className="text-[13px] font-bold tracking-wide text-text-main">結果</h2>
        <p className="mt-0.5 text-[11px] text-text-mute">
          実際の着順と、上に出した型がどうだったか
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        {race.order.length > 0 ? (
          <OrderBadges order={race.order} />
        ) : (
          <p className="text-sm text-text-mute">着順が取れていません</p>
        )}
        {race.kimarite ? (
          <span className="text-sm font-bold text-text-main">{race.kimarite}</span>
        ) : null}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        {race.anchor !== null ? (
          <div className="flex gap-1">
            <dt className="text-text-mute">軸にした艇</dt>
            <dd className="text-text-main">
              {race.anchor}号艇{' '}
              <span className={race.anchorWon ? 'font-bold text-accent' : 'text-text-mute'}>
                {race.anchorWon === null ? '—' : race.anchorWon ? '1着' : '1着ならず'}
              </span>
            </dd>
          </div>
        ) : null}
        <div className="flex gap-1">
          <dt className="text-text-mute">進入</dt>
          <dd className="text-text-main">
            {race.wakunari === null ? '—' : race.wakunari ? '枠なり' : '枠なりでない'}
          </dd>
        </div>
        <div className="flex gap-1">
          <dt className="text-text-mute">水面</dt>
          <dd className="text-text-main">
            {race.weather || '—'}
            {race.windM !== null ? ` / ${race.windDir}${race.windM}m` : ''}
            {race.waveCm !== null ? ` / 波${race.waveCm}cm` : ''}
          </dd>
        </div>
      </dl>

      {race.notes.map((note) => (
        <p key={note} className="mt-1.5 text-[11px] text-text-mute">
          ※ {note}
        </p>
      ))}

      {/* 型ごとの的中 */}
      <ul className="mt-3 space-y-1.5">
        {outcomes.map((outcome) => {
          const hit = outcome.hits.length > 0;
          return (
            <li
              key={outcome.plan.key}
              className={[
                'flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg border px-2 py-1.5',
                hit ? 'border-accent bg-bg-raised' : 'border-line bg-bg-raised/40',
              ].join(' ')}
            >
              <span className="text-xs font-bold text-text-main">{outcome.plan.name}</span>
              <span className="tnum text-[11px] text-text-mute">{outcome.plan.points}点</span>
              {outcome.unknown ? (
                <span className="text-[11px] text-text-mute">払戻データなし</span>
              ) : hit ? (
                <>
                  <span className="text-xs font-black text-accent">的中</span>
                  <span className="tnum text-xs text-text-main">
                    {outcome.hits
                      .map((h) => `${h.ticket.join('-')} ${formatYen(h.amount)}`)
                      .join(' / ')}
                  </span>
                </>
              ) : (
                <span className="text-[11px] text-text-mute">はずれ</span>
              )}
            </li>
          );
        })}
      </ul>

      {/* 収支の目安 */}
      {summary.totalPlans > 0 ? (
        <div className="mt-3 rounded-lg bg-bg-deep p-2.5">
          <p className="text-[11px] text-text-mute">
            上の型を<strong className="text-text-main">すべて1点100円で買った場合</strong>の目安
          </p>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="tnum text-text-main">投資 {formatYen(summary.investedYen)}</span>
            <span className="text-text-mute">／</span>
            <span className="tnum text-text-main">払戻 {formatYen(summary.returnedYen)}</span>
            <span
              className={[
                'tnum font-black',
                balance >= 0 ? 'text-accent' : 'text-text-mute',
              ].join(' ')}
            >
              {balance >= 0 ? '+' : '−'}
              {formatYen(Math.abs(balance))}
            </span>
          </p>
          <p className="mt-1 text-[10px] leading-snug text-text-mute">
            8種類すべてを同時に買う前提の数字なので、実際の買い方とは違います。
            1レースぶんの結果に意味はありません。
          </p>
        </div>
      ) : null}
    </section>
  );
}
