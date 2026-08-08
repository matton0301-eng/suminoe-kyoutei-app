/**
 * リポジトリ内のデータの置き場所。
 *
 * この MCP サーバーはリポジトリの中で動く前提。ファイルは**読むだけ**で書かない。
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** tools/suminoe-mcp/lib から3つ上がリポジトリルート */
export const REPO_ROOT = join(HERE, '..', '..', '..');

/** リードが書き出した日付つきの出走表・結果（アプリが配信しているものと同じ） */
export const ARCHIVE_DIR = join(REPO_ROOT, 'apps', 'suminoe-log', 'public', 'archive');

/** 照合レポート（review_YYYYMMDD.md） */
export const REVIEW_DIR = join(REPO_ROOT, 'tools', 'suminoe-read', 'output');

/**
 * アプリの書き出しタブから保存した観戦記録の置き場。
 *
 * 記録はブラウザの localStorage にあるので、ここにはユーザーが手で置く。
 * 置かれていなければツールが置き場を案内する。
 */
export const EXPORTED_LOGS_DIR = join(HERE, '..', 'data', 'logs');
