/**
 * Service Worker を生成する（`next build` の後に実行）。
 *
 * Next.js の静的エクスポートはアセット名にハッシュを付けるため、
 * プリキャッシュの一覧を手書きすると必ずズレる。
 * ビルド出力（out/）を実際に走査して一覧を作り、`out/sw.js` を書き出す。
 *
 * **完全オフラインは要件から外した**（2026-08-10）。
 * オフラインを守るための仕組みが、いちばんの故障源だった
 * （8/9 に端末が4時間前のオッズを返し続け、原因の切り分けに3時間かかった）。
 *
 * いまの方針は「外枠だけキャッシュ、データは必ず通信」:
 *   - HTML/JS/CSS（名前にハッシュが付く）→ キャッシュ優先。開いた瞬間に画面が出る
 *   - JSON（名前が変わらず中身が変わる）→ **常に通信**。古い値を返さない
 *   - 電波が切れているときだけ、最後に取れた内容を出して白い画面を避ける
 *
 *   node scripts/build-sw.mjs
 */

import { createHash } from 'node:crypto';
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'out');
const SW_PATH = join(OUT_DIR, 'sw.js');

/** キャッシュしないファイル（SW 自身と、あってもオフラインに効かないもの） */
const EXCLUDE = new Set(['sw.js']);

function walk(dir) {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      entries.push(...walk(full));
    } else {
      entries.push(full);
    }
  }
  return entries;
}

function toUrlPath(absolutePath) {
  const rel = relative(OUT_DIR, absolutePath).split(sep).join(posix.sep);
  return `/${rel}`;
}

let files;
try {
  files = walk(OUT_DIR);
} catch {
  console.error(`[build-sw] ${OUT_DIR} が見つかりません。先に \`next build\` を実行してください。`);
  process.exit(1);
}

const urls = new Set();
for (const file of files) {
  const urlPath = toUrlPath(file);
  if (EXCLUDE.has(urlPath.slice(1))) continue;
  // 過去日のアーカイブは precache しない（蓄積で肥大するため。過去日閲覧はオンライン前提）
  if (urlPath.startsWith('/archive/')) continue;
  /**
   * OCR の実行ファイルと言語データ（5MB超）も precache しない。
   * **写真取り込みを使うときにしか要らない。** 全員に初回5MBを配ると、
   * 現地の細い回線で最初の1画面が出るまで待たされる。
   * 一度使えば fetch ハンドラ側でキャッシュに入り、以降はオフラインでも動く。
   */
  if (urlPath.startsWith('/ocr/')) continue;
  urls.add(urlPath);
  // trailingSlash: true なので index.html はディレクトリ URL でも要求される
  if (urlPath.endsWith('/index.html')) {
    urls.add(urlPath.slice(0, -'index.html'.length));
  }
}

const assets = [...urls].sort();
const version = createHash('sha256').update(assets.join('\n')).digest('hex').slice(0, 12);

const sw = `/* 自動生成 — scripts/build-sw.mjs が出力。直接編集しないこと。 */
/* アセット ${assets.length} 件 / version ${version} */

const CACHE_NAME = 'suminoe-log-${version}';
const ASSETS = ${JSON.stringify(assets, null, 2)};

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // 1件でも失敗すると addAll 全体が落ちるため、個別に入れて取りこぼしを防ぐ
      await Promise.all(
        ASSETS.map(async (url) => {
          try {
            const response = await fetch(url, { cache: 'reload' });
            if (response.ok) await cache.put(url, response);
          } catch {
            /* 個別の失敗は無視して他を続ける */
          }
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name.startsWith('suminoe-log-') && name !== CACHE_NAME)
             .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

/**
 * **データは1つ残らず通信優先にする。**
 *
 * 以前は名前を挙げた5つだけを通信優先にしていたが、データを1つ足すたびに
 * ここへ書き足す必要があり、書き忘れればまた「端末だけ古い」が起きる。
 * **JSON はすべて通信優先**にして、書き忘れようのない形にした。
 *
 * 骨格（HTML/JS/CSS）はファイル名にハッシュが付くので、キャッシュ優先のままでよい。
 */
const LIVE_DATA = /\\.json$/;

/**
 * 回線待ちの上限。これを過ぎたら最後に取れた内容を出す。
 * オンライン前提にしたので短くしてよい（待たせるより、古いと分かる値を出すほうがまし）。
 */
const NETWORK_TIMEOUT_MS = 4000;

/**
 * 通信優先。取れたら必ず新しいものを返し、取れなければ前回の内容を返す。
 * 途中の proxy に古い版を掴まれないよう no-store で要求する。
 */
async function liveFirst(cache, request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    const fresh = await fetch(new Request(request.url, { cache: 'no-store' }), {
      signal: controller.signal,
    });
    if (fresh.ok) {
      // 次のオフラインに備えて置き換える。応答は待たせない
      cache.put(request, fresh.clone());
      return fresh;
    }
  } catch {
    /* オフラインか時間切れ。下のキャッシュに落とす */
  } finally {
    clearTimeout(timer);
  }

  const cached = await cache.match(request, { ignoreSearch: true });
  return cached || new Response('', { status: 504, statusText: 'offline' });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // SW 自身は横取りしない（更新の妨げになる）
  if (url.pathname === '/sw.js') return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // ページ遷移: キャッシュ優先。無ければルートを返す（単一ページ構成のため）
      if (request.mode === 'navigate') {
        return (
          (await cache.match(request, { ignoreSearch: true })) ||
          (await cache.match('/')) ||
          (await cache.match('/index.html')) ||
          fetch(request)
        );
      }

      if (LIVE_DATA.test(url.pathname)) return liveFirst(cache, request);

      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;

      try {
        const response = await fetch(request);
        if (response.ok && response.type === 'basic') {
          cache.put(request, response.clone());
        }
        return response;
      } catch (error) {
        // オフラインで未キャッシュのものを求められた場合
        return new Response('', { status: 504, statusText: 'offline' });
      }
    })()
  );
});
`;

writeFileSync(SW_PATH, sw, 'utf8');
console.log(`[build-sw] ${relative(process.cwd(), SW_PATH)} を生成 (${assets.length} 件, version ${version})`);
for (const asset of assets.slice(0, 12)) console.log(`  ${asset}`);
if (assets.length > 12) console.log(`  ... 他 ${assets.length - 12} 件`);
