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
import { betKey, formatYen, hitsByOrder } from '@/lib/bets';
import { ticketState } from '@/lib/ticketState';
import type { ResultRace } from '@/lib/results';
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

import { BetBuilder } from './BetBuilder';
import { TicketCard } from './TicketCard';
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
  /**
   * レースを移る。入力途中の内容は移る前にそのレースへ保存される。
   * dispatch で raceNo だけを変えてはいけない（前のレースの「見」が波及する）。
   */
  onChangeRace: (raceNo: number) => void;
  /** そのレースの公式結果。払戻が確定していれば金額まで出せる */
  resultRace: ResultRace | null;
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
  onChangeRace,
  resultRace,
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

      {/* ① レース番号 — 画面の主役 */}
      <section className="overflow-hidden rounded-xl border border-line bg-bg-panel px-2 pt-3">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            aria-label="レース番号を1つ戻す"
            disabled={form.raceNo <= MIN_RACE_NO}
            onClick={() => onChangeRace(form.raceNo - 1)}
            className="min-h-14 min-w-14 shrink-0 rounded-lg border border-line bg-bg-raised text-2xl font-black text-text-main disabled:opacity-25"
          >
            −
          </button>

          {/* 鏡面反射は水面デザインの署名要素だった。新聞に映り込みは無いので外した */}
          <div className="flex min-w-0 flex-col items-center">
            <p
              className="tnum text-[4.25rem] font-black leading-[0.85] tracking-tight text-text-main"
              aria-live="polite"
            >
              {raceLabel}
            </p>
          </div>

          <button
            type="button"
            aria-label="レース番号を1つ進める"
            disabled={form.raceNo >= MAX_RACE_NO}
            onClick={() => onChangeRace(form.raceNo + 1)}
            className="min-h-14 min-w-14 shrink-0 rounded-lg border border-line bg-bg-raised text-2xl font-black text-text-main disabled:opacity-25"
          >
            ＋
          </button>
        </div>

        {/*
          以前は鏡面反射の像が下に伸びていたので、負のマージンで詰めていた。
          鏡面を外した今そのままにすると、レース番号にレース名が食い込む。
        */}
        {race ? (
          <div className="mt-2 pb-3 text-center">
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

      {/*
        ② 買った舟券。**ここが記録タブの主役。**
        8/9 の観戦では着順の手入力がほとんど使われなかった（夜に自動で入るため）。
        代わりに「券種ごとに何をいくら買ったか」を残せることが本当に要る機能だった。
      */}
      <Section
        title="買った舟券"
        hint="券種を選び、艇を押して組みます。買い目タブの「この◯点を買った」でも入ります"
      >
        {!form.ken ? <BetBuilder onAdd={(bet) => dispatch({ type: 'addBets', bets: [bet] })} /> : null}

        {form.bets.length === 0 ? (
          <p className="pb-1 text-xs text-text-mute">
            {form.ken
              ? 'このレースは見（ケン）で記録します。'
              : 'まだ登録がありません。買わずに見るなら下の「見（ケン）」を押してください。'}
          </p>
        ) : (
          <ul className="space-y-1.5 pb-1">
            <li className="pt-1 text-[11px] text-text-mute">買った舟券</li>
            {form.bets.map((bet, index) => {
              const order = [form.resultFirst, form.resultSecond, form.resultThird];
              const hit = hitsByOrder([bet], order).length > 0;
              return (
                <TicketCard
                  key={`${betKey(bet)}-${index}`}
                  bet={bet}
                  state={ticketState(bet, order, resultRace, hit)}
                  onRemove={() => dispatch({ type: 'removeBet', index })}
                />
              );
            })}
          </ul>
        )}

        <div className="flex items-baseline gap-2 pb-1">
          {/*
            買った舟券があるうちは「見」にできない。
            押せてしまうと、記録した舟券が1タップで消える（金額の記録なので取り返しがつかない）。
            見送りに変えたいなら、上の「消す」で1点ずつ外してから押す。
          */}
          <button
            type="button"
            onClick={() => dispatch({ type: 'toggleKen' })}
            aria-pressed={form.ken}
            disabled={form.bets.length > 0}
            className={[
              'min-h-11 border px-3 text-sm font-bold',
              form.ken ? 'on-accent border-accent bg-accent' : 'border-line text-text-mute',
              form.bets.length > 0 ? 'opacity-40' : '',
            ].join(' ')}
          >
            見（ケン）
          </button>
          {form.bets.length > 0 ? (
            <span className="tnum ml-auto text-sm text-text-main">
              計 {formatYen(form.bets.reduce((sum, bet) => sum + bet.amountYen, 0))}
            </span>
          ) : null}
        </div>
        {form.bets.length > 0 ? (
          <p className="text-[11px] text-text-mute">
            買った舟券があるので「見」にはできません。見送りに直すなら、上の「消す」で外してください。
          </p>
        ) : null}
      </Section>

      {/* ③ 結果（2着・3着は折りたたむ） */}
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

