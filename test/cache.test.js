const { test } = require("node:test");
const assert = require("node:assert");
process.env.DB_PATH = require("path").join(require("os").tmpdir(), `pif-cache-${process.pid}.db`);
const db = require("../db");
const { cached, setCached, getCached, purgeExpired } = require("../lib/cache");

test("concurrent callers share one fetch", async () => {
  let calls = 0;
  const f = async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return { n: 1 }; };
  const [a, b] = await Promise.all([cached("t:dedupe", 60, "test", f), cached("t:dedupe", 60, "test", f)]);
  assert.deepStrictEqual(a, b);
  assert.strictEqual(calls, 1);
});

test("an expired copy stands in when the fetch fails; with none the error propagates", async () => {
  setCached("t:stale", { v: 1 }, -10, "test");
  assert.strictEqual(getCached("t:stale"), null);
  assert.deepStrictEqual(await cached("t:stale", 60, "test", async () => { throw new Error("429"); }), { v: 1 });
  await assert.rejects(cached("t:none", 60, "test", async () => { throw new Error("429"); }), /429/);
});

test("undefined results are not cached; purge drops rows past the grace window", async () => {
  await cached("t:undef", 60, "test", async () => undefined);
  assert.strictEqual(db.prepare("SELECT 1 FROM api_cache WHERE cache_key='t:undef'").get(), undefined);
  setCached("t:old", { v: 1 }, -5 * 24 * 3600, "test");
  assert.ok(purgeExpired() >= 1);
  assert.strictEqual(db.prepare("SELECT 1 FROM api_cache WHERE cache_key='t:old'").get(), undefined);
});
