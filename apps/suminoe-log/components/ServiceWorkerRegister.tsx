'use client';

import { useEffect } from 'react';

/**
 * Service Worker を登録し、新しいバージョンが出ていれば次の起動で反映する。
 *
 * 競艇場は来場者が多く回線が不安定になりやすい。
 * 初回読み込み後はネット接続なしで全機能が使えることが必須要件のため、
 * SW の fetch はキャッシュ優先にしている（`scripts/build-sw.mjs`）。
 *
 * ただしキャッシュ優先のままだと、アプリを直しても端末が古い版を表示し続ける。
 * そこで起動時に更新を確認し、新しい SW が主導権を取ったら1回だけ再読み込みする。
 * 入力途中の内容は下書きとして即時保存しているので、再読み込みでも失われない。
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    // 初回登録なのか、既存の SW からの更新なのかを区別する
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloading = false;

    const onControllerChange = () => {
      // 初回登録では再読み込みしない（ループを防ぐ）
      if (!hadController || reloading) return;
      reloading = true;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    const register = () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          // オフラインなら失敗するが、その場合はキャッシュで動き続ける
          registration.update().catch(() => undefined);
        })
        .catch(() => {
          // 登録失敗でもアプリ自体は動く（オンライン時のみになる）
        });
    };

    if (document.readyState === 'complete') {
      register();
    } else {
      window.addEventListener('load', register, { once: true });
    }

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  return null;
}
