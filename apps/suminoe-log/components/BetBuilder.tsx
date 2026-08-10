'use client';

/**
 * 買った舟券を券種ごとに記入する。記録タブの主役。
 *
 * 現地で片手で操作する前提: 券種を押す → 艇を押す → 金額を押す → 追加。
 * **着順が意味を持つ賭式では、押した順が艇の上に数字で出る**（1着・2着・3着）。
 * 順不同では数字を出さない。意味が無いのに出すと混乱する。
 */

import { useState } from 'react';

import {
  BET_TYPE_SPECS,
  formatSelection,
  isComplete,
  normalizeCombo,
  placeOf,
  specOf,
  toggleBoat,
} from '@/lib/betBuilder';
import type { Bet } from '@/lib/bets';
import type { PayoutKey } from '@/lib/results';
import { BOAT_COLORS, BOATS, type Boat } from '@/lib/types';

import { StakePicker, stakeYen } from './StakePicker';

interface BetBuilderProps {
  onAdd: (bet: Bet) => void;
}

export function BetBuilder({ onAdd }: BetBuilderProps) {
  const [betType, setBetType] = useState<PayoutKey>('trio');
  const [selected, setSelected] = useState<Boat[]>([]);
  const [stakeAmount, setStakeAmount] = useState(1);
  const [stakeUnit, setStakeUnit] = useState(100);

  const spec = specOf(betType);
  const ready = isComplete(selected, spec);
  const unitYen = stakeYen(stakeAmount, stakeUnit);

  const add = () => {
    if (!ready) return;
    onAdd({
      betType,
      combo: normalizeCombo(selected, spec),
      amountYen: unitYen,
    });
    setSelected([]);
  };

  return (
    <div className="space-y-2">
      {/* 券種 */}
      <div className="grid grid-cols-4 gap-1">
        {BET_TYPE_SPECS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => {
              setBetType(entry.key);
              setSelected([]);
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
        {spec.hint}。<strong className="text-text-main">{spec.size}艇</strong>選んでください
        {spec.ordered ? '（押した順が着順になります）' : ''}
      </p>

      {/* 艇を選ぶ */}
      <div className="grid grid-cols-6 gap-1">
        {BOATS.map((boat) => {
          const place = placeOf(selected, boat, spec);
          const picked = selected.includes(boat);
          const color = BOAT_COLORS[boat];
          return (
            <button
              key={boat}
              type="button"
              onClick={() => setSelected((current) => toggleBoat(current, boat, spec))}
              aria-pressed={picked}
              aria-label={`${boat}号艇${place ? ` ${place}着` : ''}`}
              className={[
                'boat-edge relative flex h-12 items-center justify-center text-lg font-black',
                picked ? 'accent-glow' : '',
              ].join(' ')}
              style={{ backgroundColor: color.bg, color: color.fg }}
            >
              {boat}
              {place !== null ? (
                <span className="on-accent absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center bg-accent text-[11px] font-black">
                  {place}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* 組んでいる買い目 */}
      <div className="flex items-baseline gap-2 border border-line bg-bg-raised px-2 py-1.5">
        <span className="text-[11px] text-text-mute">{spec.label}</span>
        <span className="tnum text-lg font-black text-text-main">
          {formatSelection(selected, spec)}
        </span>
        {selected.length > 0 ? (
          <button
            type="button"
            onClick={() => setSelected([])}
            className="ml-auto min-h-9 px-2 text-xs text-text-mute underline"
          >
            選び直す
          </button>
        ) : null}
      </div>

      <StakePicker
        amount={stakeAmount}
        unit={stakeUnit}
        onChange={(nextAmount, nextUnit) => {
          setStakeAmount(nextAmount);
          setStakeUnit(nextUnit);
        }}
        points={1}
      />

      <button
        type="button"
        onClick={add}
        disabled={!ready}
        className={[
          'min-h-12 w-full border text-base font-black',
          ready
            ? 'on-accent border-accent bg-accent'
            : 'border-line bg-bg-panel text-text-mute opacity-50',
        ].join(' ')}
      >
        {ready
          ? `${spec.label} ${formatSelection(selected, spec)} を ${unitYen.toLocaleString('ja-JP')}円 で追加`
          : `あと${spec.size - selected.length}艇`}
      </button>
    </div>
  );
}
