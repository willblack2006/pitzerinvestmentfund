// Collector framework (public-data rebuild plan, step 1.1). A collector is a module that pulls
// one public source on a schedule and stores what it got in the warehouse (lib/warehouse.js).
// Each one is defined here with define(), runs as a background job (lib/platform/jobs.js, so
// rounds never overlap), and logs every run to wh.collector_runs. The Data health page
// (#/data-health) reads status() to show when each source last worked.
//
//   define({
//     name: "finra-short-volume", label: "FINRA short volume", source: "FINRA Reg SHO daily files",
//     sourceUrl: "https://...", everyMs: 6 * HOUR, staleAfterMs: 4 * DAY,
//     collect: async ({ trigger }) => ({ rows: 123, asOf: "2026-11-25", message: "optional note" }),
//   })
//
// collect() returning rows: 0 is logged as "empty" (nothing new is normal for many sources);
// throwing is logged as "error" with the message. Set COLLECTORS=off to skip scheduling them
// (they can still be run by hand from the Data health page).
const db = require("../../db");
const warehouse = require("../warehouse");
const jobs = require("../platform/jobs");

const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const defs = new Map();

function define(def) {
  const { name, collect, everyMs } = def;
  if (!name || typeof collect !== "function" || !(everyMs > 0)) throw new Error("collector needs name, collect() and everyMs");
  const full = { label: name, source: "", sourceUrl: null, delayMs: 2 * MIN, staleAfterMs: everyMs * 3, ...def };
  defs.set(name, full);
  if (process.env.COLLECTORS !== "off") {
    jobs.register(`collector:${name}`, { everyMs: full.everyMs, delayMs: full.delayMs, fn: () => run(name, "schedule") });
  }
  return full;
}

// Runs one collector now and logs it. Returns the finished run row. Never throws for a
// collector failure (that's recorded); throws only for an unknown name.
async function run(name, trigger = "manual") {
  const def = defs.get(name);
  if (!def) throw Object.assign(new Error(`No collector named ${name}`), { status: 404 });
  warehouse.attach();
  const startedAt = new Date().toISOString();
  const id = db.prepare("INSERT INTO wh.collector_runs (collector, started_at, trigger) VALUES (?, ?, ?)").run(name, startedAt, trigger).lastInsertRowid;
  let status = "ok", rows = 0, asOf = null, message = null;
  try {
    const r = (await def.collect({ trigger, lastOk: lastOk(name) })) || {};
    rows = Number(r.rows) || 0;
    asOf = r.asOf || null;
    message = r.message ? String(r.message).slice(0, 500) : null;
    if (!rows) status = "empty";
  } catch (err) {
    status = "error";
    message = String(err?.message || err).slice(0, 500);
    console.error(`[collector] ${name} failed:`, message);
  }
  db.prepare("UPDATE wh.collector_runs SET finished_at = ?, status = ?, rows = ?, as_of = ?, message = ? WHERE id = ?")
    .run(new Date().toISOString(), status, rows, asOf, message, id);
  return db.prepare("SELECT * FROM wh.collector_runs WHERE id = ?").get(id);
}

// Most recent successful run (status ok) of a collector, or null.
function lastOk(name) {
  warehouse.attach();
  return db.prepare("SELECT * FROM wh.collector_runs WHERE collector = ? AND status = 'ok' ORDER BY id DESC LIMIT 1").get(name) || null;
}

// A run still marked "running" from before a restart never finished; close it as an error.
function closeAbandoned() {
  warehouse.attach();
  return db.prepare("UPDATE wh.collector_runs SET status = 'error', finished_at = started_at, message = 'Server restarted during this run' WHERE status = 'running'").run().changes;
}

// Everything the Data health page shows.
function status({ now = Date.now(), recent = 40 } = {}) {
  warehouse.attach();
  const last = db.prepare("SELECT * FROM wh.collector_runs WHERE collector = ? ORDER BY id DESC LIMIT 1");
  const lastGood = db.prepare("SELECT * FROM wh.collector_runs WHERE collector = ? AND status IN ('ok','empty') ORDER BY id DESC LIMIT 1");
  const week = db.prepare("SELECT status, COUNT(*) AS n, SUM(rows) AS rows FROM wh.collector_runs WHERE collector = ? AND started_at >= ? GROUP BY status");
  const streak = db.prepare("SELECT status FROM wh.collector_runs WHERE collector = ? AND status != 'running' ORDER BY id DESC LIMIT 20");
  const since = new Date(now - 7 * DAY).toISOString();
  const jobState = new Map(jobs.status().map((j) => [j.name, j]));
  const collectors = [...defs.values()].map((d) => {
    const l = last.get(d.name) || null;
    const g = lastGood.get(d.name) || null;
    const counts = Object.fromEntries(week.all(d.name, since).map((r) => [r.status, { runs: r.n, rows: r.rows || 0 }]));
    let failStreak = 0;
    for (const r of streak.all(d.name)) { if (r.status !== "error") break; failStreak++; }
    const goodAt = g ? Date.parse(g.finished_at || g.started_at) : null;
    const health = !l ? "never" : failStreak >= 3 ? "failing" : goodAt == null || now - goodAt > d.staleAfterMs ? "stale" : failStreak ? "flaky" : "ok";
    return {
      name: d.name, label: d.label, source: d.source, sourceUrl: d.sourceUrl, everyMs: d.everyMs, staleAfterMs: d.staleAfterMs,
      health, failStreak, last: l, lastGood: g, week: counts, running: !!jobState.get(`collector:${d.name}`)?.running,
    };
  });
  const runs = db.prepare("SELECT * FROM wh.collector_runs ORDER BY id DESC LIMIT ?").all(recent);
  const seriesRows = db.prepare("SELECT COUNT(*) AS n FROM wh.alt_series").get().n;
  return { collectors, runs, warehouse: { path: warehouse.path, bytes: warehouse.sizeBytes(), seriesRows }, scheduled: process.env.COLLECTORS !== "off" };
}

function list() { return [...defs.values()]; }

// Loading the collector modules defines them. Add new collectors to this list.
function loadAll() {
  require("./finraShortVolume");
}

module.exports = { define, run, lastOk, status, list, loadAll, closeAbandoned, MIN, HOUR, DAY, _defs: defs };
