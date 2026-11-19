// The app's service worker, generated per deploy. Every file under public/ is precached into a
// cache named for a hash of those files, so a repeat visit (or opening from the home screen)
// paints from disk with no network round trip, and a deploy swaps the whole set at once.
// Data (/api) is never cached here: it always goes to the network.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return listFiles(full, base);
    return [path.relative(base, full).split(path.sep).join("/")];
  });
}

function build(publicDir) {
  const files = listFiles(publicDir).filter((f) => !f.endsWith(".map") && !f.startsWith(".")).sort();
  const hash = crypto.createHash("sha1");
  for (const f of files) hash.update(f).update(fs.readFileSync(path.join(publicDir, f)));
  const version = hash.digest("hex").slice(0, 12);
  const urls = ["/", ...files.filter((f) => f !== "index.html").map((f) => "/" + f)];
  const source = `// version ${version}
const VERSION = ${JSON.stringify(version)};
const STATIC = "pif-static-" + VERSION;
const RUNTIME = "pif-runtime-v1";
const PRECACHE = ${JSON.stringify(urls)};

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC);
    await cache.addAll(PRECACHE.map((u) => new Request(u, { cache: "reload" })));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("pif-static-") && k !== STATIC) await caches.delete(k);
    await self.clients.claim();
  })());
});

// Web fonts and the chart libraries come from other hosts: serve the saved copy right away and
// refresh it in the background.
async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME);
  const hit = await cache.match(request);
  const fresh = fetch(request).then((res) => { if (res.ok || res.type === "opaque") cache.put(request, res.clone()); return res; });
  if (hit) { fresh.catch(() => {}); return hit; }
  return fresh;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) {
    if (/^(fonts\\.googleapis\\.com|fonts\\.gstatic\\.com|cdn\\.jsdelivr\\.net)$/.test(url.hostname)) event.respondWith(staleWhileRevalidate(req));
    return;
  }
  if (url.pathname.startsWith("/api/") || url.pathname === "/sw.js" || url.pathname === "/healthz") return;
  event.respondWith((async () => {
    const cache = await caches.open(STATIC);
    const hit = await cache.match(req.mode === "navigate" ? "/" : url.pathname);
    if (hit) return hit;
    try { return await fetch(req); } catch (err) {
      if (req.mode === "navigate") { const shell = await cache.match("/"); if (shell) return shell; }
      throw err;
    }
  })());
});
`;
  return { version, source };
}

module.exports = { build };
