'use client';

/**
 * 買った舟券を券種ごとに記入する。記録タブの主役。
 *
 * **公式のマークシートと同じ形。** 現地で手にしているのがあの紙なので、
 * 画面が別の組み方をしていると見比べながら入力できない。
 *
 *   式別（券種） → 買い方 → 着順の欄 → 金額 → 単位（百/千/万）
 *
 * 買い方は公式カードと同じ3つ。**ボックスとフォーメーションを手で組めることが要**で、
 * 6点の券が1点ずつ6回ではなく、数タップで入る。
 * 展開の計算は実物の券と公式の点数表で検算してある（`lib/betBuilder.ts`）。
 */

import { useState } from 'react';

import {
  BET_TYPE_SPECS,
  boxPoints,
  emptyFormation,
  emptySlots,
  expandBox,
  expandFormation,
  formatSelection,
  formationRows,
  isComplete,
  normalizeCombo,
  setSlot,
  slotLabel,
  specOf,
  stylesFor,
  toggleInList,
  type BuyStyle,
  type FormationPicks,
  type Slots,
} from '@/lib/betBuilder';
import type { Bet } from '@/lib/bets';
import { betTypeGuide } from '@/lib/glossary';
import type { PayoutKey } from '@/lib/results';
import { BOAT_COLORS, BOATS, type Boat } from '@/lib/types';

import { StakePicker, stakeYen } from './StakePicker';

interface BetBuilderProps {
  onAdd: (bets: Bet[]) => void;
}

/** 艇のボタン1つ */
function BoatButton({
  boat,
  picked,
  dimmed,
  label,
  onPress,
}: {
  boat: Boat;
  picked: boolean;
  dimmed?: boolean;
  label: string;
  onPress: () => void;
}) {
  const color = BOAT_COLORS[boat];
  return (
    <button
      type="button"
      onClick={onPress}
      aria-pressed={picked}
      aria-label={label}
      className={[
        'boat-edge flex h-11 items-center justify-center text-base font-black',
        picked ? 'accent-glow' : '',
        dimmed ? 'opacity-30' : '',
      ].join(' ')}
      style={{ backgroundColor: color.bg, color: color.fg }}
    >
      {boat}
    </button>
  );
}

export function BetBuilder({ onAdd }: BetBuilderProps) {
  const [betType, setBetType] = useState<PayoutKey>('trio');
  const [style, setStyle] = useState<BuyStyle>('normal');
  const [slots, setSlots] = useState<Slots>(() => emptySlots(specOf('trio')));
  const [boxBoats, setBoxBoats] = useState<Boat[]>([]);
  const [formation, setFormation] = useState<FormationPicks>(() => emptyFormation(specOf('trio')));
  const [stakeAmount, setStakeAmount] = useState(1);
  const [stakeUnit, setStakeUnit] = useState(100);

  const spec = specOf(betType);
  const guide = betTypeGuide(betType);
  const unitYen = stakeYen(stakeAmount, stakeUnit);
  const styles = stylesFor(spec);

  /** いま組めている買い目。買い方によって作り方が変わる */
  const combos: Boat[][] =
    style === 'box'
      ? expandBox(boxBoats, spec)
      : style === 'formation'
        ? expandFormation(formationRows(formation), spec)
        : isComplete(slots, spec)
          ? [normalizeCombo(slots, spec)]
          : [];

  const ready = combos.length > 0;
  const totalYen = combos.length * unitYen;
  const touched =
    slots.some((entry) => entry !== null) ||
    boxBoats.length > 0 ||
    formation.some((entry) => entry.length > 0);

  const resetSelection = (nextSpec = spec) => {
    setSlots(emptySlots(nextSpec));
    setBoxBoats([]);
    setFormation(emptyFormation(nextSpec));
  };

  const add = () => {
    if (!ready) return;
    onAdd(combos.map((combo) => ({ betType, combo, amountYen: unitYen })));
    resetSelection();
  };

  return (
    <div className="space-y-2">
      {/* 式別 */}
      <div className="grid grid-cols-4 gap-1">
        {BET_TYPE_SPECS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => {
              setBetType(entry.key);
              resetSelection(entry);
              if (entry.size === 1) setStyle('normal');
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

      <div className="border-l-2 border-line pl-2">
        <p className="text-[11px] leading-snug text-text-main">{guide?.short ?? spec.hint}</p>
        {guide?.more ? <p className="mt-0.5 text-[11px] text-text-mute">{guide.more}</p> : null}
      </div>

      {/* 買い方。単勝・複勝には無い */}
      {styles.length > 1 ? (
        <div className="grid grid-cols-3 gap-1">
          {styles.map((entry) => (
            <button
              key={entry.key}
              type="button"
              onClick={() => {
                setStyle(entry.key);
                resetSelection();
              }}
              aria-pressed={style === entry.key}
              className={[
                'min-h-10 border px-0.5 text-xs font-bold',
                style === entry.key
                  ? 'on-accent border-accent bg-accent'
                  : 'border-line bg-bg-panel text-text-mute',
              ].join(' ')}
            >
              {entry.label}
            </button>
          ))}
        </div>
      ) : null}

      {/* --- 通常: 着順の欄に1艇ずつ --- */}
      {style === 'normal' ? (
        <div className="space-y-1">
          <p className="text-[11px] text-text-mute">
            {spec.size}艇選んでください{spec.ordered ? '（欄が着順です）' : ''}
          </p>
          {slots.map((picked, index) => (
            <div key={index}>
              <p className="text-[11px] text-text-mute">{slotLabel(index, spec)}</p>
              <div className="mt-0.5 grid grid-cols-6 gap-1">
                {BOATS.map((boat) => (
                  <BoatButton
                    key={boat}
                    boat={boat}
                    picked={picked === boat}
                    dimmed={picked !== boat && slots.includes(boat)}
                    label={`${slotLabel(index, spec)}に${boat}号艇`}
                    onPress={() => setSlots((current) => setSlot(current, index, boat))}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* --- ボックス: 艇を選ぶと全通りになる --- */}
      {style === 'box' ? (
        <div>
          <p className="text-[11px] text-text-mute">
            艇を{spec.size}つ以上選んでください。選んだ艇の全通りを買います
          </p>
          <div className="mt-0.5 grid grid-cols-6 gap-1">
            {BOATS.map((boat) => (
              <BoatButton
                key={boat}
                boat={boat}
                picked={boxBoats.includes(boat)}
                label={`${boat}号艇`}
                onPress={() => setBoxBoats((current) => toggleInList(current, boat))}
              />
            ))}
          </div>
          <p className="tnum mt-1 text-[11px] text-text-mute">
            {boxBoats.length}艇 →{' '}
            <strong className="text-text-main">{boxPoints(boxBoats.length, spec)}点</strong>
          </p>
        </div>
      ) : null}

      {/* --- フォーメーション: 着ごとに候補を選ぶ --- */}
      {style === 'formation' ? (
        <div className="space-y-1">
          <p className="text-[11px] text-text-mute">
            着ごとに何艇でも選べます。同じ艇が重なる組み合わせは除かれます
          </p>
          {formation.map((picks, index) => (
            <div key={index}>
              <p className="text-[11px] text-text-mute">{slotLabel(index, spec)}</p>
              <div className="mt-0.5 grid grid-cols-6 gap-1">
                {BOATS.map((boat) => (
                  <BoatButton
                    key={boat}
                    boat={boat}
                    picked={picks.includes(boat)}
                    label={`${slotLabel(index, spec)}に${boat}号艇`}
                    onPress={() =>
                      setFormation((current) =>
                        current.map((entry, at) =>
                          at === index ? toggleInList(entry, boat) : entry,
                        ),
                      )
                    }
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* 組めている買い目 */}
      <div className="flex items-baseline gap-2 border border-line bg-bg-raised px-2 py-1.5">
        <span className="text-[11px] text-text-mute">{spec.label}</span>
        <span className="tnum text-lg font-black text-text-main">
          {style === 'normal'
            ? formatSelection(slots, spec)
            : combos.length > 0
              ? `${combos.length}点`
              : '—'}
        </span>
        {touched ? (
          <button
            type="button"
            onClick={() => resetSelection()}
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
        points={combos.length}
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
          ? `${spec.label} ${combos.length}点を ${totalYen.toLocaleString('ja-JP')}円 で追加`
          : style === 'normal'
            ? `あと${slots.filter((entry) => entry === null).length}つ選んでください`
            : style === 'box'
              ? `あと${Math.max(1, spec.size - boxBoats.length)}艇`
              : '各着に1艇以上選んでください'}
      </button>
    </div>
  );
}
