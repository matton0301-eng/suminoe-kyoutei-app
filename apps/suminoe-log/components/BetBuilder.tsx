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
  emptySlots,
  formatSelection,
  isComplete,
  normalizeCombo,
  setSlot,
  slotLabel,
  specOf,
  type Slots,
} from '@/lib/betBuilder';
import type { Bet } from '@/lib/bets';
import { betTypeGuide } from '@/lib/glossary';
import type { PayoutKey } from '@/lib/results';
import { BOAT_COLORS, BOATS, type Boat } from '@/lib/types';

import { StakePicker, stakeYen } from './StakePicker';

interface BetBuilderProps {
  onAdd: (bet: Bet) => void;
}

export function BetBuilder({ onAdd }: BetBuilderProps) {
  const [betType, setBetType] = useState<PayoutKey>('trio');
  const [slots, setSlots] = useState<Slots>(() => emptySlots(specOf('trio')));
  const [stakeAmount, setStakeAmount] = useState(1);
  const [stakeUnit, setStakeUnit] = useState(100);

  const spec = specOf(betType);
  const ready = isComplete(slots, spec);
  const unitYen = stakeYen(stakeAmount, stakeUnit);
  const guide = betTypeGuide(betType);

  const add = () => {
    if (!ready) return;
    onAdd({
      betType,
      combo: normalizeCombo(slots, spec),
      amountYen: unitYen,
    });
    setSlots(emptySlots(spec));
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
              setSlots(emptySlots(entry));
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

      {/* 券種を選んだ直後に「これは何を当てるものか」を出す。素人はここで迷う */}
      <div className="border-l-2 border-line pl-2">
        <p className="text-[11px] leading-snug text-text-main">
          {guide?.short ?? spec.hint}
        </p>
        <p className="mt-0.5 text-[11px] text-text-mute">
          {guide ? `全${guide.combinations}通り。` : ''}
          <strong className="text-text-main">{spec.size}艇</strong>選んでください
          {spec.ordered ? '（押した順が着順になります）' : ''}
        </p>
        {guide?.more ? (
          <p className="mt-0.5 text-[11px] text-text-mute">{guide.more}</p>
        ) : null}
      </div>

      {/*
        着順ごとの欄。**公式マークシートと同じ並び。**
        現地で紙のカードと見比べながら入力できるようにしてある。
      */}
      <div className="space-y-1">
        {slots.map((picked, index) => (
          <div key={index}>
            <p className="text-[11px] text-text-mute">{slotLabel(index, spec)}</p>
            <div className="mt-0.5 grid grid-cols-6 gap-1">
              {BOATS.map((boat) => {
                const color = BOAT_COLORS[boat];
                const chosen = picked === boat;
                const usedElsewhere = !chosen && slots.includes(boat);
                return (
                  <button
                    key={boat}
                    type="button"
                    onClick={() => setSlots((current) => setSlot(current, index, boat))}
                    aria-pressed={chosen}
                    aria-label={`${slotLabel(index, spec)}に${boat}号艇`}
                    className={[
                      'boat-edge flex h-11 items-center justify-center text-base font-black',
                      chosen ? 'accent-glow' : '',
                      usedElsewhere ? 'opacity-30' : '',
                    ].join(' ')}
                    style={{ backgroundColor: color.bg, color: color.fg }}
                  >
                    {boat}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* 組んでいる買い目 */}
      <div className="flex items-baseline gap-2 border border-line bg-bg-raised px-2 py-1.5">
        <span className="text-[11px] text-text-mute">{spec.label}</span>
        <span className="tnum text-lg font-black text-text-main">
          {formatSelection(slots, spec)}
        </span>
        {slots.some((entry) => entry !== null) ? (
          <button
            type="button"
            onClick={() => setSlots(emptySlots(spec))}
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
          ? `${spec.label} ${formatSelection(slots, spec)} を ${unitYen.toLocaleString('ja-JP')}円 で追加`
          : `あと${slots.filter((entry) => entry === null).length}つ選んでください`}
      </button>
    </div>
  );
}
