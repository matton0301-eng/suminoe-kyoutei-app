'use client';

/**
 * 的中したときの演出。
 *
 * **配当の大きさで段が変わる。** 100円が110円になったのと、
 * 1万円が返ってきたのを同じ演出で祝うと、どちらも軽くなる。
 *
 *   1段 的中     〜5倍     券に印＋短い光
 *   2段 好配当   5倍〜     光条が回る
 *   3段 高配当   20倍〜    虹の渦＋紙吹雪
 *   4段 万舟     100倍〜   全画面の閃光＋虹＋紙吹雪を増やす
 *
 * **外れたときには何も出さない。** パチンコの煽りは次を打たせるための仕組みで、
 * ここは記録の道具なので持ち込まない。
 *
 * 操作を邪魔しないよう `pointer-events: none` を敷いてある。
 * `prefers-reduced-motion` では globals.css 側でアニメーションが止まる。
 */

import { useEffect } from 'react';

import { formatBet, formatYen, type Bet } from '@/lib/bets';
import { bestGrade } from '@/lib/ticketState';

interface HitCelebrationProps {
  /** 当たった買い目。空なら何も出さない */
  hits: Bet[];
  /** 買い目ごとの倍率。まだ分からなければ null を入れる */
  multiples?: (number | null)[];
  /** 払戻の合計。まだ分からなければ null */
  returnedYen?: number | null;
  /** 演出の識別子。変わるたびに1回流す */
  token: number;
  onDone: () => void;
}

/** 段が上がるほど長く見せる。1段目は短く切り上げて操作を邪魔しない */
const DURATION_BY_TIER = [0, 1800, 2600, 3400, 4200] as const;

/** 紙吹雪の枚数。段で増やす */
const CONFETTI_BY_TIER = [0, 0, 14, 24, 40] as const;

const CONFETTI_COLORS = ['#ff2d55', '#ff9500', '#ffd60a', '#34c759', '#0a84ff', '#bf5af2'];

export function HitCelebration({
  hits,
  multiples = [],
  returnedYen = null,
  token,
  onDone,
}: HitCelebrationProps) {
  const grade = bestGrade(multiples.length > 0 ? multiples : hits.map(() => null));
  const duration = DURATION_BY_TIER[grade.tier] ?? 2600;

  useEffect(() => {
    if (hits.length === 0) return;
    const timer = window.setTimeout(onDone, duration);
    return () => window.clearTimeout(timer);
  }, [token, hits.length, duration, onDone]);

  if (hits.length === 0) return null;

  const confetti = CONFETTI_BY_TIER[grade.tier] ?? 0;

  return (
    <div
      className={`hit-overlay hit-tier-${grade.tier}`}
      role="status"
      aria-live="assertive"
      style={{ animationDuration: `${duration}ms` }}
    >
      {/* 4段目だけ、画面全体を一瞬白く飛ばす */}
      {grade.tier >= 4 ? <span className="hit-flash" aria-hidden /> : null}

      {/* 光条。2段目から回り始める */}
      {grade.tier >= 2 ? (
        <span
          className="hit-burst"
          aria-hidden
          style={{ animationDuration: `${duration}ms` }}
        />
      ) : null}

      {/* 紙吹雪。3段目から降る */}
      {confetti > 0 ? (
        <span className="hit-confetti" aria-hidden>
          {Array.from({ length: confetti }, (_, index) => (
            <i
              key={index}
              style={{
                left: `${(index * 97) % 100}%`,
                backgroundColor: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
                animationDelay: `${(index % 8) * 0.12}s`,
                animationDuration: `${1.6 + ((index * 7) % 10) / 10}s`,
              }}
            />
          ))}
        </span>
      ) : null}

      <div className="hit-word text-center">
        <p
          className={[
            'heat-text-5 leading-none',
            grade.tier >= 4 ? 'text-7xl' : grade.tier >= 3 ? 'text-6xl' : 'text-5xl',
          ].join(' ')}
        >
          {grade.label}
        </p>

        {returnedYen !== null ? (
          <p className="tnum mt-2 text-3xl font-black text-text-main">
            {formatYen(returnedYen)}
          </p>
        ) : null}

        <p className="mt-2 text-xl font-black text-text-main">{hits.length}点 的中</p>

        <ul className="tnum mt-3 space-y-1">
          {hits.slice(0, 4).map((hit) => (
            <li key={formatBet(hit)} className="text-base font-bold text-text-main">
              {formatBet(hit)}
            </li>
          ))}
          {hits.length > 4 ? (
            <li className="text-xs text-text-mute">ほか {hits.length - 4}点</li>
          ) : null}
        </ul>

        {returnedYen === null ? (
          <p className="mt-3 text-xs text-text-mute">配当はレース確定後に入ります</p>
        ) : null}
      </div>
    </div>
  );
}
