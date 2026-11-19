// The agent system's entry point: event intake, routing and dispatch (research report 8.2).
//   [1] intake: new SEC filings on holdings (and app events such as a pitch opening for a vote)
//       become agent_events rows, one per filing, deduped.
//   [2] router: lib/agents/router.js picks a tier and a workflow with plain rules.
//   [3] dispatch: registered workflows run on routed events, one at a time, as recorded runs.
const db = require("../../db");
const sec = require("../sources/sec");
const router = require("./router");
const runs = require("./runs");
const budget = require("./budget");

const FILING_FORMS = new Set(["8-K", "8-K/A", "10-Q", "10-K", "10-Q/A", "10-K/A"]);
const LOOKBACK_DAYS = 3;       // a filing older than this when first seen is recorded but not run
const RUNS_PER_PASS = 3;       // keeps one pass short; the next pass picks up the rest
const STALE_EVENT_DAYS = 3;    // routed events older than this are skipped, not run late
const MAX_ATTEMPTS = 3;        // a failed event is retried on later passes up to this many runs in all
const RETRY_AFTER_MIN = 20;    // ...and not sooner than this after its last failure (SEC 429s, OpenAI 5xx)

const workflows = {};
let scheduler = null; // records periodic events (lib/agents/workflows/scheduled.js)
function setScheduler(fn) { scheduler = fn; }
function register(name, fn) { workflows[name] = fn; }
const registered = () => Object.keys(workflows);

const daysAgo = (n, now = new Date()) => new Date(now.getTime() - n * 864e5).toISOString().slice(0, 10);

// Records one event. Returns the new row id, or null when the dedupe key was already seen.
function recordEvent({ dedupeKey, symbol = null, type, items = "", title = "", sourceUrl = "", asOf = null, payload = {} }) {
  const info = db.prepare(`INSERT OR IGNORE INTO agent_events (dedupeKey, symbol, type, items, title, sourceUrl, asOf, payload)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(dedupeKey, symbol, type, items, String(title).slice(0, 300), sourceUrl, asOf, JSON.stringify(payload));
  return info.changes ? Number(info.lastInsertRowid) : null;
}

// [1] New filings for every holding. SEC submissions are cached 6h per ticker in lib/sources/sec.js.
async function pollHoldingFilings({ now = new Date() } = {}) {
  const symbols = db.prepare("SELECT DISTINCT symbol FROM positions").all().map((r) => r.symbol);
  const since = daysAgo(LOOKBACK_DAYS, now);
  let added = 0;
  for (const symbol of symbols) {
    let filings;
    try { filings = await sec.getAllRecentFilings(symbol); } catch (err) { console.error(`[agents] filings for ${symbol} failed:`, err.message); continue; }
    for (const f of filings) {
      if (!FILING_FORMS.has(f.form) || f.filingDate < since) continue;
      const id = recordEvent({
        dedupeKey: `filing:${f.accession}`, symbol, type: f.form, items: f.items || "",
        title: `${symbol} ${f.form}${f.items ? ` (items ${f.items})` : ""} filed ${f.filingDate}`,
        sourceUrl: f.url, asOf: f.filingDate, payload: f,
      });
      if (id) added++;
    }
  }
  return { symbols: symbols.length, added };
}

// [2] Route every new event.
function routeNew() {
  const rows = db.prepare("SELECT * FROM agent_events WHERE status = 'new' ORDER BY id").all();
  const upd = db.prepare("UPDATE agent_events SET tier = ?, workflow = ?, status = ? WHERE id = ?");
  for (const e of rows) {
    const r = router.classify(e);
    upd.run(r.tier, r.workflow, r.workflow ? "routed" : "done", e.id);
  }
  return rows.length;
}

// [3] Run registered workflows on routed events. Events whose workflow isn't built yet stay
// 'routed' (shown on the Agents page) until they go stale. A failed event (SEC rate limit, an
// OpenAI outage) is tried again on a later pass, up to MAX_ATTEMPTS runs, before it's given up.
async function dispatch({ now = new Date() } = {}) {
  const stale = daysAgo(STALE_EVENT_DAYS, now);
  db.prepare("UPDATE agent_events SET status = 'skipped' WHERE status IN ('routed', 'failed') AND COALESCE(asOf, substr(createdAt, 1, 10)) < ?").run(stale);
  const names = registered();
  if (!names.length) return { ran: 0, failed: 0 };
  const retryBefore = new Date(now.getTime() - RETRY_AFTER_MIN * 60000).toISOString().replace("T", " ").slice(0, 19);
  const rows = db.prepare(`SELECT e.* FROM agent_events e WHERE e.workflow IN (${names.map(() => "?").join(",")}) AND (e.status = 'routed' OR (e.status = 'failed'
      AND (SELECT COUNT(*) FROM agent_runs r WHERE r.eventId = e.id) < ?
      AND (SELECT MAX(COALESCE(r.finishedAt, r.createdAt)) FROM agent_runs r WHERE r.eventId = e.id) < ?))
    ORDER BY e.status = 'failed', CASE e.tier WHEN 'push' THEN 0 WHEN 'inbox' THEN 1 ELSE 2 END, e.id LIMIT ?`).all(...names, MAX_ATTEMPTS, retryBefore, RUNS_PER_PASS);
  let ran = 0, failed = 0;
  for (const e of rows) {
    const event = { ...e, payload: JSON.parse(e.payload || "{}") };
    try {
      await runs.run({ workflow: e.workflow, eventId: e.id, symbol: e.symbol }, (ctx) => workflows[e.workflow](event, ctx));
      db.prepare("UPDATE agent_events SET status = 'done' WHERE id = ?").run(e.id);
      ran++;
    } catch (err) {
      failed++;
      if (err instanceof budget.BudgetError) { console.warn(`[agents] ${err.message}`); break; } // leave routed; retry when budget allows
      db.prepare("UPDATE agent_events SET status = 'failed' WHERE id = ?").run(e.id);
      console.error(`[agents] ${e.workflow} on event ${e.id} failed:`, err.message);
    }
  }
  return { ran, failed };
}

let passRunning = false;
async function pass() {
  if (passRunning) return null;
  passRunning = true;
  try {
    const intake = await pollHoldingFilings();
    if (scheduler) { try { intake.added += await scheduler(module.exports); } catch (err) { console.error("[agents] schedule failed:", err.message); } }
    const routed = routeNew();
    const d = require("../sources/openai").configured() ? await dispatch() : { ran: 0, failed: 0 };
    return { ...intake, routed, ...d };
  } finally { passRunning = false; }
}

// Route and run app events right away (e.g. a pitch opening for a vote) without waiting for the
// next scheduled pass. Fire-and-forget; errors are logged.
let kickRunning = false;
function kick() {
  if (kickRunning || !require("../sources/openai").configured()) return;
  kickRunning = true;
  setImmediate(async () => {
    try { routeNew(); await dispatch(); } catch (err) { console.error("[agents] kick failed:", err.message); } finally { kickRunning = false; }
  });
}

module.exports = { setScheduler, kick, register, registered, recordEvent, pollHoldingFilings, routeNew, dispatch, pass, workflows };
