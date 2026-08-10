/**
 * Service Worker。
 *
 * **2026-08-10 に作り直した。** それまではビルド出力を走査して全アセットを
 * プリキャッシュしていたが、「完全オフラインで全機能」を要件から外したので、
 * その仕組みごと不要になった。
 *
 * オフラインを守るための仕組みが、いちばんの故障源だった。
 * 8/9 に端末が4時間前のオッズを返し続け、原因の切り分けに3時間かかっている。
 *
 * いまの役割は2つだけ:
 *   1. 一度読んだ骨格（HTML/JS/CSS）を返して、開いた瞬間に画面を出す
 *   2. 電波が切れているときに、最後に取れた内容を出して白い画面を避ける
 *
 * **データ（JSON・API）は必ず通信を先に試す。** 古い値を返さない。
 *
 * プリキャッシュしないので、**ビルド時に生成する必要がない**（手書きでよい）。
 * 以前は「手書きするとハッシュ付きのアセット名とズレる」ため生成していたが、
 * 一覧を持たなくなったのでその問題自体が消えた。
 */

const CACHE_NAME = 'suminoe-log-v3';

/** 回線待ちの上限。過ぎたら最後に取れた内容を出す */
const NETWORK_TIMEOUT_MS = 4000;

/**
 * 常に通信を先に試すもの。
 *
 * **JSON と API はすべて対象。** 個別に列挙すると、データを1つ足すたびに
 * 書き足す必要があり、書き忘れれば「端末だけ古い」が再発する。
 */
function isLiveData(url) {
  return url.pathname.endsWith('.json') || url.pathname.startsWith('/api/');
}

self.addEventListener('install', () => {
  // プリキャッシュしないので、すぐ使える状態にする
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('suminoe-log-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

/** 通信優先。取れたら必ず新しいものを返し、取れなければ前回の内容を返す */
async function networkFirst(cache, request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    const fresh = await fetch(new Request(request.url, { cache: 'no-store' }), {
      signal: controller.signal,
    });
    if (fresh.ok) {
      // 次に電波が切れたときのために置き換える。応答は待たせない
      cache.put(request, fresh.clone());
      return fresh;
    }
  } catch {
    /* オフラインか時間切れ。下のキャッシュに落ちる */
  } finally {
    clearTimeout(timer);
  }

  const cached = await cache.match(request, { ignoreSearch: true });
  return cached || new Response('', { status: 504, statusText: 'offline' });
}

/**
 * キャッシュを返しつつ、裏で取り直す。
 * 骨格はファイル名にハッシュが付くので、古いものを返しても壊れない。
 * それでいて次の起動には新しい版が入っている。
 */
async function staleWhileRevalidate(cache, request) {
  const cached = await cache.match(request, { ignoreSearch: true });
  const network = fetch(request)
    .then((response) => {
      if (response.ok && response.type === 'basic') cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  if (cached) {
    void network;
    return cached;
  }
  const fresh = await network;
  return fresh || new Response('', { status: 504, statusText: 'offline' });
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

      if (isLiveData(url)) return networkFirst(cache, request);

      // ページ遷移: 通信を先に試し、駄目ならキャッシュ（単一ページ構成）
      if (request.mode === 'navigate') {
        try {
          const fresh = await fetch(request);
          if (fresh.ok) {
            cache.put(request, fresh.clone());
            return fresh;
          }
        } catch {
          /* オフライン */
        }
        return (
          (await cache.match(request, { ignoreSearch: true })) ||
          (await cache.match('/')) ||
          new Response('', { status: 504, statusText: 'offline' })
        );
      }

      return staleWhileRevalidate(cache, request);
    })(),
  );
});
