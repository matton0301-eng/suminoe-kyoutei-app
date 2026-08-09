/**
 * その日の「締切直前のオッズ」を1本にまとめて書き出す。
 *
 *   tools/suminoe-mcp/node_modules/.bin/tsx tools/suminoe-mcp/scripts/build-closing-odds.ts [--date 2026-08-09]
 *
 * **なぜ要るか。**
 * `cache/odds/<日付>/<HHMM>.json` には15分おきのスナップショットが積まれるが、
 * 検証に要るのは「そのレースを買った時点のオッズ」＝締切直前の1枚だけ。
 * 25枚をそのまま配ると重いうえ、後から使うとき毎回選び直すことになる。
 *
 * これがあると、**任意の買い方の回収率を過去に遡って測れる**。
 * 2026-08-09 に「期待値順と確率順のどちらがマシか」を判定できなかったのは、
 * 過去の全オッズが無かったからで、それを埋めるための出力。
 *
 * 出力: apps/suminoe-log/public/archive/closing-odds-YYYYMMDD.json
 *
 * 終了コード:
 *   0  書き出した
 *   1  エラー
 *   4  スナップショットが1枚も無い
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(HERE, '..', '..', '..', 'apps', 'suminoe-log', 'public');
const ARCHIVE_DIR = join(PUBLIC_DIR, 'archive');
const HISTORY_DIR = join(HERE, '..', '..', 'suminoe-read', 'cache', 'odds');

const SCHEMA_VERSION = 1;
const EXIT_NO_DATA = 4;

interface SnapshotRace {
  raceNo: number;
  fetchedAt: string | null;
  trifecta: Record<string, number> | null;
  trio: Record<string, number> | null;
}

interface Snapshot {
  date: string;
  updatedAt: string;
  races: SnapshotRace[];
}

function parseArgDate(): string {
  const index = process.argv.indexOf('--date');
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  const now = new Date();
  const jst = new Date(now.getTime() + (9 * 60 + now.getTimezoneOffset()) * 60_000);
  return jst.toISOString().slice(0, 10);
}

/** "15:17" → 分に直す。締切と取得時刻を比べるためだけに使う */
function toMinutes(hhmm: string): number | null {
  const matched = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!matched) return null;
  return Number(matched[1]) * 60 + Number(matched[2]);
}

/** 出走表から締切時刻を読む。無ければ空の Map を返す（その場合は最後の1枚を使う） */
function readDeadlines(date: string): Map<number, number> {
  const compact = date.replaceAll('-', '');
  const candidates = [
    join(ARCHIVE_DIR, `racecard-${compact}.json`),
    join(PUBLIC_DIR, 'racecard.json'),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const card = JSON.parse(readFileSync(path, 'utf8')) as {
        date?: string;
        races?: { raceNo?: number; deadline?: string | null }[];
      };
      if (card.date !== date) continue;
      const map = new Map<number, number>();
      for (const race of card.races ?? []) {
        const minutes = race.deadline ? toMinutes(race.deadline) : null;
        if (typeof race.raceNo === 'number' && minutes !== null) map.set(race.raceNo, minutes);
      }
      if (map.size > 0) return map;
    } catch {
      /* 壊れていれば次の候補へ */
    }
  }
  return new Map();
}

function main(): void {
  const date = parseArgDate();
  const dir = join(HISTORY_DIR, date.replaceAll('-', ''));

  if (!existsSync(dir)) {
    console.error(`${date} のオッズ推移がありません（${dir}）。`);
    process.exit(EXIT_NO_DATA);
  }

  // ファイル名が HHMM なので、名前順がそのまま時刻順になる
  const files = readdirSync(dir)
    .filter((name) => /^\d{4}\.json$/.test(name))
    .sort();

  if (files.length === 0) {
    console.error(`${date} のスナップショットが1枚もありません。`);
    process.exit(EXIT_NO_DATA);
  }

  const snapshots = files.map((name) => ({
    stamp: Number(name.slice(0, 2)) * 60 + Number(name.slice(2, 4)),
    label: `${name.slice(0, 2)}:${name.slice(2, 4)}`,
    data: JSON.parse(readFileSync(join(dir, name), 'utf8')) as Snapshot,
  }));

  const deadlines = readDeadlines(date);
  console.log(`${date}  スナップショット ${snapshots.length}枚 / 締切が読めたレース ${deadlines.size}件`);

  const races: (SnapshotRace & { source: string; deadline: string | null })[] = [];

  for (const raceNo of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
    const deadline = deadlines.get(raceNo) ?? null;

    /**
     * 締切**以前**の最後の1枚を採る。締切を過ぎた後のオッズは確定値だが、
     * 買う時点では見えていないので、検証には使えない（後知恵になる）。
     * 締切が分からない日は、その日の最後の1枚で代用する。
     */
    const usable = snapshots.filter((snapshot) => {
      const race = snapshot.data.races?.find((entry) => entry.raceNo === raceNo);
      if (!race || !race.trifecta || Object.keys(race.trifecta).length === 0) return false;
      return deadline === null || snapshot.stamp <= deadline;
    });

    const picked = usable.at(-1);
    if (!picked) {
      races.push({
        raceNo,
        fetchedAt: null,
        trifecta: null,
        trio: null,
        source: '該当なし',
        deadline: null,
      });
      console.log(`  ${raceNo}R: 締切前のオッズが取れていません`);
      continue;
    }

    const race = picked.data.races.find((entry) => entry.raceNo === raceNo)!;
    const deadlineLabel =
      deadline === null
        ? null
        : `${String(Math.floor(deadline / 60)).padStart(2, '0')}:${String(deadline % 60).padStart(2, '0')}`;
    races.push({ ...race, source: picked.label, deadline: deadlineLabel });
    const gap = deadline === null ? '—' : `${deadline - picked.stamp}分前`;
    console.log(`  ${raceNo}R: ${picked.label} 時点（締切 ${deadlineLabel ?? '不明'} の ${gap}）`);
  }

  const covered = races.filter((race) => race.trifecta !== null).length;
  if (covered === 0) {
    console.error('締切前のオッズが1レースも揃いませんでした。書き出しません。');
    process.exit(EXIT_NO_DATA);
  }

  mkdirSync(ARCHIVE_DIR, { recursive: true });
  const outPath = join(ARCHIVE_DIR, `closing-odds-${date.replaceAll('-', '')}.json`);
  writeFileSync(
    outPath,
    JSON.stringify({ schemaVersion: SCHEMA_VERSION, date, snapshots: snapshots.length, races }),
    'utf8',
  );
  console.log(`\n出力: ${outPath}（${covered} / 12 レース）`);
}

main();
