'use client';

/**
 * 分からない言葉を、その場で開いて確認できるようにする。
 *
 * **用語そのものは残す。** 現地の電光掲示や実況で使われる言葉なので、
 * アプリだけ別の呼び方にすると現地で通じなくなる。意味を足すだけにする。
 *
 * 押すまで説明は出ない。常時出すと画面が説明で埋まって、
 * 分かっている人には邪魔になる（既定は分かりやすく、詳細は開けば出る）。
 */

import { useState } from 'react';

import { explain } from '@/lib/glossary';

interface TermProps {
  /** 辞書に載っている言葉。載っていなければただの文字として出す */
  children: string;
  /** 見た目を本文に合わせる（見出しの中で使うときなど） */
  plain?: boolean;
}

export function Term({ children, plain = false }: TermProps) {
  const [open, setOpen] = useState(false);
  const entry = explain(children);

  if (!entry) return <>{children}</>;

  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={`${children}の意味`}
        className={[
          'underline decoration-dotted underline-offset-2',
          plain ? '' : 'text-text-main',
        ].join(' ')}
      >
        {children}
        <span className="ml-0.5 align-super text-[9px] text-text-mute">?</span>
      </button>

      {open ? (
        <span
          role="note"
          className="absolute left-0 top-full z-20 mt-1 block w-60 border border-text-main bg-bg-panel p-2 text-[11px] font-normal leading-snug text-text-main shadow-lg"
        >
          <span className="block font-bold">{entry.term}</span>
          <span className="mt-0.5 block">{entry.short}</span>
          {entry.more ? (
            <span className="mt-1 block text-text-mute">{entry.more}</span>
          ) : null}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-1 block text-[11px] text-text-mute underline"
          >
            閉じる
          </button>
        </span>
      ) : null}
    </span>
  );
}
