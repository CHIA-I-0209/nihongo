// 版本號：透過 GitHub Actions 發布時會自動換成這次的 commit 編號，使用者就會收到「有新版本」提示
const VERSION = 'v2.0.0';
const SHELL = `shell-${VERSION}`;
const FONTS = 'fonts';

const SHELL_FILES = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'js/main.js',
  'js/db.js',
  'js/seed.js',
  'js/exercises.js',
  'js/conjugate.js',
  'js/fsrs.js',
  'js/kana.js',
  'js/furigana.js',
  'js/cloud.js',
  'js/ui.js',
  'js/auth.js',
  'js/editor.js',
  'js/device.js',
  'config.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== SHELL).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // 同步請求（POST 到 Apps Script）不經過快取
  const url = new URL(req.url);

  // Google Fonts：先用快取，背景更新
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith((async () => {
      const cache = await caches.open(FONTS);
      const hit = await cache.match(req);
      const net = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    })());
    return;
  }

  if (url.origin !== self.location.origin) return;

  // App 本身：快取優先，離線也能開
  event.respondWith((async () => {
    const cache = await caches.open(SHELL);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch (e) {
      if (req.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
      return Response.error();
    }
  })());
});
