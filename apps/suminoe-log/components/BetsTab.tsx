'use client';

/**
 * 買い目タブ。
 *
 * スミノエ・リードが出した出走表データを取り込み、賭式ごとの買い目を出す。
 * 当日の記録が溜まってきたら、実測のコース別1着率を混ぜて相手の評価を補正する。
 *
 * **推奨ではなく型の提示に留める。** 控除率25%の前提を画面から消さない。
 */

import { useMemo, useState } from 'react';

import { ORDERED_KEYS, buildSuggestion, formatTicket, type BetPlan } from '@/lib/betting';
import { COURSE_FIRST_RATE } from '@/lib/baseline';
import type { CardRace, RaceCard } from '@/lib/raceCard';
import { reviewPlans } from '@/lib/review';
import type { ResultDay } from '@/lib/results';
import { BOAT_COLORS, type Boat } from '@/lib/types';

import { RaceOutcome } from './RaceOutcome';

interface BetsTabProps {
  card: RaceCard | null;
  /** 当日実測のコース別1着率（母数が少ないうちは使われない） */
  actualCourseRates: Partial<Record<Boat, number | null>>;
  resultCount: number;
  /** レース終了後に取り込まれる公式の結果。まだ出ていなければ null */
  results: ResultDay | null;
  /** 記録タブで選んでいるレース番号。切り替わったらこちらも追従する */
  focusRaceNo: number;
  /** そのレースで「展示が速い」と見た艇を返す（現地の直前情報） */
  tenjiFastFor: (raceNo: number) => Boat | null;
  onImport: (raw: string) => void;
  onClearCard: () => void;
  importError: string | null;
  /** 過去日の閲覧中。取り込み・クリアなどの操作を出さない */
  readOnly?: boolean;
}

export function BetsTab({
  card,
  actualCourseRates,
  resultCount,
  results,
  focusRaceNo,
  tenjiFastFor,
  onImport,
  onClearCard,
  importError,
  readOnly = false,
}: BetsTabProps) {
  const [pasted, setPasted] = useState('');
  const [selectedRaceNo, setSelectedRaceNo] = useState<number>(focusRaceNo);

  /**
   * 記録タブのレース番号に追従する。現地では記録しているレースの買い目を見るのが自然。
   * このタブで別のレースを選んだ場合は、次に記録タブが動くまでその選択を保つ。
   *
   * props の変化で state を作り直す場面なので、effect ではなく
   * レンダー中に前回値と比べて同期する（React が推奨する形）。
   */
  const [lastFocus, setLastFocus] = useState(focusRaceNo);
  if (focusRaceNo !== lastFocus) {
    setLastFocus(focusRaceNo);
    setSelectedRaceNo(focusRaceNo);
  }

  const race = useMemo<CardRace | null>(() => {
    if (!card) return null;
    return card.races.find((entry) => entry.raceNo === selectedRaceNo) ?? card.races[0] ?? null;
  }, [card, selectedRaceNo]);

  const suggestion = useMemo(
    () =>
      race
        ? buildSuggestion(race, actualCourseRates, resultCount, tenjiFastFor(race.raceNo))
        : null,
    [race, actualCourseRates, resultCount, tenjiFastFor],
  );

  /** 結果データが同じ日付で、そのレースが終わっていれば突き合わせる */
  const outcome = useMemo(() => {
    if (!race || !suggestion || !results || !card) return null;
    if (results.date !== card.date) return null;
    const resultRace = results.races.find((entry) => entry.raceNo === race.raceNo);
    if (!resultRace || !resultRace.ok) return null;
    return { resultRace, outcomes: reviewPlans(suggestion.plans, resultRace) };
  }, [race, suggestion, results, card]);

  /** 結果が確定しているレース番号（選択ボタンに印を出す） */
  const finishedRaceNos = useMemo(() => {
    if (!results || !card || results.date !== card.date) return new Set<number>();
    return new Set(results.races.filter((race) => race.ok).map((race) => race.raceNo));
  }, [results, card]);

  if (!card) {
    if (readOnly) {
      return (
        <div className="space-y-3 pb-20">
          <p className="rounded-xl border border-line bg-bg-panel p-6 text-center text-sm text-text-mute">
            この日の出走表・結果は取得できませんでした。オンラインで開くと見られます。
          </p>
        </div>
      );
    }
    return (
      <div className="space-y-3 pb-20">
        <section className="rounded-xl border border-line bg-bg-panel p-4">
          <h2 className="text-base font-bold text-text-main">出走表データを取り込む</h2>
          <ol className="mt-2 space-y-1 text-sm text-text-mute">
            <li>1. パソコンで スミノエ・リード を実行する</li>
            <li>
              2. <code className="text-text-main">output/suminoe_20260809.json</code> の中身を全部コピー
            </li>
            <li>3. 下の枠に貼り付けて「取り込む」を押す</li>
          </ol>
          <p className="mt-2 text-xs text-text-mute">
            一度取り込めば端末に保存されるので、現地ではオフラインでも見られます。
          </p>
          <textarea
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
            rows={6}
            placeholder='{"schemaVersion":1,...}'
            className="mt-3 w-full rounded-lg border border-line bg-bg-raised p-2 text-xs text-text-main placeholder:text-text-mute"
          />
          {importError ? (
            <p role="alert" className="mt-2 text-sm font-bold text-accent">
              {importError}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => onImport(pasted)}
            disabled={pasted.trim() === ''}
            className="on-accent mt-3 min-h-14 w-full rounded-xl bg-accent text-base font-black disabled:bg-bg-raised disabled:text-text-mute"
          >
            取り込む
          </button>
        </section>

        <Disclaimer />
      </div>
    );
  }

  if (!race) {
    return (
      <div className="space-y-3 pb-20">
        <section className="rounded-xl border border-line bg-bg-panel p-4">
          <p className="text-sm text-text-main">
            取り込んだデータにレースが見つかりませんでした。
          </p>
          {readOnly ? null : (
            <button
              type="button"
              onClick={onClearCard}
              className="mt-3 min-h-12 rounded-lg border border-line px-4 text-sm font-bold text-text-mute"
            >
              取り込んだ出走表を消して、やり直す
            </button>
          )}
        </section>
        <Disclaimer />
      </div>
    );
  }

  return (
    <div className="space-y-3 pb-20">
      {/* レース選択 */}
      <section className="rounded-xl border border-line bg-bg-panel p-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-bold text-text-mute">レースを選ぶ</h2>
          <p className="text-xs text-text-mute">{card.date}</p>
        </div>
        <div className="mt-2 grid grid-cols-6 gap-2">
          {card.races.map((entry) => {
            const isActive = race.raceNo === entry.raceNo;
            return (
              <button
                key={entry.raceNo}
                type="button"
                aria-pressed={isActive}
                aria-label={`${entry.raceNo}R ${entry.verdict ?? ''}`}
                onClick={() => setSelectedRaceNo(entry.raceNo)}
                className={[
                  'min-h-14 rounded-lg border pt-1',
                  isActive
                    ? 'border-accent bg-bg-raised'
                    : 'border-line bg-bg-raised/40',
                ].join(' ')}
              >
                <span
                  className={[
                    'tnum block text-base font-bold',
                    isActive ? 'text-text-main' : 'text-text-mute',
                  ].join(' ')}
                >
                  {entry.raceNo}
                </span>
                <span aria-hidden className="mt-0.5 block text-[10px] leading-tight">
                  {entry.verdict === '勝負' ? (
                    <span className="font-bold text-accent">勝負</span>
                  ) : entry.verdict === '見送り' ? (
                    <span className="text-text-mute">見送</span>
                  ) : (
                    <span className="text-text-mute">標準</span>
                  )}
                </span>
                {finishedRaceNos.has(entry.raceNo) ? (
                  <span aria-hidden className="mx-auto mt-0.5 block h-1 w-1 rounded-full bg-accent" />
                ) : null}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[10px] text-text-mute">
          勝負={card.races.filter((entry) => entry.verdict === '勝負').length}件 / 標準=
          {card.races.filter((entry) => entry.verdict === '標準').length}件 / 見送り=
          {card.races.filter((entry) => entry.verdict === '見送り').length}件
        </p>
      </section>

      {/* レースの判定 */}
      <section className="rounded-xl border border-line bg-bg-panel p-4">
        <div className="flex items-baseline gap-2">
          <h2 className="tnum text-2xl font-black text-text-main">{race.raceNo}R</h2>
          <span className="text-sm text-text-main">{race.name}</span>
          <span className="ml-auto text-sm text-text-mute">締切 {race.deadline}</span>
        </div>

        {race.ok ? (
          <>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <VerdictBadge verdict={race.verdict} />
              <span className="text-sm text-text-mute">
                イン信頼度 <strong className="text-text-main">{race.inConfidence ?? '—'}</strong>
              </span>
              <span className="text-sm text-text-mute">
                波乱リスク <strong className="text-text-main">{race.upsetRisk ?? '—'}</strong>
              </span>
            </div>
            {race.verdictReason ? (
              <p className="mt-2 text-sm text-text-main">{race.verdictReason}</p>
            ) : null}
            {race.inReason ? (
              <p className="mt-1 text-xs text-text-mute">イン: {race.inReason}</p>
            ) : null}
            {race.upsetReason ? (
              <p className="mt-1 text-xs text-text-mute">波乱: {race.upsetReason}</p>
            ) : null}
            {race.motorPicks.length > 0 ? (
              <p className="mt-2 text-xs text-text-main">
                モーター注目:{' '}
                {race.motorPicks
                  .map((pick) => `${pick.teiban}号艇 ${pick.motorNiritsu.toFixed(1)}%`)
                  .join(' / ')}
              </p>
            ) : null}
            {race.notes.map((note) => (
              <p key={note} className="mt-1 text-xs text-text-mute">
                ※ {note}
              </p>
            ))}
          </>
        ) : (
          <p className="mt-2 text-sm text-accent">このレースの出走表は取得できていません。</p>
        )}
      </section>

      {/* 出走表 */}
      {race.ok ? <RaceCardTable race={race} anchor={suggestion ? suggestion.anchor : null} /> : null}

      {/* 補正の説明 */}
      {suggestion ? (
        <section className="rounded-xl border border-line bg-bg-panel p-3">
          <h2 className="text-sm font-bold text-text-mute">買い目の組み立て方</h2>
          <p className="mt-1 text-xs text-text-main">
            軸は <strong>{suggestion.anchor}号艇</strong>、相手は{' '}
            {suggestion.partners.slice(0, 3).join('・')}号艇 の順で評価しています。
          </p>
          <p className="mt-1 text-xs text-text-mute">
            {suggestion.actualWeight === 0
              ? `コース別1着率は住之江の基準値を使っています（当日の記録が${
                  3 - resultCount > 0 ? `あと${3 - resultCount}件` : '3件'
                }たまると実測を混ぜます）。`
              : `当日の実測を ${Math.round(suggestion.actualWeight * 100)}% 混ぜて補正しています（母数 ${resultCount} レース）。`}
          </p>
          {suggestion.tenjiFast !== null ? (
            <p className="mt-2 rounded-lg border border-accent bg-bg-raised px-2 py-1.5 text-xs text-text-main">
              <strong className="text-accent">展示を反映中</strong>：
              記録タブで「展示が速そう」と選んだ{suggestion.tenjiFast}号艇の評価を上げています。
              現地で見た直前の情報なので、事前の分析より新しい材料です。
            </p>
          ) : null}
          {suggestion.anchorNote ? (
            <p className="mt-2 text-xs font-bold text-accent">{suggestion.anchorNote}</p>
          ) : null}
        </section>
      ) : null}

      {/* 結果が出ていれば、買い目より先に見せる（振り返りが目的なので） */}
      {outcome ? (
        <RaceOutcome race={outcome.resultRace} outcomes={outcome.outcomes} />
      ) : null}

      {/* 見送り判定なら、まず「買わない」を選択肢として提示する */}
      {race.verdict === '見送り' ? (
        <section className="rounded-xl border border-line bg-bg-panel p-4">
          <h2 className="text-base font-bold text-text-main">このレースは見送りが基本</h2>
          <p className="mt-1 text-sm text-text-mute">
            1号艇のセオリーが通じず、狙いが立てにくいレースです。
            <strong className="text-text-main">買わずに見るのも十分な選択</strong>
            です。下の買い目は「それでも買うなら」という前提の型です。
          </p>
        </section>
      ) : null}

      {/* 賭式ごとの買い目 */}
      {suggestion ? (
        <div className="space-y-3">
          {[...suggestion.plans]
            .sort((a, b) => Number(b.primary) - Number(a.primary))
            .map((plan) => (
              <BetPlanCard key={plan.key} plan={plan} verdict={race.verdict} />
            ))}
        </div>
      ) : null}

      <Disclaimer />

      {readOnly ? null : (
        <div className="pt-4 text-center">
          <button
            type="button"
            onClick={onClearCard}
            className="min-h-11 rounded px-3 py-2 text-xs text-text-mute underline"
          >
            取り込んだ出走表を消す
          </button>
        </div>
      )}
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict: CardRace['verdict'] }) {
  if (verdict === null) return null;
  const style =
    verdict === '勝負'
      ? 'on-accent bg-accent'
      : verdict === '見送り'
        ? 'bg-bg-deep text-text-mute border border-line'
        : 'bg-bg-raised text-text-main border border-line';
  return <span className={`rounded px-2 py-1 text-sm font-black ${style}`}>{verdict}</span>;
}

function RaceCardTable({ race, anchor }: { race: CardRace; anchor: Boat | null }) {
  return (
    <section className="rounded-xl border border-line bg-bg-panel p-3">
      <h2 className="text-sm font-bold text-text-mute">出走表</h2>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[22rem] text-xs">
          <thead>
            <tr className="text-text-mute">
              <th className="w-8 pb-1 text-left font-normal">枠</th>
              <th className="pb-1 text-left font-normal">選手</th>
              <th className="pb-1 text-right font-normal">級別</th>
              <th className="pb-1 text-right font-normal">当地</th>
              <th className="pb-1 text-right font-normal">全国</th>
              <th className="pb-1 text-right font-normal">M2率</th>
            </tr>
          </thead>
          <tbody>
            {race.boats.map((boat) => {
              const color = BOAT_COLORS[boat.teiban];
              return (
                <tr key={boat.teiban} className="border-t border-line">
                  <td className="py-1.5">
                    <span
                      style={{ backgroundColor: color.bg, color: color.fg }}
                      className="tnum flex h-6 w-6 items-center justify-center rounded text-xs font-black ring-1 ring-line"
                    >
                      {boat.teiban}
                    </span>
                  </td>
                  <td className="py-1.5 text-text-main">
                    {boat.name}
                    {anchor === boat.teiban ? (
                      <span className="ml-1 text-[10px] font-bold text-accent">軸</span>
                    ) : null}
                  </td>
                  <td className="py-1.5 text-right text-text-main">{boat.kyubetsu}</td>
                  <td className="tnum py-1.5 text-right text-text-main">
                    {boat.noTouchiData ? '実績なし' : boat.touchiShoritsu.toFixed(2)}
                  </td>
                  <td className="tnum py-1.5 text-right text-text-mute">
                    {boat.zenkokuShoritsu.toFixed(2)}
                  </td>
                  <td className="tnum py-1.5 text-right text-text-mute">
                    {boat.motorNiritsu.toFixed(1)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10px] text-text-mute">
        住之江は枠なり進入がほぼ確定（1枠→1コース100.0%）。枠番＝進入コースとして扱っています。
        基準の1コース1着率は {COURSE_FIRST_RATE[1]}%。
      </p>
    </section>
  );
}

function BetPlanCard({ plan, verdict }: { plan: BetPlan; verdict: CardRace['verdict'] }) {
  const ordered = ORDERED_KEYS.has(plan.key);
  return (
    <section
      className={[
        'rounded-xl border p-4',
        plan.primary ? 'border-accent bg-bg-panel' : 'border-line bg-bg-panel/60',
      ].join(' ')}
    >
      <div className="flex items-baseline gap-2">
        <h3 className="text-base font-bold text-text-main">{plan.name}</h3>
        {plan.primary ? (
          <span className="on-accent rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold">
            {verdict === '見送り' ? '当たりやすさ重視' : 'この判定の定石'}
          </span>
        ) : null}
        <span className="tnum ml-auto text-sm text-text-mute">{plan.points}点</span>
      </div>

      <p className="mt-1 text-xs text-text-mute">{plan.hitCondition}</p>

      <p className="tnum mt-3 text-lg font-black text-text-main">{plan.formation}</p>

      <ul className="mt-2 flex flex-wrap gap-1.5">
        {plan.tickets.map((ticket) => (
          <li
            key={ticket.join('-')}
            className="tnum rounded border border-line bg-bg-raised px-2 py-1 text-sm font-bold text-text-main"
          >
            {formatTicket(ticket, ordered)}
          </li>
        ))}
      </ul>

      <p className="mt-2 text-[11px] text-text-mute">向くとき: {plan.suitedFor}</p>
    </section>
  );
}

function Disclaimer() {
  return (
    <section className="rounded-xl border border-line bg-bg-deep p-3">
      <p className="text-xs leading-relaxed text-text-mute">
        <strong className="text-text-main">これは推奨ではありません。</strong>
        舟券の控除率は約25%あり、データ分析でそれを覆すことは想定していません。
        ここに出しているのは「その賭式で買うならこういう組み方が定石」という型です。
        当たることを保証するものではなく、金額の判断もしません。無理のない範囲で楽しんでください。
      </p>
    </section>
  );
}
