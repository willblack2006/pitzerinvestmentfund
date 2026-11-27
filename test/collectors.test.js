// Collector framework, warehouse and the FINRA short-volume collector (rebuild plan 1.1-1.2).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pif-collectors-"));
process.env.DB_PATH = path.join(dir, "c.db");
process.env.COLLECTORS = "off";
const db = require("../db");
const warehouse = require("../lib/warehouse");
const collectors = require("../lib/collectors");
const finraSv = require("../lib/collectors/finraShortVolume");

test("warehouse: a separate file next to pif.db, attached as wh", () => {
  warehouse.attach();
  assert.equal(warehouse.path, path.join(dir, "warehouse.db"));
  assert.ok(db.prepare("PRAGMA database_list").all().some((r) => r.name === "wh"));
  warehouse.putSeries([{ source: "t", entity: "X", metric: "m", date: "2026-01-02", value: 2 }, { source: "t", entity: "X", metric: "m", date: "2026-01-01", value: 1 }]);
  warehouse.putSeries([{ source: "t", entity: "X", metric: "m", date: "2026-01-02", value: 3 }]); // upsert
  assert.deepStrictEqual(warehouse.getSeries({ source: "t", entity: "X", metric: "m" }), [{ date: "2026-01-01", value: 1 }, { date: "2026-01-02", value: 3 }]);
});

test("collectors: runs are logged as ok, empty or error, and health follows them", async () => {
  let mode = "ok";
  collectors.define({ name: "t-demo", label: "Demo", everyMs: 60_000, staleAfterMs: 3_600_000, collect: async () => {
    if (mode === "error") throw new Error("source down");
    return mode === "ok" ? { rows: 5, asOf: "2026-11-25" } : { rows: 0 };
  } });
  const ok = await collectors.run("t-demo");
  assert.equal(ok.status, "ok"); assert.equal(ok.rows, 5); assert.equal(ok.as_of, "2026-11-25");
  mode = "empty"; assert.equal((await collectors.run("t-demo")).status, "empty");
  mode = "error";
  const bad = await collectors.run("t-demo");
  assert.equal(bad.status, "error"); assert.match(bad.message, /source down/);
  let s = collectors.status().collectors.find((c) => c.name === "t-demo");
  assert.equal(s.health, "flaky"); assert.equal(s.failStreak, 1); assert.equal(s.week.ok.rows, 5);
  await collectors.run("t-demo"); await collectors.run("t-demo");
  s = collectors.status().collectors.find((c) => c.name === "t-demo");
  assert.equal(s.health, "failing");
  // Stale: last good run long ago.
  s = collectors.status({ now: Date.now() + 2 * 3_600_000 }).collectors.find((c) => c.name === "t-demo");
  assert.equal(s.health, "failing"); // failing outranks stale
  await assert.rejects(collectors.run("nope"), /No collector/);
});

test("collectors: a run left 'running' by a restart is closed as an error", () => {
  db.prepare("INSERT INTO wh.collector_runs (collector, started_at) VALUES ('t-demo', ?)").run(new Date().toISOString());
  assert.equal(collectors.closeAbandoned(), 1);
});

test("finra short volume: stores tracked symbols once per trading day and skips missing files", async () => {
  db.prepare("INSERT OR IGNORE INTO positions (symbol, shares) VALUES ('AAPL', 1)").run();
  const calls = [];
  const fetchDay = async (d) => {
    const ds = d.toISOString().slice(0, 10);
    calls.push(ds);
    if (ds === "2026-11-26") throw new Error("not posted"); // Thanksgiving
    return { AAPL: { shortVolume: 40, totalVolume: 100 }, MSFT: { shortVolume: 1, totalVolume: 2 }, ZERO: { shortVolume: 0, totalVolume: 0 } };
  };
  const now = new Date("2026-11-27T12:00:00Z"); // Friday
  const r1 = await finraSv.collect({ now, fetchDay });
  assert.equal(calls.length, 10); // ten weekdays back
  assert.equal(r1.asOf, "2026-11-25");
  assert.equal(r1.rows, 9 * 2); // AAPL only (tracked), 2 metrics, 9 posted days
  assert.match(r1.message, /1 weekday file/);
  calls.length = 0;
  const r2 = await finraSv.collect({ now, fetchDay });
  assert.deepStrictEqual(calls, ["2026-11-26"]); // only the missing day is retried
  assert.equal(r2.rows, 0);
  const h = finraSv.history("AAPL", 5);
  assert.equal(h.length, 5);
  assert.equal(h.at(-1).date, "2026-11-25");
  assert.equal(h.at(-1).ratio, 0.4);
});

test("finra short volume: recentWeekdays skips weekends", () => {
  const days = finraSv.recentWeekdays(new Date("2026-11-30T09:00:00Z"), 3).map((d) => d.toISOString().slice(0, 10)); // Monday
  assert.deepStrictEqual(days, ["2026-11-27", "2026-11-26", "2026-11-25"]);
});

test("sec limiter: never starts more than the limit in one second", async () => {
  const { slot, MAX_PER_SEC } = require("../lib/secFetch");
  const t0 = Date.now();
  const times = await Promise.all(Array.from({ length: MAX_PER_SEC * 2 + 1 }, () => slot().then(() => Date.now() - t0)));
  times.sort((a, b) => a - b);
  for (let i = MAX_PER_SEC; i < times.length; i++) assert.ok(times[i] - times[i - MAX_PER_SEC] >= 990, `request ${i} started too soon`);
});

test("yahoo estimates: extracts consensus fields and stores only changes", async () => {
  const ye = require("../lib/collectors/yahooEstimates");
  const summary = (target, eps) => ({
    financialData: { targetMeanPrice: { raw: target }, numberOfAnalystOpinions: { raw: 30 }, recommendationMean: { raw: 1.9 } },
    earningsTrend: { trend: [
      { period: "0y", earningsEstimate: { avg: { raw: eps }, numberOfAnalysts: { raw: 28 } }, revenueEstimate: { avg: { raw: 4e11 } }, epsRevisions: { upLast30days: { raw: 3 }, downLast30days: { raw: 1 } } },
      { period: "-1q", earningsEstimate: { avg: { raw: 1 } } },
    ] },
  });
  const x = ye.extract(summary(250, 7.1));
  assert.equal(x.target_mean, 250); assert.equal(x.eps_y0, 7.1); assert.equal(x.eps_up30_y0, 3); assert.equal(x.rev_y0, 4e11);
  assert.ok(!Object.keys(x).some((k) => k.includes("-1q")));
  assert.deepStrictEqual(ye.extract({ price: {} }), {}); // ETF: nothing

  let s = summary(250, 7.1);
  const get = async (sym) => { if (sym === "BAD") throw new Error("x"); return sym === "SPY" ? { price: {} } : s; };
  const r1 = await ye.collect({ now: new Date("2026-11-24T23:00:00Z"), getSummary: get, symbols: ["AAPL", "SPY", "BAD"], pauseMs: 0 });
  assert.equal(r1.rows, Object.keys(x).length);
  assert.match(r1.message, /1 of 3 symbols have estimates, 1 failed/);
  const r2 = await ye.collect({ now: new Date("2026-11-25T23:00:00Z"), getSummary: get, symbols: ["AAPL"], pauseMs: 0 });
  assert.equal(r2.rows, 0); // nothing changed
  s = summary(260, 7.1);
  const r3 = await ye.collect({ now: new Date("2026-11-26T23:00:00Z"), getSummary: get, symbols: ["AAPL"], pauseMs: 0 });
  assert.equal(r3.rows, 1);
  assert.deepStrictEqual(ye.valueAsOf("AAPL", "target_mean", "2026-11-25"), { date: "2026-11-24", value: 250 });
  assert.deepStrictEqual(ye.valueAsOf("AAPL", "target_mean", "2026-11-27"), { date: "2026-11-26", value: 260 });
  await assert.rejects(ye.collect({ getSummary: get, symbols: ["BAD"], pauseMs: 0 }), /nothing for all/);
});
