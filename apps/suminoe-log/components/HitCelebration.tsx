'use client';

/**
 * 的中したときの演出。
 *
 * 保存した瞬間に一度だけ流し、2.6秒で自分から消える。
 * **操作を邪魔しない**ように `pointer-events: none` を敷いてあるので、
 * 演出中でも次のレースの入力に移れる。
 *
 * 金額はここで出さない。現地では公式の払戻がまだ来ていないため
 * （的中したことだけが分かる）。金額はレース確定後に収支タブへ入る。
 */

import { useEffect } from 'react';

import { formatBet, type Bet } from '@/lib/bets';

interface HitCelebrationProps {
  /** 当たった買い目。空なら何も出さない */
  hits: Bet[];
  /** 演出の識別子。変わるたびに1回流す */
  token: number;
  onDone: () => void;
}

const DURATION_MS = 2600;

export function HitCelebration({ hits, token, onDone }: HitCelebrationProps) {
  // 消えるタイミングは親が hits を空にすることで決まる。
  // ここで表示状態を持つと、effect の中で state を触ることになる
  useEffect(() => {
    if (hits.length === 0) return;
    const timer = window.setTimeout(onDone, DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [token, hits.length, onDone]);

  if (hits.length === 0) return null;

  return (
    <div className="hit-overlay" role="status" aria-live="assertive">
      <span className="hit-burst" aria-hidden />
      <div className="hit-word text-center">
        <p className="heat-text-5 text-6xl">的中</p>
        <p className="mt-2 text-2xl font-black text-text-main">
          {hits.length}点 的中しました
        </p>
        <ul className="tnum mt-3 space-y-1">
          {hits.slice(0, 4).map((hit) => (
            <li key={formatBet(hit)} className="text-base font-bold text-text-main">
              {formatBet(hit)}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-text-mute">
          配当はレース確定後に収支タブへ入ります
        </p>
      </div>
    </div>
  );
}
