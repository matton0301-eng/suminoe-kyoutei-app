'use client';

/**
 * 1点あたりの賭け金を「数字 × 単位」で選ぶ。
 *
 * 100/200/500/1000 の固定4択では、現地で実際に買う額に届かなかった
 * （2026-08-09 は 3連複を1点2,000円で買っている）。
 * 舟券は100円単位なので、数字と単位の掛け算で表せば穴が無い。
 *
 * **金額は記録として残る数字なので、丸めない。** 掛け算の結果をそのまま持つ。
 */

const AMOUNTS = [1, 2, 3, 4, 5, 10, 20, 30] as const;

const UNITS = [
  { label: '百', yen: 100 },
  { label: '千', yen: 1000 },
  { label: '万', yen: 10000 },
] as const;

export type StakeUnit = (typeof UNITS)[number]['yen'];

/** 選んだ数字と単位から1点あたりの金額を出す */
export function stakeYen(amount: number, unit: number): number {
  return amount * unit;
}

interface StakePickerProps {
  amount: number;
  unit: number;
  onChange: (amount: number, unit: number) => void;
  /** 何点買うか。合計を出すために使う */
  points: number;
}

export function StakePicker({ amount, unit, onChange, points }: StakePickerProps) {
  const perPoint = stakeYen(amount, unit);

  return (
    <div className="border border-line bg-bg-panel px-2 py-2">
      <div className="flex items-baseline gap-2">
        <span className="text-[11px] text-text-mute">1点あたり</span>
        <span className="tnum ml-auto text-lg font-black text-text-main">
          {perPoint.toLocaleString('ja-JP')}円
        </span>
        {points > 0 ? (
          <span className="tnum text-[11px] text-text-mute">
            × {points}点 = {(perPoint * points).toLocaleString('ja-JP')}円
          </span>
        ) : null}
      </div>

      <div className="mt-1.5 flex gap-1">
        {UNITS.map((entry) => (
          <button
            key={entry.yen}
            type="button"
            onClick={() => onChange(amount, entry.yen)}
            aria-pressed={unit === entry.yen}
            className={[
              'min-h-9 flex-1 border text-sm font-bold',
              unit === entry.yen ? 'on-accent border-accent bg-accent' : 'border-line text-text-mute',
            ].join(' ')}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="mt-1 flex gap-1">
        {AMOUNTS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onChange(value, unit)}
            aria-pressed={amount === value}
            className={[
              'tnum min-h-9 flex-1 border px-0 text-xs font-bold',
              amount === value ? 'on-accent border-accent bg-accent' : 'border-line text-text-mute',
            ].join(' ')}
          >
            {value}
          </button>
        ))}
      </div>
    </div>
  );
}
