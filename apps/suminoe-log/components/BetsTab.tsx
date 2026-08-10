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
import { formatYen, type Bet } from '@/lib/bets';
import { ORDERED_KEYS, buildSuggestion, formatTicket, type BetPlan } from '@/lib/betting';
import { COURSE_FIRST_RATE } from '@/lib/baseline';
import { findSimulation, type Calibration } from '@/lib/calibration';
import { describeRecovery } from '@/lib/glossary';
import { buildLenses, type LensRecord } from '@/lib/lenses';
import { findRaceOdds, formatFetchedAt, type OddsDay } from '@/lib/odds';
import {
  buildPatterns,
  formatPatternTicket,
  heatOf,
  losesOnHit,
  type BetPattern,
  type Heat,
} from '@/lib/patterns';
import { DEFAULT_TEMPERATURE, buildProbabilities } from '@/lib/probability';
import { minutesUntil } from '@/lib/schedule';
import type { CardRace, RaceCard } from '@/lib/raceCard';
import { reviewPlans } from '@/lib/review';
import type { ResultDay } from '@/lib/results';
import { BOAT_COLORS, type Boat } from '@/lib/types';

import { LensPanel } from './LensPanel';
import { RaceOutcome } from './RaceOutcome';
import { StakePicker, stakeYen } from './StakePicker';

interface BetsTabProps {
  card: RaceCard | null;
  /** 当日実測のコース別1着率（母数が少ないうちは使われない） */
  actualCourseRates: Partial<Record<Boat, number | null>>;
  resultCount: number;
  /** レース終了後に取り込まれる公式の結果。まだ出ていなければ null */
  results: ResultDay | null;
  /**
   * 公式の直前情報（展示タイム・スタート展示）。締切の10〜15分前に順次入る。
   * **表示だけに使う。** 買い目の評価には入れない（同じ材料で2回評価しないため）
   */
  tenji: TenjiDay | null;
  /** 視点ごとの実測。無ければ実績行を出さない */
  lensRecord: LensRecord | null;
  /** 公式のオッズ。30分おきに更新されるので、表示には取得時刻を必ず添える */
  odds: OddsDay | null;
  /** 確率モデルの較正結果。期待値の数字に必ず添える */
  calibration: Calibration | null;
  /** 記録タブで選んでいるレース番号。切り替わったらこちらも追従する */
  focusRaceNo: number;
  /** 現在時刻。締切が近いレースを目立たせるのに使う。描画前は null */
  now: Date | null;
  onImport: (raw: string) => void;
  onClearCard: () => void;
  importError: string | null;
  /** 買った舟券を記録する。過去日の閲覧中は渡さない */
  onBuy?: (raceNo: number, bets: Bet[]) => void;
  /** 過去日の閲覧中。取り込み・クリアなどの操作を出さない */
  readOnly?: boolean;
}

export function BetsTab({
  card,
  actualCourseRates,
  resultCount,
  results,
  tenji,
  lensRecord,
  odds,
  calibration,
  focusRaceNo,
  now,
  onImport,
  onClearCard,
  importError,
  onBuy,
  readOnly = false,
}: BetsTabProps) {
  const [pasted, setPasted] = useState('');
  /** 「買った」を押したときの1点あたりの金額。現地で変えるので state で持つ */
  // 1点あたりの賭け金は「数字 × 単位」で持つ（1〜30 × 百/千/万）
  const [stakeAmount, setStakeAmount] = useState(1);
  const [stakeUnit, setStakeUnit] = useState(100);
  const unitYen = stakeYen(stakeAmount, stakeUnit);
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
        ? buildSuggestion(race, actualCourseRates, resultCount)
        : null,
    [race, actualCourseRates, resultCount],
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

  /**
   * 12レース分の期待度。レース一覧を「熱さの地図」にするために使う。
   *
   * 判定（勝負・標準・見送り）は買うかどうかの結論で、期待度は当たりやすさ。
   * 別の軸なので、一覧では判定を文字色、期待度を下端の帯で出し分けている。
   */
  const heatByRace = useMemo(() => {
    const map = new Map<number, Heat>();
    if (!card) return map;
    for (const entry of card.races) {
      const entrySuggestion = buildSuggestion(entry, actualCourseRates, resultCount);
      if (!entrySuggestion) continue;
      const probability = buildProbabilities(
        entrySuggestion.scores,
        calibration?.temperature ?? DEFAULT_TEMPERATURE,
        calibration?.placeTemperature ?? DEFAULT_TEMPERATURE,
      );
      const entryPatterns = buildPatterns(
        entrySuggestion,
        probability,
        findRaceOdds(odds, entry.raceNo, card.date),
      );
      // 一覧では最も熱い型を代表させる（賭式ごとに基準が違うので段で比べる）
      const hottest = entryPatterns.reduce<Heat>((top, pattern) => {
        const heat = heatOf(pattern.hitProbability, pattern.betTypeName);
        return heat.level > top.level ? heat : top;
      }, heatOf(0));
      map.set(entry.raceNo, hottest);
    }
    return map;
  }, [card, actualCourseRates, resultCount, odds, calibration]);

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
          <h2 className="paper-heading text-xs">レースを選ぶ</h2>
          <p className="text-xs text-text-mute">{card.date}</p>
        </div>
        <div className="mt-2 grid grid-cols-6 gap-2">
          {card.races.map((entry) => {
            const isActive = race.raceNo === entry.raceNo;
            const heat = heatByRace.get(entry.raceNo);
            // 締切が近いレースは枠を明滅させる。締切を過ぎたものは沈める
            const left = now ? minutesUntil(entry.deadline, now) : null;
            const closingSoon = left !== null && left >= 0 && left <= 10;
            const closed = left !== null && left < 0;
            // 判定は「買うかどうか」の結論。冷たい青から熱い赤へ、そのまま温度で出す
            const verdictClass =
              entry.verdict === '勝負'
                ? 'heat-text-3 font-black'
                : entry.verdict === '標準'
                  ? 'heat-text-2 font-bold'
                  : 'heat-text-1';
            return (
              <button
                key={entry.raceNo}
                type="button"
                aria-pressed={isActive}
                aria-label={`${entry.raceNo}R ${entry.verdict ?? ''}${
                  heat && heat.level > 0 ? ` ${heat.label}` : ''
                }`}
                onClick={() => setSelectedRaceNo(entry.raceNo)}
                className={[
                  'relative min-h-14 overflow-hidden border pt-1',
                  isActive ? 'border-accent bg-bg-raised' : 'border-line bg-bg-raised/40',
                  heat && heat.level >= 4 ? 'border-2' : '',
                  closingSoon ? 'deadline-soon' : '',
                  closed && !isActive ? 'opacity-45' : '',
                ].join(' ')}
              >
                {closingSoon ? (
                  <span className="absolute inset-x-0 top-0 bg-accent py-[1px] text-[9px] font-black leading-none text-[color:var(--on-accent)]">
                    締切{left}分
                  </span>
                ) : null}
                <span
                  className={[
                    'tnum block text-base font-bold',
                    isActive ? 'text-text-main' : 'text-text-mute',
                  ].join(' ')}
                >
                  {entry.raceNo}
                </span>
                <span aria-hidden className="mt-0.5 block text-[10px] leading-tight">
                  <span className={verdictClass}>
                    {entry.verdict === '見送り' ? '見送' : (entry.verdict ?? '—')}
                  </span>
                </span>
                {finishedRaceNos.has(entry.raceNo) ? (
                  <span aria-hidden className="mx-auto mt-0.5 block h-1 w-1 bg-accent" />
                ) : null}
                {/* 期待度の帯。判定とは別軸なので、下端に横で引いて混ざらないようにする */}
                {heat && heat.level > 0 ? (
                  <span
                    aria-hidden
                    className={`absolute inset-x-0 bottom-0 h-[3px] heat-${heat.level}`}
                  />
                ) : null}
              </button>
            );
          })}
        </div>
        <p className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[10px] text-text-mute">
          <span>
            <span className="heat-text-3 font-black">勝負</span>
            {card.races.filter((entry) => entry.verdict === '勝負').length}件
          </span>
          <span>
            <span className="heat-text-2 font-bold">標準</span>
            {card.races.filter((entry) => entry.verdict === '標準').length}件
          </span>
          <span>
            <span className="heat-text-1">見送</span>
            {card.races.filter((entry) => entry.verdict === '見送り').length}件
          </span>
          <span className="ml-auto">下の帯＝期待度（青→緑→赤→金→虹）</span>
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
          <h2 className="paper-heading text-xs">買い目の組み立て方</h2>
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

      {/*
        5つの視点。**買い目より先に置く。**
        「どの材料がどの艇を推しているか」を見てから型を見るほうが、
        なぜその買い目なのかが分かる。
      */}
      {race ? (
        <LensPanel verdict={buildLenses(race, tenjiRace, raceOdds)} record={lensRecord} />
      ) : null}

      {/* このレースの買い方（3パターン） */}
      {patterns.length > 0 ? (
        <section className="space-y-2">
          <div className="flex items-baseline gap-2">
            <h2 className="paper-heading text-sm">このレースの買い方</h2>
            <span className="ml-auto text-[11px] text-text-mute">
              {raceOdds
                ? `オッズ ${formatFetchedAt(raceOdds.fetchedAt) ?? '—'} 時点`
                : 'オッズ未取得'}
            </span>
          </div>
          {onBuy && !readOnly ? (
            <StakePicker
              amount={stakeAmount}
              unit={stakeUnit}
              onChange={(nextAmount, nextUnit) => {
                setStakeAmount(nextAmount);
                setStakeUnit(nextUnit);
              }}
              points={patterns[0]?.points ?? 0}
            />
          ) : null}
          {patterns.map((pattern) => (
            <PatternCard
              key={pattern.key}
              pattern={pattern}
              unitYen={unitYen}
              calibration={calibration}
              onBuy={
                onBuy && !readOnly
                  ? () =>
                      onBuy(
                        race.raceNo,
                        pattern.tickets.map((ticket) => ({
                          betType: pattern.betTypeName === '3連単' ? 'trifecta' : 'trio',
                          combo: ticket.boats,
                          amountYen: unitYen,
                        })),
                      )
                  : undefined
              }
            />
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
      <h2 className="paper-heading text-xs">出走表</h2>
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

function PatternCard({
  pattern,
  unitYen,
  calibration,
  onBuy,
}: {
  pattern: BetPattern;
  unitYen: number;
  /** 過去の実測を添えるために使う。無ければ実績行を出さない */
  calibration: Calibration | null;
  onBuy?: () => void;
}) {
  const worthwhile = pattern.expectedValue !== null && pattern.expectedValue >= BREAK_EVEN;
  const empty = pattern.points === 0;
  const heat = heatOf(pattern.hitProbability, pattern.betTypeName);
  const deadPoints = pattern.tickets.filter((ticket) => losesOnHit(ticket, pattern.points)).length;
  const track = findSimulation(calibration, pattern.betTypeName, pattern.points);

  return (
    <section
      className={[
        'relative border py-2 pl-3.5 pr-2.5',
        empty ? 'border-line bg-bg-panel/60' : 'border-line bg-bg-panel',
        worthwhile && !empty ? 'border-l-0' : '',
      ].join(' ')}
    >
      {/* 期待度の帯。色だけで判断させないよう、右の的中率と必ず対で読む */}
      {!empty && heat.level > 0 ? (
        <span className={`heat-bar heat-${heat.level}`} aria-hidden="true" />
      ) : null}

      <div className="flex items-baseline gap-2">
        <h3 className="text-base font-black tracking-wide text-text-main">{pattern.label}</h3>
        {empty ? null : (
          <span className="text-xs text-text-mute">
            {pattern.betTypeName} {pattern.points}点
          </span>
        )}
        {empty ? null : (
          <span className="tnum ml-auto text-xs text-text-mute">
            的中率{' '}
            <strong className="text-sm text-text-main">
              {(pattern.hitProbability * 100).toFixed(1)}%
            </strong>
          </span>
        )}
      </div>

      {/* 言葉には必ず基準を添える。「激熱」だけを出すと煽りになる */}
      {!empty && heat.level > 0 ? (
        <p className="mt-0.5 flex items-baseline gap-1.5">
          <span className={`text-lg font-black tracking-widest heat-text-${heat.level}`}>
            {heat.label}
          </span>
          <span className="tnum text-[10px] text-text-mute">
            = 的中率 {Math.round(heat.threshold * 100)}% 以上
          </span>
        </p>
      ) : null}

      {empty ? null : (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {pattern.tickets.map((ticket) => {
            /**
             * この点が当たっても、まとめ買いした分を取り戻せないか。
             * オッズが点数以下だとそうなる（賭け金の大小によらない）。
             * 8/9 の 8R 1=3=4（2.5倍を3点）、12R 1=2=3（3.0倍を3点＝同額）で実際に起きた。
             */
            const dead = losesOnHit(ticket, pattern.points);
            return (
              <li
                key={ticket.boats.join('-')}
                className={[
                  'tnum rounded border px-2 py-1 text-sm font-bold',
                  dead
                    ? 'border-dashed border-text-mute bg-bg-raised text-text-mute'
                    : 'border-line bg-bg-raised text-text-main',
                ].join(' ')}
              >
                {formatPatternTicket(ticket, pattern.ordered)}
                {ticket.odds !== null ? (
                  <span className="ml-1.5 text-[10px] font-normal text-text-mute">
                    {ticket.odds.toFixed(1)}倍
                  </span>
                ) : null}
                {dead ? (
                  <span className="ml-1 text-[10px] font-normal text-text-mute">当たっても損</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {/*
        この型の実測。**「今日は当たらない」が異常なのか想定内なのかを、その場で判断できるようにする。**
        8/9 の現地で堅実が5レース連続で外れたとき、この数字が画面に無かったので
        「壊れているのか、ただのブレなのか」を私が計算し直すまで答えられなかった。
      */}
      {track ? (
        <p className="tnum mt-1.5 border-l-2 border-line pl-2 text-[11px] text-text-mute">
          この型で過去 <strong className="text-text-main">{track.races}レース</strong> 買った実測は
          <strong className="text-text-main"> 的中率 {Math.round(track.hitRate * 100)}%</strong>
          {' / '}
          <strong className="text-text-main">回収率 {Math.round(track.roi * 100)}%</strong>
          。（確率の高い順に{pattern.points}点で買った場合。控除率25%ぶんは必ず削られます）
        </p>
      ) : null}

      {/* 点数ぶんを取り戻せない点があるなら、買う前に言う */}
      {deadPoints > 0 ? (
        <p className="tnum mt-1.5 border-l-2 border-text-mute pl-2 text-[11px] text-text-mute">
          この{pattern.points}点を同額で買うと、
          <strong className="text-text-main">{deadPoints}点は当たっても収支がプラスになりません</strong>
          （オッズが{pattern.points}倍以下）。
        </p>
      ) : null}

      {pattern.expectedValue !== null ? (
        <p className="tnum mt-2 text-sm">
          <span className="text-text-mute">回収率の見立て </span>
          <strong className={worthwhile ? 'text-accent' : 'text-text-main'}>
            {Math.round(pattern.expectedValue * 100)}%
          </strong>
          <span className="text-[11px] text-text-mute">
            （1点 {unitYen.toLocaleString('ja-JP')}円 × {pattern.points}点 ={' '}
            {(unitYen * pattern.points).toLocaleString('ja-JP')}円 に対して）
          </span>
          {/* パーセントだけでは「儲かる」と読める。金額に直して意味を書く */}
          <span className="mt-0.5 block text-[11px] text-text-mute">
            {describeRecovery(pattern.expectedValue * 100, unitYen * pattern.points)}。
            <strong className="text-text-main">予想が当たる前提の数字です。</strong>
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

      {onBuy && !empty ? (
        <button
          type="button"
          onClick={onBuy}
          className="on-accent mt-2 min-h-11 w-full bg-accent text-sm font-black"
        >
          この{pattern.points}点を買った（{formatYen(unitYen * pattern.points)}）
        </button>
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
