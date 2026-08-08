'use client';

/**
 * 枠色ボタン6個を横1列に並べる。
 *
 * 艇色がUIの主役。片手の親指で押せるよう、幅360pxの端末でも1辺48px以上を保つ。
 *
 * 幅の計算（最も狭い想定 360px）:
 *   360 − main の左右余白16 − セクションの左右余白16 = 328px
 *   328 = 6ボタン × 48 + 5隙間 × 8
 * つまり48pxが下限で、画面が広ければ flex-1 で伸びる（56px前後になる）。
 * 行ラベル（「1着」など）を横に置くと48pxを割るため、ラベルは上に置く。
 */

import { BOATS, BOAT_COLORS, type Boat } from '@/lib/types';

interface BoatPickerProps {
  /** ボタン群を説明するラベル。スクリーンリーダー向けにも使う。 */
  label: string;
  selected: Boat | null;
  onSelect: (boat: Boat) => void;
  /** 行の上に置く小さな見出し（結果の「1着」など） */
  rowLabel?: string;
}

export function BoatPicker({ label, selected, onSelect, rowLabel }: BoatPickerProps) {
  return (
    <div role="group" aria-label={label}>
      {rowLabel ? (
        <span className="mb-1 block text-[13px] font-bold tracking-wide text-text-mute">
          {rowLabel}
        </span>
      ) : null}
      <div className="flex gap-2">
        {BOATS.map((boat) => {
          const color = BOAT_COLORS[boat];
          const isSelected = selected === boat;
          return (
            <button
              key={boat}
              type="button"
              aria-label={`${boat}号艇 ${color.name}`}
              aria-pressed={isSelected}
              onClick={() => onSelect(boat)}
              style={{ backgroundColor: color.bg, color: color.fg }}
              className={[
                'flex aspect-square min-h-12 min-w-0 flex-1 items-center justify-center',
                'rounded-lg text-2xl font-black tnum',
                'transition-transform duration-100 motion-reduce:transition-none',
                // 選択中は水のきらめきをまとわせる（艇色の面は保ったまま）。
                // 非選択時も輪郭を入れる（明るい背景で1号艇の白が埋没するため）
                isSelected ? 'accent-glow scale-105' : 'boat-edge',
              ].join(' ')}
            >
              {boat}
            </button>
          );
        })}
      </div>
    </div>
  );
}
