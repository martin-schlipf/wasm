// Cross-origin isolation for hosts that cannot set response headers (GitHub
// Pages). Shared memory between workers needs the page to be served with
//   Cross-Origin-Opener-Policy: same-origin
//   Cross-Origin-Embedder-Policy: require-corp
// This file is both halves of a workaround: loaded by the page, it registers
// itself as a service worker and reloads once; running as that service worker,
// it adds the two headers to every response of this origin.
//
// A server that sends the headers itself (tools/serve.mjs) makes the page
// isolated from the start, and this file then does nothing. Add ?nocoi to the
// URL to test the page without it.
if (typeof window === 'undefined') {
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
  self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
    e.respondWith(fetch(req).then((res) => {
      if (res.status === 0) return res;
      const headers = new Headers(res.headers);
      headers.set('Cross-Origin-Opener-Policy', 'same-origin');
      headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
      headers.set('Cross-Origin-Resource-Policy', 'same-origin');
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }));
  });
} else if (!window.crossOriginIsolated && window.isSecureContext && 'serviceWorker' in navigator
           && !new URLSearchParams(location.search).has('nocoi')) {
  const key = 'coi-reloaded';
  let reloaded = false;
  try { reloaded = sessionStorage.getItem(key) === '1'; } catch (e) { /* no storage */ }
  // app.js waits for this before it decides that the page cannot be isolated.
  window.coiPending = !reloaded;
  navigator.serviceWorker.register(document.currentScript.src).then((reg) => {
    if (reloaded) return;
    try { sessionStorage.setItem(key, '1'); } catch (e) { /* no storage */ }
    const reload = () => location.reload();
    if (navigator.serviceWorker.controller) reload();
    else navigator.serviceWorker.addEventListener('controllerchange', reload);
  }, () => { window.coiPending = false; });
}
