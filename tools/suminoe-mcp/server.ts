/**
 * 住之江観戦ツールの MCP サーバー（stdio）。
 *
 * 蓄積した出走表・結果・収支・照合レポートと、公式サイトの現在オッズを Claude から読む。
 *
 * **すべて読み取り専用。** ファイルを書かず、状態も持たない（オッズの短期キャッシュだけ）。
 * 賭け金の推奨や断定的な的中予測はしない。データを返すだけで、判断は対話の側に置く。
 *
 * **stdio なので console.log を使わない**（プロトコルが壊れる）。ログは console.error へ。
 *
 *   npx tsx server.ts
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import {
  computeTally,
  listDays,
  readCard,
  readExportedLogs,
  readResults,
  readReviewMarkdown,
} from './lib/data.js';
import { EXPORTED_LOGS_DIR } from './lib/paths.js';
import { fetchOdds } from './lib/odds.js';

const server = new McpServer({ name: 'suminoe', version: '0.1.0' });

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 形式で指定してください');
const RACE_NO = z.number().int().min(1).max(12);

function jsonResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 1) }] };
}

server.registerTool(
  'suminoe_list_days',
  {
    description:
      '住之江観戦ツールに蓄積された開催日の一覧。各日の出走表・結果・照合レポートの有無つき',
    inputSchema: {},
  },
  async () => jsonResult(listDays()),
);

server.registerTool(
  'suminoe_get_racecard',
  {
    description:
      '指定日の出走表と事前分析（判定・買い目の型）。raceNo を指定するとそのレースの詳細、' +
      '省略すると12レースぶんの要約を返す',
    inputSchema: { date: DATE, raceNo: RACE_NO.optional() },
  },
  async ({ date, raceNo }) => {
    const card = readCard(date);
    if (!card) return jsonResult({ error: `${date} の出走表はありません` });
    if (raceNo === undefined) {
      return jsonResult({
        date: card.date,
        title: card.title,
        dayLabel: card.dayLabel,
        races: card.races.map((race) => ({
          raceNo: race.raceNo,
          name: race.name,
          deadline: race.deadline,
          verdict: race.verdict,
          betShape: race.betShape,
        })),
      });
    }
    const race = card.races.find((entry) => entry.raceNo === raceNo);
    return jsonResult(race ?? { error: `${date} に ${raceNo}R はありません` });
  },
);

server.registerTool(
  'suminoe_get_results',
  {
    description:
      '指定日の競走成績（着順・決まり手・全賭式の払戻）。raceNo を指定するとそのレースの詳細、' +
      '省略すると12レースぶんの要約を返す',
    inputSchema: { date: DATE, raceNo: RACE_NO.optional() },
  },
  async ({ date, raceNo }) => {
    const results = readResults(date);
    if (!results) return jsonResult({ error: `${date} の結果はありません（未確定の可能性）` });
    if (raceNo === undefined) {
      return jsonResult({
        date: results.date,
        courseRates: results.courseRates,
        wakunariCount: results.wakunariCount,
        races: results.races.map((race) => ({
          raceNo: race.raceNo,
          order: race.order,
          kimarite: race.kimarite,
          verdict: race.verdict,
          anchor: race.anchor,
          anchorWon: race.anchorWon,
          trifectaYen:
            race.payouts.find((payout) => payout.key === 'trifecta')?.amount ?? null,
        })),
      });
    }
    const race = results.races.find((entry) => entry.raceNo === raceNo);
    return jsonResult(race ?? { error: `${date} に ${raceNo}R の結果はありません` });
  },
);

server.registerTool(
  'suminoe_get_tally',
  {
    description:
      '指定日の収支。提示した8賭式すべてを1点100円で買った場合の実績（賭式別・判定別・レース別）。' +
      '控除率は約25%あるため、母数が増えるほど回収率は75%前後に収束する',
    inputSchema: { date: DATE },
  },
  async ({ date }) => {
    const tally = computeTally(date);
    if (!tally) return jsonResult({ error: `${date} の収支は出せません（出走表か結果が未取得）` });
    return jsonResult({
      ...tally,
      note:
        '1点100円換算の実績。実際に全賭式を同時に買うことはないので目安。' +
        `母数は ${tally.racesFinished} レース。`,
    });
  },
);

server.registerTool(
  'suminoe_get_review',
  {
    description: '指定日の照合レポート（事前の読みと実際の結果の突き合わせ）の全文',
    inputSchema: { date: DATE },
  },
  async ({ date }) => {
    const markdown = readReviewMarkdown(date);
    if (markdown === null) return jsonResult({ error: `${date} の照合レポートはありません` });
    return { content: [{ type: 'text' as const, text: markdown }] };
  },
);

server.registerTool(
  'suminoe_get_my_logs',
  {
    description:
      '指定日の自分の観戦記録（予想・結果・決まり手・メモ）。' +
      'アプリの書き出しタブから保存した CSV を読む',
    inputSchema: { date: DATE },
  },
  async ({ date }) => {
    const csv = readExportedLogs(date);
    if (csv === null) {
      return jsonResult({
        error: `${date} の記録は保存されていません`,
        howTo:
          '記録はブラウザ内（localStorage）にあります。アプリの書き出しタブで CSV をコピーし、' +
          `${EXPORTED_LOGS_DIR} に suminoe-log-${date.replaceAll('-', '')}.csv として保存してください。`,
      });
    }
    return { content: [{ type: 'text' as const, text: csv }] };
  },
);

server.registerTool(
  'suminoe_get_odds',
  {
    description:
      '住之江の3連単オッズを公式サイトから取得する。**オッズは刻々と変わるので取得時刻を必ず添えて扱うこと。**' +
      '事前の読み（suminoe_get_racecard の betShape）との乖離を見る用途。' +
      '発売前・非開催日は取得できない。初版は3連単のみ対応',
    inputSchema: {
      raceNo: RACE_NO,
      date: DATE.optional().describe('省略すると今日'),
      /** 上位だけ返すと応答が読みやすい。0 で全120通り */
      topN: z
        .number()
        .int()
        .min(0)
        .max(120)
        .optional()
        .describe('オッズの低い順に何点返すか。省略時は20、0 で全120通り'),
    },
  },
  async ({ date, raceNo, topN }) => {
    const target = date ?? new Date().toISOString().slice(0, 10);
    const odds = await fetchOdds(target, raceNo);
    if (!odds) {
      return jsonResult({
        error: `${target} ${raceNo}R のオッズを取得できませんでした`,
        reason: '発売前・非開催日・ページ構造の変更のいずれかが考えられます',
      });
    }
    const limit = topN === undefined ? 20 : topN;
    const sorted = [...odds.entries]
      .filter((entry) => entry.odds !== null)
      .sort((a, b) => (a.odds ?? Infinity) - (b.odds ?? Infinity));
    const shown = limit === 0 ? sorted : sorted.slice(0, limit);
    return jsonResult({
      date: odds.date,
      raceNo: odds.raceNo,
      betType: odds.betType,
      fetchedAt: odds.fetchedAt,
      totalCombos: odds.entries.length,
      shownCombos: shown.length,
      entries: shown.map((entry) => ({ combo: entry.combo.join('-'), odds: entry.odds })),
      note: `オッズは変動します。取得時刻: ${odds.fetchedAt}${
        limit === 0 || sorted.length <= limit ? '' : `（人気上位${limit}点のみ表示。全${sorted.length}点）`
      }`,
    });
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[suminoe-mcp] 起動しました（stdio）');
