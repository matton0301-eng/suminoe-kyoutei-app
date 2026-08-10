'use client';

/**
 * スミノエ・ログ 単一ページ。
 *
 * 状態は useState / useReducer のみ。永続化は localStorage のみ。
 * 保存はデバウンスせず即時、フォーム入力のたびに下書きを退避する
 * （現地での取りこぼしを防ぐため）。
 *
 * **特定の1日の専用アプリではない。** 扱う開催日は出走表の日付で決まり、
 * 記録はその日付ごとに保存する（`lib/raceDate.ts`）。
 */

import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';

import { BetsTab } from '@/components/BetsTab';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { HitCelebration } from '@/components/HitCelebration';
import { DayPicker } from '@/components/DayPicker';
import { ExportTab } from '@/components/ExportTab';
import { FirstRunGuide, hasSeenGuide, markGuideSeen } from '@/components/FirstRunGuide';
import { LogList } from '@/components/LogList';
import { CalendarTab } from '@/components/CalendarTab';
import { OddsTab } from '@/components/OddsTab';
import { RecordTab } from '@/components/RecordTab';
import { StatsTab } from '@/components/StatsTab';
import { TallyTab } from '@/components/TallyTab';
import { TabBar, type TabKey } from '@/components/TabBar';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Toast } from '@/components/Toast';
import { aggregate } from '@/lib/aggregate';
import { hitsByOrder, summarizeBets, type Bet } from '@/lib/bets';
import { fetchArchiveDay, fetchArchiveIndex, mergeDayEntries, type DayEntry } from '@/lib/archive';
import type { MultiTally } from '@/lib/multiTally';
import { loadMultiTally } from '@/lib/totalLoader';
import {
  createId,
  formHasContent,
  formReducer,
  nextRaceNo,
  toRaceLog,
} from '@/lib/formReducer';
import { toCsv, toPlainText } from '@/lib/exporters';
import { fetchBundledCard, parseRaceCard, type RaceCard } from '@/lib/raceCard';
import { formatDateLabel, todayIso } from '@/lib/raceDate';
import { fetchArchiveTenji, fetchBeforeInfo, type TenjiDay } from '@/lib/beforeInfo';
import { fetchCalibration, type Calibration } from '@/lib/calibration';
import { fetchSchedule, type Schedule } from '@/lib/calendar';
import { fetchLensRecord, type LensRecord } from '@/lib/lenses';
import { fetchArchiveOdds, fetchOddsDay, formatFetchedAt, type OddsDay } from '@/lib/odds';
import { fetchResults, type ResultDay } from '@/lib/results';
import { formatMinutesLeft, isUrgent, minutesUntil, resolveSchedule } from '@/lib/schedule';
import { tallyDay } from '@/lib/tally';
import {
  clearAll,
  clearDraft,
  clearRaceCard,
  countLogsByDate,
  isDraftMeaningful,
  loadDraft,
  loadLogs,
  loadRaceCardRaw,
  saveDraft,
  saveLogs,
  saveRaceCardRaw,
} from '@/lib/storage';
import { EMPTY_FORM, type Boat, type FormState, type RaceLog } from '@/lib/types';

type PendingConfirm = 'saveWithoutResult' | 'clearAll' | null;

export default function Page() {
  // 起動時は買い目。現地で最初に見るのはここで、記録は結果が出てから触る
  const [tab, setTab] = useState<TabKey>('bets');
  const [logs, setLogs] = useState<RaceLog[]>([]);
  const [form, dispatch] = useReducer(formReducer, EMPTY_FORM);
  const [toast, setToast] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm>(null);
  const [hydrated, setHydrated] = useState(false);
  const [raceCard, setRaceCard] = useState<RaceCard | null>(null);
  const [results, setResults] = useState<ResultDay | null>(null);
  /** 公式の直前情報。締切の10〜15分前にレースごとに入る */
  const [tenji, setTenji] = useState<TenjiDay | null>(null);
  /** 公式のオッズ。30分おきに更新される */
  const [odds, setOdds] = useState<OddsDay | null>(null);
  /** 確率モデルの較正結果。期待値の注記に使う */
  const [calibration, setCalibration] = useState<Calibration | null>(null);
  /**
   * 開催予定のカレンダー。住之江は月に12日ほどしか開催がない。
   * 当日のレース進行を表す `schedule`（下の useMemo）とは別物なので名前を分ける。
   */
  const [calendar, setCalendar] = useState<Schedule | null>(null);
  /** 視点ごとの実測（743レースで測定）。買い目タブの5視点に添える */
  const [lensRecord, setLensRecord] = useState<LensRecord | null>(null);
  /** はじめての人への案内。閉じたら二度と出さない（開催タブから開き直せる） */
  const [guideOpen, setGuideOpen] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  /** 的中の演出。保存した瞬間に当たっていれば流す */
  const [celebration, setCelebration] = useState<{ hits: Bet[]; token: number }>({
    hits: [],
    token: 0,
  });
  /** 締切までの残り時間を出すための現在時刻。1分ごとに進める */
  const [now, setNow] = useState<Date | null>(null);
  /** 起動時の自動選択を一度だけ行うためのフラグ */
  const [autoPicked, setAutoPicked] = useState(false);
  /**
   * アプリがいま扱っている開催日（"2026-08-09"）。
   * 出走表があればその日付、なければ端末の今日。記録はこの日付ごとに保存する。
   */
  const [raceDate, setRaceDate] = useState<string>(() => todayIso());
  /** 閲覧中の過去日。通常運用(今日)なら null */
  const [viewDate, setViewDate] = useState<string | null>(null);
  /** 過去日表示用のデータ一式。当日の state には触れない */
  const [archiveView, setArchiveView] = useState<{
    card: RaceCard | null;
    results: ResultDay | null;
    tenji: TenjiDay | null;
    odds: OddsDay | null;
    logs: RaceLog[];
  } | null>(null);
  const [dayPickerOpen, setDayPickerOpen] = useState(false);
  const [dayEntries, setDayEntries] = useState<DayEntry[]>([]);
  /** 過去日のアーカイブが取得できなかったときの案内 */
  const [archiveNotice, setArchiveNotice] = useState<string | null>(null);
  /** 開催日をまたいだ通算集計。収支タブで「通算」が押されるまで読まない */
  const [total, setTotal] = useState<MultiTally | null>(null);
  const [totalLoading, setTotalLoading] = useState(false);
  const [totalError, setTotalError] = useState<string | null>(null);

  /**
   * 起動時: 出走表 → その日付 → 記録・下書き の順に復元する。
   *
   * localStorage はサーバー側では読めないため、初期 state に埋め込むと
   * hydration が食い違う。読み取りは effect で行うのが正しい。
   * ここは起動時の1回だけで、以降の再レンダーは発生しない。
   */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // 先に出走表を読む。その日付が「アプリが扱う日」になる
    const storedCard = loadRaceCardRaw();
    const storedParsed = storedCard ? parseRaceCard(storedCard).card : null;
    const initialDate = storedParsed?.date || todayIso();
    if (storedParsed) setRaceCard(storedParsed);
    setRaceDate(initialDate);

    const { logs: storedLogs, error } = loadLogs(initialDate);
    setLogs(storedLogs);
    if (error) setStorageWarning(error);

    const draft = loadDraft(initialDate);
    if (draft && isDraftMeaningful(draft)) {
      dispatch({ type: 'restore', form: draft });
      setToast('入力途中の内容を復元しました');
    } else if (storedLogs.length > 0) {
      const maxRaceNo = Math.max(...storedLogs.map((log) => log.raceNo));
      dispatch({ type: 'reset', raceNo: nextRaceNo(maxRaceNo) });
    }
    setHydrated(true);
    if (!hasSeenGuide()) setGuideOpen(true);

    /**
     * アプリに同梱された出走表を読む（貼り付け不要にするため）。
     * 当日朝に取得した分がデプロイされていれば、アプリを開くだけで反映される。
     */
    void fetchBundledCard().then((bundled) => {
      if (!bundled) return;
      if (storedParsed && storedParsed.date === bundled.date) return;
      setRaceCard(bundled);
      saveRaceCardRaw(JSON.stringify(bundled));

      // 開催日が変わったら、その日の記録に切り替える（前日の記録は別キーに残る）
      if (bundled.date !== initialDate) {
        setRaceDate(bundled.date);
        const switched = loadLogs(bundled.date);
        setLogs(switched.logs);
        const switchedDraft = loadDraft(bundled.date);
        dispatch(
          switchedDraft && isDraftMeaningful(switchedDraft)
            ? { type: 'restore', form: switchedDraft }
            : {
                type: 'reset',
                raceNo:
                  switched.logs.length > 0
                    ? nextRaceNo(Math.max(...switched.logs.map((log) => log.raceNo)))
                    : 1,
              },
        );
      }
      setToast(`${formatDateLabel(bundled.date)} の出走表を読み込みました`);
    });

    /**
     * 競走成績を読む。全レースが終わってから確定するため、レース中は存在しない。
     * 取れなければ何もしない（買い目タブに結果セクションが出ないだけ）。
     */
    void fetchResults().then((fetched) => {
      if (fetched) setResults(fetched);
    });

    /** 直前情報。まだ1レースも公開されていない時間帯は中身が空で返る */
    void fetchBeforeInfo().then((fetched) => {
      if (fetched) setTenji(fetched);
    });

    /** オッズ。発売前は空で返る */
    void fetchOddsDay().then((fetched) => {
      if (fetched) setOdds(fetched);
    });

    /** 視点ごとの実測。過去データで測ったもので、当日は変わらない */
    void fetchLensRecord().then((fetched) => {
      if (fetched) setLensRecord(fetched);
    });

    /** 開催予定（どの日に開催があるか）。次の開催日の表示に使う */
    void fetchSchedule().then((fetched) => {
      if (fetched) setCalendar(fetched);
    });

    /** 確率モデルの較正結果。期待値の数字に必ず添えるので、無ければ期待値も控えめに出す */
    void fetchCalibration().then((fetched) => {
      if (fetched) setCalibration(fetched);
    });
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  /**
   * 開いている間だけ、直前情報とオッズを5分おきに取り直す。
   *
   * リード側は30分おきに書き出すが、締切前の1回でも新しいほうが役に立つ。
   * 取れなければ前の内容を残す（オフラインで表示が消えないように）。
   * 較正は当日変わらないので取り直さない。
   */
  useEffect(() => {
    const timer = window.setInterval(() => {
      void fetchBeforeInfo().then((fetched) => {
        if (fetched) setTenji(fetched);
      });
      void fetchOddsDay().then((fetched) => {
        if (fetched) setOdds(fetched);
      });
    }, 300_000);
    return () => window.clearInterval(timer);
  }, []);

  /**
   * 締切までの残り時間を進める。1分ごとで足りる。
   *
   * 現在時刻は初期 state に入れられない（サーバー側の描画と食い違う）。
   * 時計はまさに「外部システム」なので、effect で購読するのが正しい形。
   */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 時計の購読。初期値は描画前に決められない
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // フォームが変わるたびに下書きを退避（デバウンスしない）
  useEffect(() => {
    if (!hydrated) return;
    saveDraft(raceDate, form);
  }, [form, hydrated, raceDate]);

  const persist = useCallback(
    (next: RaceLog[]) => {
      setLogs(next);
      if (!saveLogs(raceDate, next)) {
        setStorageWarning('記録を保存できませんでした。画面を閉じると消える可能性があります。');
      }
    },
    [raceDate],
  );

  /**
   * フォームの内容を記録の配列に畳み込む。保存も画面遷移もしない、純粋な組み立て。
   *
   * 同じレースの記録があれば**上書きする**。
   * 買い目タブの「買った」は記録を先に作るので、そのあと結果を保存したときに
   * 新しい行を足すと 1R が2つできてしまう（実際に踏んだ）。
   */
  const foldIntoLogs = useCallback(
    (source: FormState, current: RaceLog[]) => {
      const existing =
        source.editingId !== null
          ? (current.find((log) => log.id === source.editingId) ?? null)
          : (current.find((log) => log.raceNo === source.raceNo) ?? null);

      /**
       * 買い目タブから入れた舟券はフォームに無いことがあるので、既存の記録から引き継ぐ。
       *
       * **ただし「見（ケン）」が立っているときは引き継がない。**
       * 引き継ぐと「舟券を買った」と「買わずに見た」が同じ記録に同居する。
       * 見送ったという申告のほうが後から出た意思なので、そちらを採る。
       */
      const bets = source.ken
        ? []
        : source.bets.length > 0
          ? source.bets
          : (existing?.bets ?? []);

      const saved: RaceLog = {
        ...toRaceLog(source, existing?.id ?? createId()),
        bets,
        ken: source.ken || (bets.length === 0 && (existing?.ken ?? false)),
        savedAt: existing?.savedAt ?? new Date().toISOString(),
      };

      const next = existing
        ? current.map((log) => (log.id === saved.id ? saved : log))
        : [...current, saved];

      return { saved, next, isUpdate: existing !== null, bets };
    },
    [],
  );

  const commit = useCallback(() => {
    const { next, isUpdate, bets } = foldIntoLogs(form, logs);

    // 当たっていれば祝う。公式の払戻はまだ来ていないので、入力した着順だけで判定する
    const hits = hitsByOrder(bets, [form.resultFirst, form.resultSecond, form.resultThird]);
    if (hits.length > 0) {
      setCelebration((current) => ({ hits, token: current.token + 1 }));
    }

    persist(next);
    setToast(`${form.raceNo}R を${isUpdate ? '修正' : '記録'}しました`);
    dispatch({ type: 'reset', raceNo: nextRaceNo(form.raceNo) });
    clearDraft(raceDate);
  }, [foldIntoLogs, form, logs, persist, raceDate]);

  /**
   * レースを移る。
   *
   * 入力途中の内容があれば**そのレースの記録として先に保存してから**移る。
   * 保存せずに移ると入力が消え、持ち越すと前のレースの「見」や着順が
   * 次のレースに波及する（2026-08-09 の現地で後者を踏んだ）。どちらも避ける。
   */
  const handleChangeRace = useCallback(
    (target: number) => {
      const base = formHasContent(form) ? foldIntoLogs(form, logs).next : logs;
      if (base !== logs) persist(base);
      dispatch({
        type: 'selectRace',
        raceNo: target,
        log: base.find((log) => log.raceNo === target) ?? null,
      });
    },
    [foldIntoLogs, form, logs, persist],
  );

  const handleSave = useCallback(() => {
    // 未入力でも保存できてよい。ただし結果1着が空のときだけ確認する。
    if (form.resultFirst === null) {
      setPendingConfirm('saveWithoutResult');
      return;
    }
    commit();
  }, [form.resultFirst, commit]);

  const lastLog = useMemo(() => (logs.length > 0 ? logs[logs.length - 1] : null), [logs]);

  const handleEditLast = useCallback(() => {
    if (lastLog) dispatch({ type: 'loadForEdit', log: lastLog });
  }, [lastLog]);

  const handleCancelEdit = useCallback(() => {
    const base = logs.length > 0 ? Math.max(...logs.map((log) => log.raceNo)) : 0;
    dispatch({ type: 'reset', raceNo: nextRaceNo(base) });
    clearDraft(raceDate);
  }, [logs, raceDate]);

  const handleClearAll = useCallback(() => {
    clearAll(raceDate);
    setLogs([]);
    dispatch({ type: 'reset', raceNo: 1 });
    setPendingConfirm(null);
    setToast('全記録を消しました');
    setTab('record');
  }, [raceDate]);

  const handleImportCard = useCallback((raw: string) => {
    const { card, error } = parseRaceCard(raw);
    if (error !== null || card === null) {
      setImportError(error ?? '取り込めませんでした。');
      return;
    }
    setRaceCard(card);
    setRaceDate(card.date || todayIso());
    setImportError(null);
    if (!saveRaceCardRaw(raw)) {
      setStorageWarning('出走表データを保存できませんでした。画面を閉じると消えます。');
    }
    setToast(`${formatDateLabel(card.date)} の出走表を取り込みました（${card.races.length}レース）`);
  }, []);

  const handleClearCard = useCallback(() => {
    clearRaceCard();
    setRaceCard(null);
    setImportError(null);
    setToast('出走表データを消しました');
  }, []);

  /**
   * 収支タブで「通算」が初めて押されたときにアーカイブ全日分を読む。
   * 起動時に読まないのは、開催日が増えるほど取得件数も増えるため。
   */
  const handleRequestTotal = useCallback(async () => {
    setTotalLoading(true);
    setTotalError(null);
    try {
      const loaded = await loadMultiTally();
      if (loaded === null) {
        setTotalError('通算データを読み込めませんでした。オンラインで開くと見られます。');
      }
      setTotal(loaded);
    } finally {
      setTotalLoading(false);
    }
  }, []);

  /**
   * 買い目タブで「買った」を押したときの記録。
   *
   * フォームを経由せずその場で保存する。現地では買ってすぐ次の操作に移るので、
   * 「記録タブに移動して保存を押す」を挟むと取りこぼす。
   * 同じレースに買い増したら、既存の記録に足す。
   */
  const handleBuy = useCallback(
    (raceNo: number, bets: Bet[]) => {
      const existing = logs.find((log) => log.raceNo === raceNo);
      const next = existing
        ? logs.map((log) =>
            log.raceNo === raceNo
              ? { ...log, bets: [...log.bets, ...bets], ken: false }
              : log,
          )
        : [
            ...logs,
            {
              id: createId(),
              raceNo,
              bets,
              ken: false,
              resultFirst: null,
              resultSecond: null,
              resultThird: null,
              kimarite: null,
              suimen: null,
              memo: '',
              savedAt: new Date().toISOString(),
            },
          ];
      persist(next);
      // 記録タブで同じレースを開いていれば、フォームにも映して一覧に出す
      if (form.raceNo === raceNo) dispatch({ type: 'addBets', bets });
      const total = bets.reduce((sum, bet) => sum + bet.amountYen, 0);
      setToast(`${raceNo}R に ${bets.length}点（${total.toLocaleString('ja-JP')}円）を記録しました`);
    },
    [logs, persist, form.raceNo],
  );

  /** ヘッダーの日付タップ。先にモーダルを開いてから一覧を読む(体感を軽くする) */
  const openDayPicker = useCallback(async () => {
    setDayPickerOpen(true);
    const index = await fetchArchiveIndex();
    setDayEntries(mergeDayEntries(index, countLogsByDate()));
  }, []);

  /** 日付リストで日を選ぶ。null は「今日に戻る」 */
  const handleSelectDay = useCallback(
    async (date: string | null) => {
      setDayPickerOpen(false);
      if (date === null || date === raceDate) {
        setViewDate(null);
        setArchiveView(null);
        setArchiveNotice(null);
        return;
      }
      const stored = loadLogs(date);
      const [{ card, results }, pastTenji, pastOdds] = await Promise.all([
        fetchArchiveDay(date),
        fetchArchiveTenji(date),
        fetchArchiveOdds(date),
      ]);
      setViewDate(date);
      setArchiveView({ card, results, tenji: pastTenji, odds: pastOdds, logs: stored.logs });
      setArchiveNotice(
        card === null
          ? 'この日の出走表・結果は取得できませんでした。オンラインで開くと見られます。'
          : null,
      );
    },
    [raceDate],
  );

  /** 過去日の閲覧中か。表示用のデータ源だけが切り替わり、当日の state はそのまま */
  const viewing = viewDate !== null;
  const activeDate = viewDate ?? raceDate;
  const activeLogs = useMemo(
    () => (viewing ? (archiveView?.logs ?? []) : logs),
    [viewing, archiveView, logs],
  );
  const activeCard = viewing ? (archiveView?.card ?? null) : raceCard;
  const activeResults = viewing ? (archiveView?.results ?? null) : results;
  const activeTenji = viewing ? (archiveView?.tenji ?? null) : tenji;
  const activeOdds = viewing ? (archiveView?.odds ?? null) : odds;

  const stats = useMemo(() => aggregate(activeLogs), [activeLogs]);

  /**
   * 自分が買った舟券の実収支。仮定の数字ではなく、買った金額と公式の払戻から出す。
   * 結果がまだ出ていないレースは払戻に数えない（「まだ」と「外れ」を混ぜない）。
   */
  const myBets = useMemo(() => {
    // **日付が一致する結果だけで精算する。** results.json は前日のものが
    // 残っていることがあり、そのまま当てると別の日の着順で配当が出る
    // （8/9 の購入に 8/8 の 1-4-6 を当てて「的中」と出た）
    const sameDay = activeResults !== null && activeResults.date === activeDate;
    return summarizeBets(activeLogs, sameDay ? activeResults.races : []);
  }, [activeLogs, activeResults, activeDate]);
  const exportText = useMemo(() => toPlainText(activeLogs, activeDate), [activeLogs, activeDate]);
  const exportCsv = useMemo(() => toCsv(activeLogs), [activeLogs]);

  /** 締切時刻から「いま見るべきレース」を割り出す */
  const schedule = useMemo(
    () => (raceCard && now ? resolveSchedule(raceCard.races, now) : null),
    [raceCard, now],
  );

  /**
   * 起動時に一度だけ、締切が近いレースを選ぶ。
   * 記録が既にある場合（続きから入れている場合）は、その続きを尊重して何もしない。
   *
   * 締切は出走表の取得後に分かるため「起動直後」では決められない。
   * effect で setState すると警告になるので、レンダー中に一度だけ同期する。
   */
  if (!autoPicked && hydrated && schedule?.currentRaceNo) {
    setAutoPicked(true);
    if (logs.length === 0 && form.editingId === null && schedule.currentRaceNo !== form.raceNo) {
      dispatch({ type: 'selectRace', raceNo: schedule.currentRaceNo, log: null });
    }
  }

  /** 記録タブに出すレース情報（レース名・締切・出走メンバー） */
  const currentRace = useMemo(
    () => raceCard?.races.find((race) => race.raceNo === form.raceNo) ?? null,
    [raceCard, form.raceNo],
  );

  /** 収支タブ用の通算集計。結果が出ていなければ null */
  const tally = useMemo(
    () => (activeCard && activeResults ? tallyDay(activeCard, activeResults) : null),
    [activeCard, activeResults],
  );

  /**
   * 記録タブで見ているレースの締切までの残り分。
   *
   * 「次に締まるレース」ではなく「いま見ているレース」の残り時間を出す。
   * 記録の続きから入れている場合、見ているレースと次に締まるレースは別になるため。
   */
  const selectedMinutesLeft = useMemo(
    () => (currentRace && now ? minutesUntil(currentRace.deadline, now) : null),
    [currentRace, now],
  );

  /**
   * 買い目タブで見ているレースの「展示で速そうな艇」。
   * すでに記録済みならその値、まだならフォームの入力中の値を使う。
   */

  /** 買い目の補正に使う当日実測のコース別1着率 */
  const actualCourseRates = useMemo(() => {
    const rates: Partial<Record<Boat, number | null>> = {};
    for (const course of stats.courses) {
      rates[course.course] = course.rate;
    }
    return rates;
  }, [stats.courses]);

  /** 出走表の日付が端末の今日と違えば、いつのデータを見ているのか分かるようにする */
  const viewingPastDay = hydrated && raceDate !== todayIso();

  return (
    <>
      {/* 新聞の題字。太罫で紙面の頭を切る */}
      {guideOpen ? (
        <FirstRunGuide
          onClose={() => {
            markGuideSeen();
            setGuideOpen(false);
          }}
        />
      ) : null}

      <header className="sticky top-0 z-10 border-b-[3px] border-text-main bg-bg-deep">
        <div className="relative mx-auto flex max-w-lg items-center justify-between gap-2 px-3 py-1.5">
          <h1 className="text-lg font-black tracking-[0.18em] text-text-main">スミノエ・ログ</h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openDayPicker}
              className="tnum min-h-11 rounded-lg px-2 text-sm text-text-mute underline decoration-dotted underline-offset-4"
              aria-label="日付を選ぶ"
            >
              {formatDateLabel(activeDate)}
            </button>
            <ThemeToggle />
          </div>
        </div>
        {/*
          データの鮮度を常時出す。
          8/9 に端末が古いオッズを掴んだまま数時間気づけなかった。
          この2つの時刻が動いていないことが、そのまま異常の合図になる。
        */}
        <div className="mx-auto flex max-w-lg items-baseline gap-3 px-3 pb-1 text-[10px] text-text-mute">
          <span className="tnum">
            オッズ {activeOdds ? (formatFetchedAt(activeOdds.updatedAt) ?? '—') : '未取得'}
          </span>
          <span className="tnum">
            展示 {activeTenji ? (formatFetchedAt(activeTenji.updatedAt) ?? '—') : '未取得'}
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-lg flex-1 px-1.5 py-3">
        {storageWarning ? (
          <p
            role="alert"
            className="mb-3 rounded-lg border border-accent bg-bg-panel p-3 text-sm text-text-main"
          >
            {storageWarning}
          </p>
        ) : null}

        {viewing ? (
          <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-accent bg-bg-panel px-3 py-2">
            <p className="text-xs text-text-main">
              閲覧専用 — <span className="tnum">{formatDateLabel(activeDate)}</span> のデータを表示中
            </p>
            <button
              type="button"
              onClick={() => handleSelectDay(null)}
              className="on-accent min-h-9 shrink-0 rounded-lg bg-accent px-3 text-xs font-bold"
            >
              今日に戻る
            </button>
          </div>
        ) : viewingPastDay ? (
          <p className="mb-3 rounded-lg border border-line bg-bg-panel px-3 py-2 text-xs text-text-mute">
            今日ではなく <span className="tnum text-text-main">{formatDateLabel(raceDate)}</span>{' '}
            のデータを表示しています。新しい出走表が用意されると自動で切り替わります。
          </p>
        ) : null}
        {viewing && archiveNotice ? (
          <p className="mb-3 rounded-lg border border-line bg-bg-panel px-3 py-2 text-xs text-text-mute">
            {archiveNotice}
          </p>
        ) : null}

        {tab === 'record' ? (
          viewing ? (
            <LogList logs={activeLogs} />
          ) : (
            <RecordTab
              form={form}
              dispatch={dispatch}
              lastLog={lastLog}
              race={currentRace}
              deadlineLabel={formatMinutesLeft(selectedMinutesLeft)}
              deadlineUrgent={isUrgent(selectedMinutesLeft)}
              onChangeRace={handleChangeRace}
              resultRace={
                activeResults && activeResults.date === activeDate
                  ? (activeResults.races.find((entry) => entry.raceNo === form.raceNo) ?? null)
                  : null
              }
              onSave={handleSave}
              onEditLast={handleEditLast}
              onCancelEdit={handleCancelEdit}
            />
          )
        ) : null}

        {tab === 'bets' ? (
          <BetsTab
            card={activeCard}
            actualCourseRates={actualCourseRates}
            resultCount={stats.resultCount}
            results={activeResults}
            tenji={activeTenji}
            lensRecord={lensRecord}
            odds={activeOdds}
            calibration={calibration}
            now={now}
            onBuy={viewing ? undefined : handleBuy}
            focusRaceNo={form.raceNo}
            onImport={handleImportCard}
            onClearCard={handleClearCard}
            importError={importError}
            readOnly={viewing}
          />
        ) : null}

        {tab === 'calendar' ? (
          <CalendarTab
            schedule={calendar}
            today={todayIso()}
            onOpenGuide={() => setGuideOpen(true)}
          />
        ) : null}

        {tab === 'odds' ? (
          <OddsTab
            odds={activeOdds}
            raceCard={activeCard}
            raceNo={form.raceNo}
            onChangeRace={handleChangeRace}
          />
        ) : null}

        {tab === 'stats' ? <StatsTab stats={stats} /> : null}

        {tab === 'tally' ? (
          <TallyTab
            myBets={myBets}
            tally={tally}
            hasCard={activeCard !== null}
            total={total}
            totalLoading={totalLoading}
            totalError={totalError}
            onRequestTotal={handleRequestTotal}
          />
        ) : null}

        {tab === 'export' ? (
          <ExportTab
            text={exportText}
            csv={exportCsv}
            hasLogs={activeLogs.length > 0}
            onRequestClearAll={() => setPendingConfirm('clearAll')}
            onToast={setToast}
            readOnly={viewing}
          />
        ) : null}
      </main>

      <HitCelebration
        hits={celebration.hits}
        multiples={celebration.hits.map(() => null)}
        token={celebration.token}
        onDone={() => setCelebration({ hits: [], token: 0 })}
      />

      <TabBar active={tab} onChange={setTab} />

      <DayPicker
        open={dayPickerOpen}
        entries={dayEntries}
        currentDate={raceDate}
        viewDate={viewDate}
        onSelect={handleSelectDay}
        onClose={() => setDayPickerOpen(false)}
      />

      <Toast message={toast} onDismiss={() => setToast(null)} />

      <ConfirmDialog
        open={pendingConfirm === 'saveWithoutResult'}
        title="結果の1着が未入力です"
        body="このまま記録しますか？（あとから修正できます）"
        confirmLabel="このまま記録する"
        onConfirm={() => {
          setPendingConfirm(null);
          commit();
        }}
        onCancel={() => setPendingConfirm(null)}
      />

      <ConfirmDialog
        open={pendingConfirm === 'clearAll'}
        title={`${formatDateLabel(raceDate)} の記録を消しますか？`}
        body="この操作は取り消せません。先に書き出してコピーしておくことをおすすめします。"
        confirmLabel="消す"
        destructive
        onConfirm={handleClearAll}
        onCancel={() => setPendingConfirm(null)}
      />
    </>
  );
}
