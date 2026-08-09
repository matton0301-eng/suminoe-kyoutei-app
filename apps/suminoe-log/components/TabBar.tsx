'use client';

/** 画面下部に固定するタブ。片手操作のため下に置く。 */

export const TABS = [
  // 現地でいちばん開くのは買い目。8/9 の観戦で記録タブはほとんど使われなかった
  { key: 'bets', label: '買い目' },
  { key: 'odds', label: 'オッズ' },
  { key: 'record', label: '記録' },
  { key: 'stats', label: '集計' },
  { key: 'tally', label: '収支' },
  { key: 'export', label: '書出' },
] as const;

export type TabKey = (typeof TABS)[number]['key'];

interface TabBarProps {
  active: TabKey;
  onChange: (tab: TabKey) => void;
}

export function TabBar({ active, onChange }: TabBarProps) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg-panel pb-[env(safe-area-inset-bottom)]"
      aria-label="画面切り替え"
    >
      <div className="mx-auto flex max-w-lg">
        {TABS.map((tab) => {
          const isActive = tab.key === active;
          return (
            <button
              key={tab.key}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onChange(tab.key)}
              className={[
                'flex-1 py-3 text-[13px] font-bold',
                isActive
                  ? 'border-t-2 border-accent text-text-main'
                  : 'border-t-2 border-transparent text-text-mute',
              ].join(' ')}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
