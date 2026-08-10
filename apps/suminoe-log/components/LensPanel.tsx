'use client';

/**
 * 5つの視点と、その一致度。
 *
 * **割れているときに「本命」と言わない。** 割れていることを見せるのがこの表示の役目で、
 * 1つの答えにまとめてしまうと、いままでの1スコア方式と同じになる。
 *
 * 視点ごとの実績（743レースで測定）を必ず添える。数字が無いと
 * 「視点が増えただけ」で終わり、どれを信じるかの判断材料にならない。
 */

import {
  consensusLabel,
  statOf,
  type LensPick,
  type LensRecord,
  type LensVerdict,
} from '@/lib/lenses';
import { BOAT_COLORS, type Boat } from '@/lib/types';

interface LensPanelProps {
  verdict: LensVerdict;
  record: LensRecord | null;
}

function BoatChip({ boat }: { boat: Boat }) {
  const color = BOAT_COLORS[boat];
  return (
    <span
      className="boat-edge inline-flex h-6 w-6 items-center justify-center text-xs font-black"
      style={{ backgroundColor: color.bg, color: color.fg }}
    >
      {boat}
    </span>
  );
}

function LensRow({
  pick,
  record,
  leading,
}: {
  pick: LensPick;
  record: LensRecord | null;
  leading: Boat | null;
}) {
  const stat = statOf(record, pick.key);
  const agrees = pick.anchor !== null && pick.anchor === leading;

  return (
    <li className="flex items-start gap-2 border-b border-line px-2 py-1.5 last:border-b-0">
      <span className="w-14 shrink-0 text-[11px] font-bold text-text-main">{pick.label}</span>

      {pick.anchor !== null ? (
        <span className={agrees ? '' : 'opacity-70'}>
          <BoatChip boat={pick.anchor} />
        </span>
      ) : (
        <span className="inline-flex h-6 w-6 items-center justify-center border border-line text-[11px] text-text-mute">
          —
        </span>
      )}

      <span className="min-w-0 flex-1 text-[11px] leading-snug text-text-mute">
        {pick.reason ?? pick.missing}
        {stat?.measured ? (
          <>
            <br />
            <span className="tnum">
              実測 1着 {Math.round(stat.firstRate * 100)}% / 3着以内{' '}
              {Math.round(stat.top3Rate * 100)}%（{stat.races}レース）
            </span>
          </>
        ) : (
          <>
            <br />
            <span className="tnum">実測なし（過去データを遡れない視点）</span>
          </>
        )}
      </span>
    </li>
  );
}

export function LensPanel({ verdict, record }: LensPanelProps) {
  const strong = verdict.consensus === 'strong';

  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-2">
        <h2 className="paper-heading text-sm">5つの視点</h2>
        <span className="ml-auto text-[11px] text-text-mute">材料ごとに別々に見た結果</span>
      </div>

      <div
        className={[
          'border px-3 py-2',
          strong ? 'border-accent bg-bg-panel' : 'border-line bg-bg-panel',
        ].join(' ')}
      >
        <div className="flex items-center gap-2">
          {verdict.leading !== null ? <BoatChip boat={verdict.leading} /> : null}
          <p
            className={[
              'text-sm font-bold',
              strong ? 'text-accent' : 'text-text-main',
            ].join(' ')}
          >
            {consensusLabel(verdict)}
          </p>
        </div>
        {!strong && verdict.consensus !== 'unknown' ? (
          <p className="mt-1 text-[11px] leading-snug text-text-mute">
            材料によって推す艇が違います。
            <strong className="text-text-main">こういうレースは見送りも十分な選択です。</strong>
          </p>
        ) : null}
      </div>

      <ul className="border border-line bg-bg-panel">
        {verdict.picks.map((pick) => (
          <LensRow key={pick.key} pick={pick} record={record} leading={verdict.leading} />
        ))}
      </ul>

      <p className="text-[11px] leading-relaxed text-text-mute">
        実測は過去{record?.races ?? 0}レース（{record?.days ?? 0}開催日）で、
        その視点が推した艇が実際に何着だったかを数えたものです。
        <strong className="text-text-main">
          セオリーが単独で最も当たります。当地やモーターが良いだけでは軸になりません。
        </strong>
        視点が割れているかどうかを見るための表示で、買い目そのものは下の型を見てください。
      </p>
    </section>
  );
}
