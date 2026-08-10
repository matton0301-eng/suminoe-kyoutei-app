'use client';

/**
 * オッズだけを見るタブ。
 *
 * 買い目の計算も期待値も挟まず、**公式のオッズをそのまま並べる**。
 * 現地では「アプリが何を勧めるか」ではなく「いまいくらか」だけを見たい場面がある。
 *
 * 7賭式すべてを扱う。3連単は120通りあるので1着ごとに畳む。
 * **拡連複と複勝は幅で出る**（1.8-2.1）。1つの数字に潰さず、そのまま両端を出す。
 */

import { useMemo, useState } from 'react';

import { findRaceOdds, formatFetchedAt, type OddsDay, type RaceOddsData } from '@/lib/odds';
import type { RaceCard } from '@/lib/raceCard';
import { BOAT_COLORS, type Boat } from '@/lib/types';

type BetTypeKey = 'trifecta' | 'trio' | 'exacta' | 'quinella' | 'wide' | 'win' | 'place';

interface BetTypeSpec {
  key: BetTypeKey;
  label: string;
  /** 着順が意味を持つか */
  ordered: boolean;
  /** 通り数（画面の目安表示に使う） */
  count: number;
  hint: string;
}

const BET_TYPES: readonly BetTypeSpec[] = [
  { key: 'trifecta', label: '3連単', ordered: true, count: 120, hint: '1〜3着を着順どおり' },
  { key: 'trio', label: '3連複', ordered: false, count: 20, hint: '1〜3着を順不同' },
  { key: 'exacta', label: '2連単', ordered: true, count: 30, hint: '1〜2着を着順どおり' },
  { key: 'quinella', label: '2連複', ordered: false, count: 15, hint: '1〜2着を順不同' },
  { key: 'wide', label: '拡連複', ordered: false, count: 15, hint: '3着までに入る2艇' },
  { key: 'win', label: '単勝', ordered: true, count: 6, hint: '1着' },
  { key: 'place', label: '複勝', ordered: false, count: 6, hint: '2着まで' },
];

interface OddsTabProps {
  odds: OddsDay | null;
  raceCard: RaceCard | null;
  raceNo: number;
  onChangeRace: (raceNo: number) => void;
}

interface Row {
  key: string;
  boats: Boat[];
  low: number;
  high: number | null;
}

/** オッズの高さで濃さを変える。数字は必ず添えるので、色は補助 */
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

function rowsOf(race: RaceOddsData | null, spec: BetTypeSpec): Row[] {
  if (!race) return [];
  const toRow = (key: string, low: number, high: number | null): Row => ({
    key,
    boats: key.split('-').map((n) => Number(n) as Boat),
    low,
    high,
  });

  if (spec.key === 'wide' || spec.key === 'place') {
    const source = spec.key === 'wide' ? race.wide : race.place;
    return [...source.entries()]
      .map(([key, [low, high]]) => toRow(key, low, high))
      .sort((a, b) => a.low - b.low);
  }

  const source =
    spec.key === 'trifecta'
      ? race.trifecta
      : spec.key === 'trio'
        ? race.trio
        : spec.key === 'exacta'
          ? race.exacta
          : spec.key === 'quinella'
            ? race.quinella
            : race.win;
  return [...source.entries()]
    .map(([key, value]) => toRow(key, value, null))
    .sort((a, b) => a.low - b.low);
}

function OddsValue({ row }: { row: Row }) {
  return (
    <span className={`tnum text-base ${toneOf(row.low)}`}>
      {row.low.toFixed(1)}
      {row.high !== null && row.high !== row.low ? `–${row.high.toFixed(1)}` : ''}
      <span className="ml-0.5 text-[10px] font-normal text-text-mute">倍</span>
    </span>
  );
}

function OddsRow({ row, showPayout }: { row: Row; showPayout: boolean }) {
  return (
    <li className="flex items-center gap-2 border-b border-line px-2 py-1.5 last:border-b-0">
      <span className="flex gap-0.5">
        {row.boats.map((boat, index) => (
          <BoatChip key={`${boat}-${index}`} boat={boat} />
        ))}
      </span>
      <span className="ml-auto">
        <OddsValue row={row} />
      </span>
      {showPayout ? (
        <span className="tnum w-24 shrink-0 text-right text-[11px] text-text-mute">
          100円→{Math.round(row.low * 100).toLocaleString('ja-JP')}円
        </span>
      ) : null}
    </li>
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

  const spec = BET_TYPES.find((entry) => entry.key === betType) ?? BET_TYPES[1];
  const rows = useMemo(() => rowsOf(raceOdds, spec), [raceOdds, spec]);
  const race = raceCard?.races.find((entry) => entry.raceNo === raceNo) ?? null;
  const foldByFirst = spec.key === 'trifecta';

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
      <div className="grid grid-cols-4 gap-1">
        {BET_TYPES.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => {
              setBetType(entry.key);
              setOpenFirst(null);
            }}
            aria-pressed={betType === entry.key}
            className={[
              'min-h-10 border px-0.5 text-[13px] font-bold',
              betType === entry.key
                ? 'on-accent border-accent bg-accent'
                : 'border-line bg-bg-panel text-text-mute',
            ].join(' ')}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <p className="text-[11px] text-text-mute">
        <strong className="text-text-main">{spec.label}</strong> — {spec.hint}（{spec.count}通り）
      </p>

      {rows.length === 0 ? (
        <p className="border border-line bg-bg-panel p-3 text-sm text-text-mute">
          このレースの{spec.label}はまだ取れていません。発売前か、取得がまだ回っていません。
        </p>
      ) : foldByFirst ? (
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
                    最安 {Math.min(...group.map((row) => row.low)).toFixed(1)}倍 / {group.length}通り
                  </span>
                  <span className="text-text-mute">{open ? '−' : '＋'}</span>
                </button>
                {open ? (
                  <ul className="border-t border-line">
                    {group.map((row) => (
                      <OddsRow key={row.key} row={row} showPayout={false} />
                    ))}
                  </ul>
                ) : null}
              </section>
            );
          })}
        </div>
      ) : (
        <ul className="border border-line bg-bg-panel">
          {rows.map((row) => (
            <OddsRow key={row.key} row={row} showPayout />
          ))}
        </ul>
      )}

      <p className="text-[11px] leading-relaxed text-text-mute">
        公式サイトのオッズをそのまま並べています。
        <strong className="text-text-main">締切直前まで動きます。</strong>
        上の取得時刻を必ず見てください。ここに買い目の判断は入れていません。
        {spec.key === 'wide' || spec.key === 'place' ? (
          <>
            <br />
            {spec.label}は
            <strong className="text-text-main">どの組み合わせで来るかで払戻が変わる</strong>
            ため、幅で出ます。100円あたりの払戻は下限で計算しています。
          </>
        ) : null}
      </p>
    </div>
  );
}
