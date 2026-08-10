'use client';

/**
 * 的中したときの演出。
 *
 * **素材の質より段取り。** パチンコが派手に感じるのは絵の出来より
 * 「溜めて、煽って、確定する」流れによる。ここもその順で組んである
 * （時間の設計は `globals.css` の `.hit-overlay` 付近）。
 *
 *   暗転 → 閃光 → 予告（高配当以上）→ ラベルが伸びる → 金額が回る → 集中線と紙吹雪
 *
 * **配当の大きさで段が変わる。** 100円が110円になったのと、1万円が返ってきたのを
 * 同じ演出で祝うと、どちらも軽くなる。
 *
 * **外れたときには何も出さない。** パチンコの煽りは次を打たせるための仕組みで、
 * ここは記録の道具なので持ち込まない。
 *
 * 操作を邪魔しないよう `pointer-events: none` を敷いてある。
 * `prefers-reduced-motion` では globals.css 側で動きが止まり、静止画として出る。
 */

import { useEffect, useState } from 'react';

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
const DURATION_BY_TIER = [0, 2600, 3400, 4400, 5400] as const;

/** 紙吹雪の枚数。段で増やす */
const CONFETTI_BY_TIER = [0, 0, 16, 28, 44] as const;

const CONFETTI_COLORS = ['#ff2d55', '#ff9500', '#ffd60a', '#34c759', '#0a84ff', '#bf5af2'];

/** 金額が回り始めるまでの間（CSS の `.hit-amount` の遅延と合わせる） */
const COUNT_START_MS = 1100;
const COUNT_DURATION_MS = 900;

/**
 * 金額を 0 から実額まで回す。
 *
 * **これがいちばん「当たった感じ」になる。** 数字が確定するまでの1秒弱に、
 * 見ている側の期待が乗る。終わりは必ず実額ちょうどで止める（丸めない）。
 */
function useCountUp(target: number | null, token: number): number | null {
  const [value, setValue] = useState<number | null>(target === null ? null : 0);

  // 新しい的中が来たら 0 に戻す。effect ではなくレンダー中に同期する
  const [lastToken, setLastToken] = useState(token);
  if (token !== lastToken) {
    setLastToken(token);
    setValue(target === null ? null : 0);
  }

  useEffect(() => {
    if (target === null) return;
    let frame = 0;
    let start = 0;
    const tick = (now: number) => {
      if (start === 0) start = now;
      const elapsed = now - start - COUNT_START_MS;
      if (elapsed < 0) {
        frame = requestAnimationFrame(tick);
        return;
      }
      const ratio = Math.min(1, elapsed / COUNT_DURATION_MS);
      // 終わりに向かって減速させる。最後の桁が決まる瞬間が見える
      const eased = 1 - (1 - ratio) ** 3;
      setValue(Math.round(target * eased));
      if (ratio < 1) frame = requestAnimationFrame(tick);
      else setValue(target);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, token]);

  return value;
}

/**
 * 集中線。中心へ向かう楔を放射状に並べる。
 * **画像を持たない。** SVG なので数KBで済み、どの画面サイズでも滲まない。
 */
function SpeedLines({ count }: { count: number }) {
  const wedges = Array.from({ length: count }, (_, index) => {
    const angle = (360 / count) * index;
    // 楔の太さを交互に変えると、均一な放射より線が立つ
    const width = index % 2 === 0 ? 2.4 : 1.1;
    const rad = (deg: number) => (deg * Math.PI) / 180;
    const inner = 22;
    const outer = 100;
    const x1 = Math.cos(rad(angle - width)) * outer;
    const y1 = Math.sin(rad(angle - width)) * outer;
    const x2 = Math.cos(rad(angle + width)) * outer;
    const y2 = Math.sin(rad(angle + width)) * outer;
    const xi = Math.cos(rad(angle)) * inner;
    const yi = Math.sin(rad(angle)) * inner;
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} L ${x2.toFixed(2)} ${y2.toFixed(2)} L ${xi.toFixed(2)} ${yi.toFixed(2)} Z`;
  });

  return (
    <svg className="hit-lines" viewBox="-100 -100 200 200" aria-hidden preserveAspectRatio="none">
      {wedges.map((d, index) => (
        <path key={index} d={d} fill="currentColor" />
      ))}
    </svg>
  );
}

export function HitCelebration({
  hits,
  multiples = [],
  returnedYen = null,
  token,
  onDone,
}: HitCelebrationProps) {
  const grade = bestGrade(multiples.length > 0 ? multiples : hits.map(() => null));
  const duration = DURATION_BY_TIER[grade.tier] ?? 2600;
  const counted = useCountUp(hits.length > 0 ? returnedYen : null, token);

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
      <span className="hit-flash" aria-hidden />

      {/* 予告。高配当以上のときだけ、確定の前に虹が一度走る */}
      {grade.tier >= 3 ? <span className="hit-tease" aria-hidden /> : null}

      {grade.tier >= 2 ? <span className="hit-burst" aria-hidden /> : null}
      {grade.tier >= 2 ? <SpeedLines count={grade.tier >= 4 ? 48 : 32} /> : null}

      {confetti > 0 ? (
        <span className="hit-confetti" aria-hidden>
          {Array.from({ length: confetti }, (_, index) => (
            <i
              key={index}
              style={{
                left: `${(index * 97) % 100}%`,
                backgroundColor: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
                animationDelay: `${1.3 + (index % 8) * 0.12}s`,
                animationDuration: `${1.6 + ((index * 7) % 10) / 10}s`,
              }}
            />
          ))}
        </span>
      ) : null}

      <div className="hit-word">
        <span
          className={[
            'hit-label heat-text-5 leading-none',
            grade.tier >= 4 ? 'text-7xl' : grade.tier >= 3 ? 'text-6xl' : 'text-5xl',
          ].join(' ')}
        >
          {grade.label}
        </span>

        {counted !== null ? (
          <span className="hit-amount tnum mt-3 text-4xl font-black text-text-main">
            {formatYen(counted)}
          </span>
        ) : null}

        <div className="hit-detail mt-3">
          <p className="text-lg font-black text-text-main">{hits.length}点 的中</p>
          <ul className="tnum mt-1.5 space-y-0.5">
            {hits.slice(0, 4).map((hit) => (
              <li key={formatBet(hit)} className="text-sm font-bold text-text-main">
                {formatBet(hit)}
              </li>
            ))}
            {hits.length > 4 ? (
              <li className="text-xs text-text-mute">ほか {hits.length - 4}点</li>
            ) : null}
          </ul>
          {returnedYen === null ? (
            <p className="mt-2 text-xs text-text-mute">配当はレース確定後に入ります</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
