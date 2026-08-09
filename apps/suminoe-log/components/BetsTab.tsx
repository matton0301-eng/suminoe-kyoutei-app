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

import {
  fastestTenji,
  findTenjiRace,
  formatStartTiming,
  formatTenjiWeather,
  tenjiNotes,
  type TenjiDay,
  type TenjiRace,
} from '@/lib/beforeInfo';
import { ORDERED_KEYS, buildSuggestion, formatTicket, type BetPlan } from '@/lib/betting';
import { COURSE_FIRST_RATE } from '@/lib/baseline';
import type { Calibration } from '@/lib/calibration';
import { findRaceOdds, formatFetchedAt, type OddsDay } from '@/lib/odds';
import { buildPatterns, formatPatternTicket, type BetPattern } from '@/lib/patterns';
import { DEFAULT_TEMPERATURE, buildProbabilities } from '@/lib/probability';
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
  /**
   * 公式の直前情報（展示タイム・スタート展示）。締切の10〜15分前に順次入る。
   * **表示だけに使う。** 買い目の評価は記録タブの手入力（tenjiFastFor）で行う
   */
  tenji: TenjiDay | null;
  /** 公式のオッズ。30分おきに更新されるので、表示には取得時刻を必ず添える */
  odds: OddsDay | null;
  /** 確率モデルの較正結果。期待値の数字に必ず添える */
  calibration: Calibration | null;
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
  tenji,
  odds,
  calibration,
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

  /** そのレースの直前情報。未公開・日付違いなら null（列ごと出さない） */
  const tenjiRace = useMemo(
    () => (race && card ? findTenjiRace(tenji, race.raceNo, card.date) : null),
    [tenji, race, card],
  );

  /** そのレースのオッズ。日付が違う・発売前なら null */
  const raceOdds = useMemo(
    () => (race && card ? findRaceOdds(odds, race.raceNo, card.date) : null),
    [odds, race, card],
  );

  /**
   * 買い方の3パターン。確率は較正で決めた温度で作る。
   * **期待値はモデルが正しい前提の数字**なので、較正の注記と必ずセットで出す。
   */
  const patterns = useMemo(() => {
    if (!suggestion) return [];
    const probability = buildProbabilities(
      suggestion.scores,
      calibration?.temperature ?? DEFAULT_TEMPERATURE,
      calibration?.placeTemperature ?? DEFAULT_TEMPERATURE,
    );
    return buildPatterns(suggestion, probability, raceOdds);
  }, [suggestion, calibration, raceOdds]);

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
      {race.ok ? (
        <RaceCardTable
          race={race}
          anchor={suggestion ? suggestion.anchor : null}
          tenji={tenjiRace}
        />
      ) : null}

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

      {/* このレースの買い方（3パターン） */}
      {patterns.length > 0 ? (
        <section className="space-y-2">
          <div className="flex items-baseline gap-2">
            <h2 className="text-base font-bold text-text-main">このレースの買い方</h2>
            <span className="ml-auto text-[11px] text-text-mute">
              {raceOdds
                ? `オッズ ${formatFetchedAt(raceOdds.fetchedAt) ?? '—'} 時点`
                : 'オッズ未取得'}
            </span>
          </div>
          {patterns.map((pattern) => (
            <PatternCard key={pattern.key} pattern={pattern} />
          ))}
          <CalibrationNote calibration={calibration} hasOdds={raceOdds !== null} />
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

/** 住之江の標準チルト。これ以外は意図して調整しているので、そのときだけ出す */
const STANDARD_TILT = -0.5;

function RaceCardTable({
  race,
  anchor,
  tenji,
}: {
  race: CardRace;
  anchor: Boat | null;
  /** 直前情報。まだ公開されていなければ null で、そのときは展示の列を出さない */
  tenji: TenjiRace | null;
}) {
  const tenjiByBoat = new Map((tenji?.entries ?? []).map((entry) => [entry.teiban, entry]));
  const fastest = tenji ? fastestTenji(tenji.entries) : null;
  const weatherLine = formatTenjiWeather(tenji?.weather ?? null);
  const notes = tenjiNotes(tenji);

  return (
    <section className="rounded-xl border border-line bg-bg-panel p-3">
      <h2 className="text-sm font-bold text-text-mute">出走表</h2>
      <div className="mt-2 overflow-x-auto">
        {/*
          min-width を置かない。幅360pxの実測で、7列（展示あり）でも 307px に収まり
          折り返しも起きない。以前の min-w-[22rem] は、収まる内容をわざわざ 352px に
          引き伸ばして横スクロールを作っていた（展示列を足す前から45pxはみ出していた）。
        */}
        <table className="w-full text-xs">
          <thead>
            <tr className="text-text-mute">
              <th className="w-8 pb-1 text-left font-normal">枠</th>
              <th className="pb-1 text-left font-normal">選手</th>
              {tenji ? <th className="pb-1 text-right font-normal">展示</th> : null}
              <th className="pb-1 text-right font-normal">級別</th>
              <th className="pb-1 text-right font-normal">当地</th>
              <th className="pb-1 text-right font-normal">全国</th>
              <th className="pb-1 text-right font-normal">M2率</th>
            </tr>
          </thead>
          <tbody>
            {race.boats.map((boat) => {
              const color = BOAT_COLORS[boat.teiban];
              const info = tenjiByBoat.get(boat.teiban) ?? null;
              const startTiming = formatStartTiming(info?.stTime ?? null);
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
                    {info && info.partsChanged.length > 0 ? (
                      <span className="ml-1 rounded bg-bg-raised px-1 text-[10px] text-text-mute ring-1 ring-line">
                        部品
                      </span>
                    ) : null}
                    {info && info.tilt !== null && info.tilt !== STANDARD_TILT ? (
                      <span className="block text-[10px] text-accent">
                        チルト {info.tilt.toFixed(1)}
                      </span>
                    ) : null}
                  </td>
                  {tenji ? (
                    <td className="tnum py-1.5 text-right">
                      {info && info.tenjiTime !== null ? (
                        <span
                          className={
                            info.tenjiTime === fastest
                              ? 'font-black text-accent'
                              : 'text-text-main'
                          }
                        >
                          {info.tenjiTime.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-text-mute">—</span>
                      )}
                      {startTiming ? (
                        <span className="block text-[10px] text-text-mute">ST {startTiming}</span>
                      ) : null}
                    </td>
                  ) : null}
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
      {tenji ? (
        <>
          {weatherLine ? (
            <p className="mt-2 text-[10px] text-text-mute">水面 {weatherLine}</p>
          ) : null}
          {notes.map((note) => (
            <p key={note} className="mt-1 text-[10px] text-text-mute">
              {note}
            </p>
          ))}
          <p className="mt-1 text-[10px] text-text-mute">
            展示タイムとSTは公式の直前情報です。水面の条件で変わるため、
            <strong className="text-text-main">速い＝勝つ ではありません</strong>。
            買い目の評価には入れていません（記録タブの「展示が速そう」だけが評価に効きます）。
          </p>
        </>
      ) : null}
      <p className="mt-2 text-[10px] text-text-mute">
        住之江は枠なり進入がほぼ確定（1枠→1コース100.0%）。枠番＝進入コースとして扱っています。
        基準の1コース1着率は {COURSE_FIRST_RATE[1]}%。
      </p>
    </section>
  );
}

/** 期待値がこれ以上なら「モデル上は割に合う」 */
const BREAK_EVEN = 1;

function PatternCard({ pattern }: { pattern: BetPattern }) {
  const worthwhile = pattern.expectedValue !== null && pattern.expectedValue >= BREAK_EVEN;
  const empty = pattern.points === 0;

  return (
    <section
      className={[
        'rounded-xl border p-3',
        empty
          ? 'border-line bg-bg-panel/60'
          : worthwhile
            ? 'border-accent bg-bg-panel'
            : 'border-line bg-bg-panel',
      ].join(' ')}
    >
      <div className="flex items-baseline gap-2">
        <h3 className="text-base font-black text-text-main">{pattern.label}</h3>
        {empty ? null : (
          <span className="text-xs text-text-mute">
            {pattern.betTypeName} {pattern.points}点
          </span>
        )}
        {empty ? null : (
          <span className="tnum ml-auto text-xs text-text-mute">
            的中率 {(pattern.hitProbability * 100).toFixed(1)}%
          </span>
        )}
      </div>

      {empty ? null : (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {pattern.tickets.map((ticket) => (
            <li
              key={ticket.boats.join('-')}
              className="tnum rounded border border-line bg-bg-raised px-2 py-1 text-sm font-bold text-text-main"
            >
              {formatPatternTicket(ticket, pattern.ordered)}
              {ticket.odds !== null ? (
                <span className="ml-1.5 text-[10px] font-normal text-text-mute">
                  {ticket.odds.toFixed(1)}倍
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {pattern.expectedValue !== null ? (
        <p className="tnum mt-2 text-sm">
          <span className="text-text-mute">回収率の見立て </span>
          <strong className={worthwhile ? 'text-accent' : 'text-text-main'}>
            {Math.round(pattern.expectedValue * 100)}%
          </strong>
          <span className="text-[11px] text-text-mute">
            （1点100円 × {pattern.points}点 に対して）
          </span>
        </p>
      ) : null}

      {pattern.edgeRatio !== null && pattern.points > 0 ? (
        <p className="tnum mt-1 text-[11px] text-text-mute">
          この{pattern.points}点をモデルは市場の{' '}
          <strong className="text-text-main">{pattern.edgeRatio.toFixed(2)}倍</strong> と見ています
          {pattern.edgeRatio > 1.33
            ? '。回収率100%超はこの食い違いから出ています'
            : pattern.edgeRatio < 0.9
              ? '（市場より控えめ）'
              : '（市場とほぼ同じ）'}
        </p>
      ) : null}

      <p className="mt-1 text-[11px] text-text-mute">{pattern.reason}</p>
      {pattern.caution ? (
        <p className="mt-1 text-[11px] text-accent">※ {pattern.caution}</p>
      ) : null}
    </section>
  );
}

/**
 * 期待値の数字に必ず添える注記。
 *
 * **モデルがどれだけ当たっていないかを出すためのもの。**
 * これを省くと「回収率150%」だけが独り歩きする。
 */
function CalibrationNote({
  calibration,
  hasOdds,
}: {
  calibration: Calibration | null;
  hasOdds: boolean;
}) {
  if (!calibration) {
    return (
      <p className="rounded-lg border border-line bg-bg-raised p-2 text-[11px] text-text-mute">
        確率の検証データがまだありません。的中率は目安として見てください。
      </p>
    );
  }

  const ratio = calibration.trifectaRatio;
  const best = calibration.simulations.reduce<null | (typeof calibration.simulations)[number]>(
    (top, entry) => (top === null || entry.roi > top.roi ? entry : top),
    null,
  );

  return (
    <div className="space-y-1 rounded-lg border border-line bg-bg-raised p-2 text-[11px] text-text-mute">
      <p>
        確率は過去 <strong className="text-text-main">{calibration.races}レース</strong>
        （{calibration.days}開催日）で検証したモデルの見立てです。1着の予測は実測とほぼ一致し、
        3連単は
        <strong className="text-text-main">
          実際の的中が予測の {ratio.toFixed(2)} 倍
        </strong>
        （{ratio >= 1 ? 'モデルはやや控えめ' : `モデルが ${Math.round((1 - ratio) * 100)}%ぶん強気`}
        ）でした。
      </p>
      {hasOdds ? (
        <p>
          回収率の見立ては「モデルの確率 × いまのオッズ」です。
          <strong className="text-text-main">100%を超えても儲かる保証はありません。</strong>
          期待値が高く出る買い目は、モデルと市場の評価が最も食い違っているところで、
          モデル側が誤っている可能性も同じだけあります。
        </p>
      ) : null}
      {best ? (
        <p>
          参考: 同じ期間に<strong className="text-text-main">確率の高い順</strong>で買っていた場合、
          最も成績が良かったのは「{best.label}」で
          <strong className="text-text-main">回収率 {Math.round(best.roi * 100)}%</strong>
          （的中 {best.hits}/{best.races}）。控除率25%があるため、
          長く買えば平均して減ります。
        </p>
      ) : null}
    </div>
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
