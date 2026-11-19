// Home-screen app and speed plumbing: service worker, manifest, early data requests.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { startServer } = require("./helpers");

let s;
test.before(async () => { s = await startServer(); });
test.after(async () => { await s?.stop(); });

test("service worker precaches every public file and always revalidates", async () => {
  const r = await fetch(s.base + "/sw.js");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /javascript/);
  assert.equal(r.headers.get("cache-control"), "no-cache");
  const src = await r.text();
  assert.match(src, /const VERSION = "[0-9a-f]{12}"/);
  for (const f of ["/app.js", "/boot.js", "/views/holdings.js", "/css/touch.css", "/icons/icon-192.png"]) assert.ok(src.includes(JSON.stringify(f)), f);
  assert.ok(!src.includes("/sw.js\","), "does not precache itself");
});

test("manifest and icons make it installable", async () => {
  const r = await fetch(s.base + "/manifest.webmanifest");
  assert.match(r.headers.get("content-type"), /manifest\+json/);
  const m = await r.json();
  assert.equal(m.display, "standalone");
  for (const icon of m.icons) assert.equal((await fetch(s.base + icon.src)).status, 200, icon.src);
  assert.ok(m.icons.some((i) => i.sizes === "512x512" && i.purpose === "maskable"));
});

test("page head has the mobile and home-screen tags, and boot.js is a classic script (CSP blocks inline)", async () => {
  const html = await (await fetch(s.base + "/")).text();
  for (const re of [/viewport-fit=cover/, /name="theme-color"/, /rel="manifest"/, /rel="apple-touch-icon"/, /<script src="boot\.js">/]) assert.match(html, re);
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(html), "no inline scripts");
});

test("early requests in boot.js only touch read-only endpoints", () => {
  const src = fs.readFileSync(path.join(__dirname, "../public/boot.js"), "utf8");
  for (const m of src.matchAll(/start\("([^"]+)"\)/g)) assert.match(m[1], /^\/api\/(auth\/session|positions|settings|alerts)$/);
});
