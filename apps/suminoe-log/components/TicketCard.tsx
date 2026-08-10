'use client';

/**
 * 買った舟券を、券の見た目で出す。
 *
 * 公式サイトの入門ページが、着順の丸と「的中!!」「ハズレ」の印で見せている。
 * **数字の一覧より、券が並んでいるほうが自分が何を買ったか分かる。**
 *
 * **「まだ分からない」と「外れた」を分ける。** 着順が出ていないうちは結果待ち。
 * 金額の記録なので、ここを曖昧にすると振り返りが嘘になる。
 */

import { BET_TYPE_NAMES, formatYen, type Bet } from '@/lib/bets';
import { specOf } from '@/lib/betBuilder';
import { hitGrade, type TicketState } from '@/lib/ticketState';
import { BOAT_COLORS, type Boat } from '@/lib/types';

interface TicketCardProps {
  bet: Bet;
  state: TicketState;
  onRemove?: () => void;
}

function BoatMark({ boat, label }: { boat: Boat; label: string }) {
  const color = BOAT_COLORS[boat];
  return (
    <span className="flex flex-col items-center gap-0.5">
      <span className="text-[10px] text-text-mute">{label}</span>
      <span
        className="boat-edge flex h-9 w-9 items-center justify-center rounded-full text-base font-black"
        style={{ backgroundColor: color.bg, color: color.fg }}
      >
        {boat}
      </span>
    </span>
  );
}

export function TicketCard({ bet, state, onRemove }: TicketCardProps) {
  const spec = specOf(bet.betType);
  const grade = state.outcome === 'hit' ? hitGrade(state.multiple) : null;

  const labels = spec.ordered
    ? ['1着', '2着', '3着'].slice(0, bet.combo.length)
    : Array(bet.combo.length).fill('');

  return (
    <li
      className={[
        'relative border-2 bg-bg-panel px-2 py-2',
        state.outcome === 'hit'
          ? 'border-accent'
          : state.outcome === 'miss'
            ? 'border-line opacity-70'
            : 'border-dashed border-line',
      ].join(' ')}
    >
      <div className="flex items-baseline gap-2">
        <span className="text-[11px] font-bold text-text-main">{BET_TYPE_NAMES[bet.betType]}</span>
        <span className="tnum ml-auto text-[11px] text-text-mute">{formatYen(bet.amountYen)}</span>
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label="この舟券を消す"
            className="min-h-8 px-1 text-[11px] text-text-mute underline"
          >
            消す
          </button>
        ) : null}
      </div>

      <div className="mt-1 flex items-end gap-2">
        {bet.combo.map((boat, index) => (
          <BoatMark key={`${boat}-${index}`} boat={boat} label={labels[index] ?? ''} />
        ))}
      </div>

      {/* 結果の印。公式の入門ページと同じ見せ方 */}
      <div className="mt-1.5">
        {state.outcome === 'pending' ? (
          <p className="border border-dashed border-line py-1 text-center text-[11px] text-text-mute">
            結果待ち
          </p>
        ) : state.outcome === 'miss' ? (
          <p className="border border-line py-1 text-center text-sm font-bold text-text-mute">
            ハズレ
          </p>
        ) : (
          <div className="border-2 border-accent py-1 text-center">
            <p className={`text-base font-black tracking-widest heat-text-${Math.min(5, 1 + (grade?.tier ?? 1))}`}>
              🎯 {grade?.label ?? '的中'} !!
            </p>
            {state.returnedYen !== null ? (
              <p className="tnum mt-0.5 text-sm font-bold text-text-main">
                {formatYen(state.returnedYen)}
                <span className="ml-1 text-[11px] font-normal text-text-mute">
                  （{state.multiple?.toFixed(1)}倍 / 収支{' '}
                  {state.balanceYen !== null ? formatYen(state.balanceYen) : '—'}）
                </span>
              </p>
            ) : (
              <p className="mt-0.5 text-[11px] text-text-mute">
                払戻は夜に自動で入ります
              </p>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
