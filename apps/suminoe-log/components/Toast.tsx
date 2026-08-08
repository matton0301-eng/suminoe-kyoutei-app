'use client';

import { useEffect } from 'react';

interface ToastProps {
  message: string | null;
  onDismiss: () => void;
  durationMs?: number;
}

/** 保存完了などを短く知らせる。アニメーションはこれと選択スケールのみ。 */
export function Toast({ message, onDismiss, durationMs = 2000 }: ToastProps) {
  useEffect(() => {
    if (message === null) return;
    const timer = window.setTimeout(onDismiss, durationMs);
    return () => window.clearTimeout(timer);
  }, [message, durationMs, onDismiss]);

  if (message === null) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-28 z-30 flex justify-center px-4 motion-safe:animate-[toast-in_150ms_ease-out]"
    >
      <p className="rounded-full border border-line bg-bg-raised px-5 py-3 text-base font-bold text-text-main shadow-lg">
        {message}
      </p>
    </div>
  );
}
