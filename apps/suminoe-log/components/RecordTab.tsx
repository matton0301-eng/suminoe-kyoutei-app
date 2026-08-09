'use client';

/**
 * 記録タブ。1レース分を上から下へ流れるように入力する。
 * タップだけで20秒以内に終わることが最優先。
 *
 * レース番号は画面で最も大きい要素にし、静水面に映り込む鏡面反射を添えている
 * （住之江＝静水面の聖地。デザイン方針は globals.css の冒頭を参照）。
 */

import { useState, type Dispatch } from 'react';

import { formatResult } from '@/lib/aggregate';
import type { FormAction } from '@/lib/formReducer';
import type { CardRace } from '@/lib/raceCard';
import {
  KIMARITE_OPTIONS,
  MAX_RACE_NO,
  MIN_RACE_NO,
  RESULT_PLACES,
  SUIMEN_OPTIONS,
  type FormState,
  type RaceLog,
} from '@/lib/types';

import { BoatPicker } from './BoatPicker';

interface RecordTabProps {
  form: FormState;
  dispatch: Dispatch<FormAction>;
  lastLog: RaceLog | null;
  /** 選択中のレースの出走表。取り込んでいなければ null */
  race: CardRace | null;
  /** 締切までの残り時間（例「締切まで12分」）。対象レースでなければ null */
  deadlineLabel: string | null;
  /** 締切が近い（5分以内） */
  deadlineUrgent: boolean;
  onSave: () => void;
  onEditLast: () => void;
  onCancelEdit: () => void;
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-line bg-bg-panel px-2 py-3">
      <div className="rule-start">
        <h2 className="text-[13px] font-bold tracking-wide text-text-main">{title}</h2>
        {hint ? <p className="mt-0.5 text-[11px] leading-snug text-text-mute">{hint}</p> : null}
      </div>
      <div className="mt-3 space-y-2">{children}</div>
    </section>
  );
}

export function RecordTab({
  form,
  dispatch,
  lastLog,
  race,
  deadlineLabel,
  deadlineUrgent,
  onSave,
  onEditLast,
  onCancelEdit,
}: RecordTabProps) {
  const isEditing = form.editingId !== null;

  /**
   * 結果の2着・3着は折りたたむ。1着だけで保存する場面が多く、
   * 3行を開いたままだと保存ボタンまでのスクロールが1画面ぶん増える。
   *
   * 開いているかは state ではなく**派生値**で決める。
   * 1着か下位着が入っていれば開く（続けて入れる流れになる）。
   * それ以外は「2着・3着も入れる」を押したかどうか。
   */
  const [openedByUser, setOpenedByUser] = useState(false);
  const resultExpanded =
    openedByUser ||
    form.resultFirst !== null ||
    form.resultSecond !== null ||
    form.resultThird !== null;
  const raceLabel = (
    <>
      {form.raceNo}
      <span className="text-[2.25rem] text-text-mute">R</span>
    </>
  );

  return (
    <div className="space-y-3 pb-32">
      {isEditing ? (
        <div className="flex items-center justify-between rounded-xl border border-accent bg-bg-panel p-3">
          <p className="text-sm font-bold text-text-main">{form.raceNo}R を修正中</p>
          <button
            type="button"
            onClick={onCancelEdit}
            className="min-h-11 rounded-lg border border-line px-4 text-sm font-bold text-text-mute"
          >
            修正をやめる
          </button>
        </div>
      ) : null}

      {/* ① レース番号 — 画面の主役。水面に映り込ませる */}
      <section className="overflow-hidden rounded-xl border border-line bg-bg-panel px-2 pt-3">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            aria-label="レース番号を1つ戻す"
            disabled={form.raceNo <= MIN_RACE_NO}
            onClick={() => dispatch({ type: 'stepRaceNo', delta: -1 })}
            className="min-h-14 min-w-14 shrink-0 rounded-lg border border-line bg-bg-raised text-2xl font-black text-text-main disabled:opacity-25"
          >
            −
          </button>

          <div className="flex min-w-0 flex-col items-center">
            <p
              className="tnum text-[4.25rem] font-black leading-[0.85] tracking-tight text-text-main"
              aria-live="polite"
            >
              {raceLabel}
            </p>
            <p
              aria-hidden
              className="mirror tnum text-[4.25rem] font-black leading-[0.85] tracking-tight text-text-main"
            >
              {raceLabel}
            </p>
          </div>

          <button
            type="button"
            aria-label="レース番号を1つ進める"
            disabled={form.raceNo >= MAX_RACE_NO}
            onClick={() => dispatch({ type: 'stepRaceNo', delta: 1 })}
            className="min-h-14 min-w-14 shrink-0 rounded-lg border border-line bg-bg-raised text-2xl font-black text-text-main disabled:opacity-25"
          >
            ＋
          </button>
        </div>

        {race ? (
          <div className="-mt-3 pb-3 text-center">
            <p className="text-xs text-text-mute">
              {race.name || 'レース'}
              <span className="mx-1.5 text-line">|</span>
              締切 <span className="tnum text-text-main">{race.deadline}</span>
            </p>
            {deadlineLabel ? (
              <p
                className={[
                  'tnum mt-1 text-xs font-bold',
                  deadlineUrgent ? 'text-accent' : 'text-text-mute',
                ].join(' ')}
                aria-live="polite"
              >
                {deadlineLabel}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="pb-3" />
        )}
      </section>

      {/* ② 結果（2着・3着は折りたたむ） */}
      <Section title="結果" hint="同じ艇を選び直すと、前の行から自動で外れます">
        <BoatPicker
          label="結果 1着"
          rowLabel="1着"
          selected={form.resultFirst}
          onSelect={(boat) => dispatch({ type: 'setResult', place: 'resultFirst', boat })}
        />

        {resultExpanded ? (
          RESULT_PLACES.filter(({ key }) => key !== 'resultFirst').map(({ key, label }) => (
            <BoatPicker
              key={key}
              label={`結果 ${label}`}
              rowLabel={label}
              selected={form[key]}
              onSelect={(boat) => dispatch({ type: 'setResult', place: key, boat })}
            />
          ))
        ) : (
          <button
            type="button"
            onClick={() => setOpenedByUser(true)}
            className="min-h-12 w-full rounded-lg border border-line bg-bg-raised/40 text-sm font-bold text-text-mute"
          >
            2着・3着も入れる
          </button>
        )}
      </Section>

      {/* ⑤ 決まり手 */}
      <Section title="1着はどう決まった？">
        <div className="grid grid-cols-3 gap-2">
          {KIMARITE_OPTIONS.map(({ value, hint }) => {
            const isSelected = form.kimarite === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={isSelected}
                onClick={() => dispatch({ type: 'toggleKimarite', value })}
                className={[
                  'min-h-16 rounded-lg border px-2 py-2 text-left',
                  'transition-transform duration-100 motion-reduce:transition-none',
                  isSelected
                    ? 'scale-[1.03] border-accent bg-bg-raised'
                    : 'border-line bg-bg-raised/50',
                ].join(' ')}
              >
                <span
                  className={[
                    'block text-sm font-bold',
                    isSelected ? 'text-accent' : 'text-text-main',
                  ].join(' ')}
                >
                  {value}
                </span>
                <span className="mt-0.5 block text-[11px] leading-tight text-text-mute">
                  {hint}
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      {/* ⑥ 水面のメモ */}
      {/*
        元仕様の補足文は「2マークで艇が暴れてたか」だったが、競艇を知らないと
        2マークがどこか分からず判断できない。見たままで答えられる表現に変えた。
      */}
      <Section title="水面のメモ（任意）" hint="ターンで艇が波に跳ねたり流れたりしていたか">
        <div className="flex gap-2">
          {SUIMEN_OPTIONS.map((value) => {
            const isSelected = form.suimen === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={isSelected}
                onClick={() => dispatch({ type: 'toggleSuimen', value })}
                className={[
                  'min-h-14 flex-1 rounded-lg border text-base font-bold',
                  'transition-transform duration-100 motion-reduce:transition-none',
                  isSelected
                    ? 'scale-[1.03] border-accent bg-bg-raised text-accent'
                    : 'border-line bg-bg-raised/50 text-text-mute',
                ].join(' ')}
              >
                {value}
              </button>
            );
          })}
        </div>
        <label className="block">
          <span className="sr-only">気づいたこと</span>
          <input
            type="text"
            value={form.memo}
            onChange={(event) => dispatch({ type: 'setMemo', value: event.target.value })}
            placeholder="気づいたこと"
            className="min-h-14 w-full rounded-lg border border-line bg-bg-raised px-3 text-base text-text-main placeholder:text-text-mute"
          />
        </label>
      </Section>

      {/* ⑧ 直前の記録 */}
      {lastLog ? (
        <section className="rounded-xl border border-line bg-bg-panel px-2 py-3">
          <h2 className="rule-start text-[13px] font-bold tracking-wide text-text-mute">
            直前の記録
          </h2>
          <button
            type="button"
            onClick={onEditLast}
            className="mt-2 w-full rounded-lg border border-line bg-bg-raised p-3 text-left"
          >
            <div className="flex items-baseline gap-2">
              <span className="tnum text-xl font-black text-text-main">{lastLog.raceNo}R</span>
              <span className="tnum text-base text-text-main">{formatResult(lastLog)}</span>
              {lastLog.kimarite ? (
                <span className="text-sm text-text-mute">{lastLog.kimarite}</span>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-text-mute">タップして修正</p>
          </button>
        </section>
      ) : null}

      {/* ⑦ 保存ボタン */}
      <div className="fixed inset-x-0 bottom-14 z-10 border-t border-line bg-bg-deep/95 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto max-w-lg">
          <button
            type="button"
            onClick={onSave}
            className="on-accent min-h-14 w-full rounded-xl bg-accent text-lg font-black"
          >
            {isEditing ? 'この修正を保存する' : 'このレースを記録する'}
          </button>
        </div>
      </div>
    </div>
  );
}

