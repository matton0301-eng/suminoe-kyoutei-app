'use client';

/**
 * 明るい水面（light）とナイターの水面（dark）を切り替える。
 *
 * 既定は light。ただし元仕様の要件どおり、薄暗い観客席では画面がまぶしくなるため、
 * 現地で dark に切り替えられるようにしている。選択は localStorage に残す。
 *
 * テーマは `<html data-theme="dark">` で表現し、色は CSS 変数で切り替わる
 * （globals.css）。初回描画のちらつきを避けるため、layout.tsx で保存値を
 * 先に読んで属性を当てている。
 */

import { useState } from 'react';

const STORAGE_KEY = 'suminoe-theme';

type Theme = 'light' | 'dark';

function readTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function ThemeToggle() {
  // 初期値は DOM から読む（layout.tsx のインラインスクリプトが先に当てている）
  const [theme, setTheme] = useState<Theme>(readTheme);

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // 保存できなくても表示は切り替わる
    }
  };

  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={isDark}
      // ナイターで使う機能なので、何のためかを文字で示す
      // 水面の上に乗るので下地を敷く。透明だと艇や飛沫が文字に重なって読めない
      className="min-h-11 rounded-lg border border-line bg-bg-deep/85 px-2.5 text-[11px] font-bold text-text-mute backdrop-blur-sm"
    >
      {isDark ? '昼の画面' : '夜の画面'}
    </button>
  );
}
