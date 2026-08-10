/**
 * 締切時刻から「いま見るべきレース」を割り出す。
 *
 * 出走表には電話投票の締切予定時刻（"15:17" のような文字列）が入っている。
 * 現地では毎回レース番号を送る操作が発生するので、
 * 次に締切が来るレースを自動で選べるようにする。
 *
 * 住之江のナイターは15時台〜20時半で、日付をまたがない。
 *
 * **ただし時刻だけで比べてはいけない。** 出走表は前日のものが残っていることがあり、
 * 時刻だけを見ると「昨日の4R（16:28締切）があと10分で締切」と出る
 * （2026-08-10 の16:18に実機で踏んだ）。**必ず出走表の日付と一緒に判断する。**
 */

import { daysUntil } from './calendar';
import type { CardRace } from './raceCard';
import { todayIso } from './raceDate';

export interface RaceSchedule {
  /** 次に締切が来るレース番号。全部過ぎていれば最後のレース */
  currentRaceNo: number | null;
  /** 締切までの残り分。過ぎていれば負の値、締切が読めなければ null */
  minutesLeft: number | null;
  /** 締切を過ぎているか */
  closed: boolean;
  /** 締切時刻の文字列（表示用） */
  deadline: string | null;
  /** 締切を過ぎたレース数 */
  finishedCount: number;
}

/** "15:17" を当日の0時からの分数に変換する。読めなければ null。 */
export function parseDeadlineMinutes(deadline: string): number | null {
  const matched = deadline.match(/^(\d{1,2}):(\d{2})$/);
  if (!matched) return null;
  const hours = Number(matched[1]);
  const minutes = Number(matched[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function nowMinutes(now: Date): number {
  return now.getHours() * 60 + now.getMinutes();
}

/**
 * 出走表の日付が今日から何分ずれているか。
 *
 * 昨日の出走表なら -1440 分。これを締切時刻に足すことで、
 * 前日のレースは必ず「締切済み」になる。
 * 日付が分からなければ 0（今日として扱う。従来どおりの動き）。
 */
function dayOffsetMinutes(now: Date, cardDate?: string | null): number {
  if (!cardDate) return 0;
  return daysUntil(todayIso(now), cardDate) * 24 * 60;
}

/**
 * 締切時刻を見て、いま注目すべきレースを決める。
 *
 * 「次に締切が来るレース」= まだ締切が過ぎていない最小のレース番号。
 * 全部過ぎていれば最後のレースを返す（振り返り用）。
 */
export function resolveSchedule(
  races: CardRace[],
  now: Date = new Date(),
  cardDate?: string | null,
): RaceSchedule {
  const offset = dayOffsetMinutes(now, cardDate);
  const withDeadline = races
    .map((race) => {
      const at = parseDeadlineMinutes(race.deadline);
      return { race, at: at === null ? null : at + offset };
    })
    .filter((entry): entry is { race: CardRace; at: number } => entry.at !== null)
    .sort((a, b) => a.race.raceNo - b.race.raceNo);

  if (withDeadline.length === 0) {
    return {
      currentRaceNo: races[0]?.raceNo ?? null,
      minutesLeft: null,
      closed: false,
      deadline: null,
      finishedCount: 0,
    };
  }

  const current = nowMinutes(now);
  const finishedCount = withDeadline.filter((entry) => entry.at <= current).length;
  const upcoming = withDeadline.find((entry) => entry.at > current);
  const target = upcoming ?? withDeadline[withDeadline.length - 1];

  return {
    currentRaceNo: target.race.raceNo,
    minutesLeft: target.at - current,
    closed: upcoming === undefined,
    deadline: target.race.deadline,
    finishedCount,
  };
}

/**
 * 指定した締切時刻までの残り分を返す。
 *
 * 「次に締まるレース」ではなく「いま画面で見ているレース」の残り時間を出すために使う。
 * 見ているレースの締切が知りたいのが自然なので、こちらを表示に使う。
 */
export function minutesUntil(
  deadline: string,
  now: Date = new Date(),
  cardDate?: string | null,
): number | null {
  const at = parseDeadlineMinutes(deadline);
  if (at === null) return null;
  return at + dayOffsetMinutes(now, cardDate) - nowMinutes(now);
}

/** 残り時間を人が読む形にする。 */
export function formatMinutesLeft(minutes: number | null): string | null {
  if (minutes === null) return null;
  if (minutes < 0) return '締切済み';
  if (minutes === 0) return 'まもなく締切';
  if (minutes < 60) return `締切まで${minutes}分`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `締切まで${hours}時間` : `締切まで${hours}時間${rest}分`;
}

/** 締切が近いか（5分以内）。表示を強調するのに使う。 */
export function isUrgent(minutes: number | null): boolean {
  return minutes !== null && minutes >= 0 && minutes <= 5;
}
