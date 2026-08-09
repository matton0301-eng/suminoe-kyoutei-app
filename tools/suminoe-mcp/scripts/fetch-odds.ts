/**
 * 全12Rの3連単・3連複オッズを取得して odds.json に書き出す。
 *
 *   tools/suminoe-mcp/node_modules/.bin/tsx tools/suminoe-mcp/scripts/fetch-odds.ts [--date 2026-08-09]
 *
 * **オッズは締切直前まで動く。** レースごとに取得時刻を持たせ、画面には必ずそれを出す。
 * 30分おきのタスクで回すので、現地で見る値は最大30分古い可能性がある。
 *
 * 出力:
 *   apps/suminoe-log/public/odds.json
 *   apps/suminoe-log/public/archive/odds-YYYYMMDD.json
 *
 * 終了コード:
 *   0  書き出した
 *   1  エラー
 *   3  前回と中身が同じ（デプロイ不要）
 *   4  1レースも取得できなかった（既存ファイルは触っていない）
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchOdds, type RaceOdds } from '../lib/odds.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(HERE, '..', '..', '..', 'apps', 'suminoe-log', 'public');
const OUT_PATH = join(PUBLIC_DIR, 'odds.json');
const ARCHIVE_DIR = join(PUBLIC_DIR, 'archive');

/**
 * オッズの推移をためる場所（git 管理外）。
 *
 * **オッズは当日しか取れない。** 過去に遡って取得する手段が無いので、
 * 取れたときに必ず残す。これが無いと「期待値の高い買い目を実際に買ったら
 * どうなったか」を後から検証できない（2026-08-09 時点で、確率順に買った
 * 場合の回収率しか測れていないのはこれが理由）。
 *
 * レース終了後に取ったものが確定オッズで、任意の買い方の回収率を計算できる。
 */
const HISTORY_DIR = join(HERE, '..', '..', 'suminoe-read', 'cache', 'odds');

const SCHEMA_VERSION = 1;
const RACES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
/** 連続でこの回数失敗したら打ち切る（発売前は全レースが空なので、粘っても意味がない） */
const MAX_CONSECUTIVE_FAILURES = 6;

const EXIT_UNCHANGED = 3;
const EXIT_NO_DATA = 4;

interface RaceOddsPayload {
  raceNo: number;
  /** そのレースのオッズを取った時刻。null は取れていない */
  fetchedAt: string | null;
  trifecta: Record<string, number> | null;
  trio: Record<string, number> | null;
}

function toMap(odds: RaceOdds | null): Record<string, number> | null {
  if (!odds) return null;
  const map: Record<string, number> = {};
  for (const entry of odds.entries) {
    if (entry.odds !== null) map[entry.combo.join('-')] = entry.odds;
  }
  return Object.keys(map).length > 0 ? map : null;
}

function jstNow(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.toISOString().slice(0, 19)}+09:00`;
}

function parseArgs(argv: string[]): { date: string } {
  const index = argv.indexOf('--date');
  if (index >= 0 && argv[index + 1]) {
    const value = argv[index + 1];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      console.error(`--date は YYYY-MM-DD 形式で指定してください: ${value}`);
      process.exit(1);
    }
    return { date: value };
  }
  return { date: jstNow().slice(0, 10) };
}

/** 取得時刻を除いて中身が同じか。オッズが動いていなければデプロイしない */
function isSameContent(previous: unknown, current: RaceOddsPayload[]): boolean {
  if (typeof previous !== 'object' || previous === null) return false;
  const record = previous as Record<string, unknown>;
  if (!Array.isArray(record.races)) return false;
  const strip = (races: RaceOddsPayload[]) =>
    JSON.stringify(races.map(({ raceNo, trifecta, trio }) => ({ raceNo, trifecta, trio })));
  return strip(record.races as RaceOddsPayload[]) === strip(current);
}

async function main(): Promise<void> {
  const { date } = parseArgs(process.argv.slice(2));
  console.log(`住之江 オッズ取得  対象日 ${date}`);

  const races: RaceOddsPayload[] = [];
  let fetched = 0;
  let consecutiveFailures = 0;

  for (const raceNo of RACES) {
    // fetchOdds が 1.5 秒間隔を守る（公式サイトへの礼儀）
    const [trifecta, trio] = [
      await fetchOdds(date, raceNo, 'trifecta'),
      await fetchOdds(date, raceNo, 'trio'),
    ];

    const trifectaMap = toMap(trifecta);
    const trioMap = toMap(trio);
    const ok = trifectaMap !== null || trioMap !== null;

    races.push({
      raceNo,
      // fetchOdds は UTC の ISO を返す。画面に出すのは JST なのでここで揃える
      fetchedAt: ok ? jstNow() : null,
      trifecta: trifectaMap,
      trio: trioMap,
    });

    if (ok) {
      fetched += 1;
      consecutiveFailures = 0;
      console.log(
        `  ${raceNo}R: 3連単 ${Object.keys(trifectaMap ?? {}).length} 通り / ` +
          `3連複 ${Object.keys(trioMap ?? {}).length} 通り`,
      );
    } else {
      consecutiveFailures += 1;
      console.log(`  ${raceNo}R: まだ発売前（オッズなし）`);
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.log(`  ${consecutiveFailures}レース続けて取れないので打ち切ります`);
        for (const rest of RACES.slice(RACES.indexOf(raceNo) + 1)) {
          races.push({ raceNo: rest, fetchedAt: null, trifecta: null, trio: null });
        }
        break;
      }
    }
  }

  console.log(`  取得できたレース: ${fetched} / ${RACES.length}`);

  if (fetched === 0) {
    console.error('1レースもオッズを取得できませんでした。既存のファイルはそのままにします。');
    process.exit(EXIT_NO_DATA);
  }

  const payloadForHistory = {
    schemaVersion: SCHEMA_VERSION,
    date,
    updatedAt: jstNow(),
    races,
  };

  // 推移を残す。前回と同じ内容でも残す（「その時刻にこの値だった」が記録になる）。
  // アプリ用の書き出しより先に行う。変化なしで早期に抜けても履歴は失わない
  const historyDir = join(HISTORY_DIR, date.replaceAll('-', ''));
  mkdirSync(historyDir, { recursive: true });
  const stamp = payloadForHistory.updatedAt.slice(11, 16).replace(':', '');
  const historyPath = join(historyDir, `${stamp}.json`);
  writeFileSync(historyPath, JSON.stringify(payloadForHistory), 'utf8');
  console.log(`  推移を保存: ${historyPath}`);

  const previous = existsSync(OUT_PATH)
    ? (JSON.parse(readFileSync(OUT_PATH, 'utf8')) as unknown)
    : null;

  const previousDate =
    typeof previous === 'object' && previous !== null
      ? (previous as Record<string, unknown>).date
      : null;

  if (previousDate === date && isSameContent(previous, races)) {
    console.log('前回と中身が同じです。書き換えません（デプロイ不要）。');
    process.exit(EXIT_UNCHANGED);
  }

  const text = JSON.stringify(payloadForHistory);

  writeFileSync(OUT_PATH, text, 'utf8');
  console.log(`  出力: ${OUT_PATH}`);

  mkdirSync(ARCHIVE_DIR, { recursive: true });
  const archivePath = join(ARCHIVE_DIR, `odds-${date.replaceAll('-', '')}.json`);
  writeFileSync(archivePath, text, 'utf8');
  console.log(`  出力: ${archivePath}`);

  console.log('オッズは締切直前まで動きます。画面の取得時刻を必ず見てください。');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
