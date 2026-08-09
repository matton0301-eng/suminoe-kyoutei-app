'use client';

/**
 * オッズだけを見るタブ。
 *
 * 買い目の計算も期待値も挟まず、**公式のオッズをそのまま並べる**。
 * 現地では「アプリが何を勧めるか」ではなく「いまいくらか」だけを見たい場面がある。
 *
 * 3連単は120通りあるので、既定では1着ごとに畳んでおく。
 * 3連複は20通りなので全部出す。
 */

import { useMemo, useState } from 'react';

import { findRaceOdds, formatFetchedAt, type OddsDay } from '@/lib/odds';
import type { RaceCard } from '@/lib/raceCard';
import { BOAT_COLORS, type Boat } from '@/lib/types';

type BetTypeKey = 'trio' | 'trifecta';

interface OddsTabProps {
  odds: OddsDay | null;
  raceCard: RaceCard | null;
  raceNo: number;
  onChangeRace: (raceNo: number) => void;
}

/** オッズの高さで色の濃さを変える。数字は必ず添えるので、色は補助 */
function toneOf(value: number): string {
  if (value < 10) return 'text-text-main font-bold';
  if (value < 50) return 'text-text-main';
  if (value < 200) return 'text-text-mute';
  return 'text-text-mute opacity-60';
}

function BoatChip({ boat }: { boat: Boat }) {
  const color = BOAT_COLORS[boat];
  return (
    <span
      className="boat-edge inline-flex h-5 w-5 items-center justify-center text-[11px] font-black"
      style={{ backgroundColor: color.bg, color: color.fg }}
    >
      {boat}
    </span>
  );
}

export function OddsTab({ odds, raceCard, raceNo, onChangeRace }: OddsTabProps) {
  const [betType, setBetType] = useState<BetTypeKey>('trio');
  const [openFirst, setOpenFirst] = useState<Boat | null>(null);

  // 出走表が無くてもオッズは見せる。その場合はオッズ自身の日付で照合する
  const raceOdds = useMemo(
    () => findRaceOdds(odds, raceNo, raceCard?.date ?? odds?.date ?? ''),
    [odds, raceNo, raceCard?.date],
  );

  const rows = useMemo(() => {
    if (!raceOdds) return [];
    const source = betType === 'trio' ? raceOdds.trio : raceOdds.trifecta;
    return [...source.entries()]
      .map(([key, value]) => ({
        key,
        boats: key.split('-').map((n) => Number(n) as Boat),
        odds: value,
      }))
      .sort((a, b) => a.odds - b.odds);
  }, [raceOdds, betType]);

  const race = raceCard?.races.find((entry) => entry.raceNo === raceNo) ?? null;

  return (
    <div className="space-y-3">
      {/* レース選択 */}
      <section className="rule-top pt-2">
        <div className="flex items-baseline gap-2">
          <h2 className="paper-heading text-sm">オッズ</h2>
          <span className="ml-auto tnum text-[11px] text-text-mute">
            {raceOdds?.fetchedAt
              ? `${formatFetchedAt(raceOdds.fetchedAt)} 時点`
              : odds
                ? 'このレースは未取得'
                : 'オッズ未取得'}
          </span>
        </div>

        <div className="mt-2 grid grid-cols-6 gap-1">
          {Array.from({ length: 12 }, (_, index) => index + 1).map((no) => (
            <button
              key={no}
              type="button"
              onClick={() => onChangeRace(no)}
              aria-pressed={no === raceNo}
              className={[
                'tnum min-h-9 border text-sm font-bold',
                no === raceNo
                  ? 'on-accent border-accent bg-accent'
                  : 'border-line bg-bg-panel text-text-mute',
              ].join(' ')}
            >
              {no}
            </button>
          ))}
        </div>

        {race ? (
          <p className="tnum mt-1.5 text-[11px] text-text-mute">
            {raceNo}R {race.name ?? ''} 締切 {race.deadline ?? '—'}
          </p>
        ) : null}
      </section>

      {/* 賭式の切り替え */}
      <div className="flex gap-1">
        {(
          [
            { key: 'trio' as const, label: '3連複', count: 20 },
            { key: 'trifecta' as const, label: '3連単', count: 120 },
          ]
        ).map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => {
              setBetType(entry.key);
              setOpenFirst(null);
            }}
            aria-pressed={betType === entry.key}
            className={[
              'min-h-10 flex-1 border text-sm font-bold',
              betType === entry.key
                ? 'on-accent border-accent bg-accent'
                : 'border-line bg-bg-panel text-text-mute',
            ].join(' ')}
          >
            {entry.label}
            <span className="ml-1 text-[10px] font-normal">{entry.count}通り</span>
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="border border-line bg-bg-panel p-3 text-sm text-text-mute">
          このレースのオッズはまだ取れていません。発売前か、取得がまだ回っていません。
        </p>
      ) : betType === 'trio' ? (
        <ul className="border border-line bg-bg-panel">
          {rows.map((row) => (
            <li
              key={row.key}
              className="flex items-center gap-2 border-b border-line px-2 py-1.5 last:border-b-0"
            >
              <span className="flex gap-0.5">
                {row.boats.map((boat) => (
                  <BoatChip key={boat} boat={boat} />
                ))}
              </span>
              <span className={`tnum ml-auto text-base ${toneOf(row.odds)}`}>
                {row.odds.toFixed(1)}
                <span className="ml-0.5 text-[10px] font-normal text-text-mute">倍</span>
              </span>
              <span className="tnum w-24 shrink-0 text-right text-[11px] text-text-mute">
                100円→{Math.round(row.odds * 100).toLocaleString('ja-JP')}円
              </span>
            </li>
          ))}
        </ul>
      ) : (
        /* 3連単は1着ごとに畳む。120行を一度に出すと現地では読めない */
        <div className="space-y-1">
          {([1, 2, 3, 4, 5, 6] as Boat[]).map((first) => {
            const group = rows.filter((row) => row.boats[0] === first);
            if (group.length === 0) return null;
            const open = openFirst === first;
            return (
              <section key={first} className="border border-line bg-bg-panel">
                <button
                  type="button"
                  onClick={() => setOpenFirst(open ? null : first)}
                  aria-expanded={open}
                  className="flex min-h-11 w-full items-center gap-2 px-2 text-left"
                >
                  <BoatChip boat={first} />
                  <span className="text-sm font-bold text-text-main">{first}号艇が1着</span>
                  <span className="tnum ml-auto text-[11px] text-text-mute">
                    最安 {Math.min(...group.map((row) => row.odds)).toFixed(1)}倍 / {group.length}通り
                  </span>
                  <span className="text-text-mute">{open ? '−' : '＋'}</span>
                </button>
                {open ? (
                  <ul className="border-t border-line">
                    {group.map((row) => (
                      <li
                        key={row.key}
                        className="flex items-center gap-2 border-b border-line px-2 py-1.5 last:border-b-0"
                      >
                        <span className="flex gap-0.5">
                          {row.boats.map((boat, index) => (
                            <BoatChip key={`${boat}-${index}`} boat={boat} />
                          ))}
                        </span>
                        <span className={`tnum ml-auto text-base ${toneOf(row.odds)}`}>
                          {row.odds.toFixed(1)}
                          <span className="ml-0.5 text-[10px] font-normal text-text-mute">倍</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            );
          })}
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-text-mute">
        公式サイトのオッズをそのまま並べています。
        <strong className="text-text-main">締切直前まで動きます。</strong>
        上の取得時刻を必ず見てください。ここに買い目の判断は入れていません。
      </p>
    </div>
  );
}
