/* Service worker: makes the game work with no connection at all.
 *
 * The page itself is fetched from the network first whenever there is one, so
 * you always get the newest build rather than a stale cached copy — a real
 * problem for a game that gets fixed often. When the network is missing or
 * slow, the cached copy is served instead, which is what makes the game
 * playable on a plane.
 */
const CACHE = "guesswho-v3";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon.svg",
  "./vendor/peerjs.min.js"
];

self.addEventListener("install", e => {
  // don't let one missing file sink the whole install
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const isPage = req => req.mode === "navigate" || (req.destination === "document");

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // never touch signalling or relays

  if (isPage(req) || url.pathname.endsWith("index.html")){
    // fresh when possible, cached when not
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then(hit => hit || caches.match("./index.html")))
    );
    return;
  }

  // everything else: cached first, it never changes without a new build
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      return res;
    }))
  );
});
