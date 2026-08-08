'use client';

/**
 * 書き出しタブ。テキスト／CSVをクリップボードへ。
 *
 * Android の一部環境では navigator.clipboard が使えないため、
 * 失敗時は全文選択済みの textarea を出して手動コピーへ誘導する。
 */

import { useRef, useState } from 'react';

import { copyToClipboard } from '@/lib/exporters';

type Mode = 'text' | 'csv';

interface ExportTabProps {
  text: string;
  csv: string;
  hasLogs: boolean;
  onRequestClearAll: () => void;
  onToast: (message: string) => void;
  /** 過去日の閲覧中。全消去ボタンを出さない */
  readOnly?: boolean;
}

export function ExportTab({
  text,
  csv,
  hasLogs,
  onRequestClearAll,
  onToast,
  readOnly = false,
}: ExportTabProps) {
  const [mode, setMode] = useState<Mode>('text');
  const [needsManualCopy, setNeedsManualCopy] = useState(false);
  const manualRef = useRef<HTMLTextAreaElement>(null);

  const content = mode === 'text' ? text : csv;

  const handleCopy = async () => {
    const result = await copyToClipboard(content);
    if (result === 'copied') {
      setNeedsManualCopy(false);
      onToast(mode === 'text' ? 'テキストをコピーしました' : 'CSVをコピーしました');
      return;
    }
    // フォールバック: 全文を選択した状態で見せる
    setNeedsManualCopy(true);
    window.setTimeout(() => {
      const node = manualRef.current;
      if (!node) return;
      node.focus();
      node.select();
    }, 0);
  };

  return (
    <div className="space-y-3 pb-20">
      <div className="flex gap-2">
        {(
          [
            { key: 'text', label: 'テキスト' },
            { key: 'csv', label: 'CSV' },
          ] as const
        ).map((option) => {
          const isActive = mode === option.key;
          return (
            <button
              key={option.key}
              type="button"
              aria-pressed={isActive}
              onClick={() => {
                setMode(option.key);
                setNeedsManualCopy(false);
              }}
              className={[
                'min-h-14 flex-1 rounded-lg border text-base font-bold',
                isActive
                  ? 'border-accent bg-bg-raised text-text-main'
                  : 'border-line bg-bg-panel text-text-mute',
              ].join(' ')}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={handleCopy}
        disabled={!hasLogs}
        className="on-accent min-h-14 w-full rounded-xl bg-accent text-lg font-black disabled:bg-bg-raised disabled:text-text-mute"
      >
        {mode === 'text' ? 'テキストをコピー' : 'CSVをコピー'}
      </button>

      {needsManualCopy ? (
        <div className="rounded-xl border border-accent bg-bg-panel p-3">
          <p className="text-sm font-bold text-text-main">
            自動コピーができませんでした。下の枠を長押しして「コピー」を選んでください。
          </p>
          <textarea
            ref={manualRef}
            readOnly
            value={content}
            rows={10}
            className="mt-2 w-full rounded-lg border border-line bg-bg-raised p-2 text-xs text-text-main"
          />
        </div>
      ) : null}

      <section className="rounded-xl border border-line bg-bg-panel p-3">
        <h2 className="text-sm font-bold text-text-mute">プレビュー</h2>
        <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-bg-deep p-3 text-xs leading-relaxed text-text-main">
          {content}
        </pre>
      </section>

      {/* 全記録を消す: 誤操作防止のため小さく目立たない配置。過去日の閲覧中は出さない */}
      {readOnly ? null : (
        <div className="pt-6 text-center">
          <button
            type="button"
            onClick={onRequestClearAll}
            disabled={!hasLogs}
            className="min-h-11 rounded px-3 py-2 text-xs text-text-mute underline disabled:opacity-40"
          >
            全記録を消す
          </button>
        </div>
      )}
    </div>
  );
}
