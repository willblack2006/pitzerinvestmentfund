// Agent triggers (plan WS2): what wakes a member-made agent up.
//
//   schedule  a job every minute runs agents whose nextRunAt has passed (lib/platform/cron.js),
//             then sets the next one. Slots missed while the server was down run once, not N times.
//   event     bus.on(<type>) for every event type in lib/agents/spec.js EVENTS: matching agents x
//             symbols in scope, deduped per agent + event key (agent_trigger_log).
//   handoff   another agent posted to a topic (or straight to this agent) via bus.handoff.
//   manual    POST /api/platform/agents/:id/run (routes/agentEngine.js), straight to the engine.
//
// Runs go through one in-process queue, one at a time, so a burst of events (earnings day, a
// 13F season) can't start 40 model calls at once. An agent never triggers itself, and a handoff
// chain stops at depth 3 (lib/agents/engine.js).
const db = require("../../db");
const engine = require("./engine");
const specLib = require("./spec");

const opt = (p) => { try { return require(p); } catch { return null; } };
const MAX_QUEUE = 200;
const SCHEDULE_EVERY_MS = 60 * 1000;
const MARKET_EVERY_MS = 15 * 60 * 1000;

// ---- Queue ----

const queue = [];
let draining = null;
const stats = { queued: 0, ran: 0, skipped: 0, failed: 0, dropped: 0, lastError: null };

function enqueue(job) {
  if (queue.length >= MAX_QUEUE) { stats.dropped++; logOutcome(job, "dropped", "queue full"); return false; }
  queue.push(job); stats.queued++;
  if (!draining) draining = drain().finally(() => { draining = null; });
  return true;
}
async function drain() {
  while (queue.length) {
    const job = queue.shift();
    try {
      const r = await engine.runAgent(job.agentId, { symbol: job.symbol, trigger: job.trigger, event: job.event, parentRunId: job.parentRunId || null, depth: job.depth || 0 });
      if (r.skipped) { stats.skipped++; logOutcome(job, "skipped", r.reason); } else { stats.ran++; logOutcome(job, "ran", "", r.runId); }
    } catch (err) {
      stats.failed++; stats.lastError = err.message;
      logOutcome(job, err.code?.startsWith?.("agent_") || err.status === 429 ? "refused" : "failed", err.message, err.runId);
      if (!err.expose) console.error(`[triggers] agent ${job.agentId} on ${job.symbol || "fund"} failed:`, err.message);
    }
  }
}
// Resolves when the queue is empty (tests, and the dry-run "live test" button).
const idle = async () => { while (draining) await draining; };

// Claims a dedupe key for an agent. False when that key already fired (the event was seen).
function claim(agentId, dedupeKey, trigger, symbol) {
  return db.prepare("INSERT OR IGNORE INTO agent_trigger_log (agentId, dedupeKey, trigger, symbol) VALUES (?, ?, ?, ?)").run(agentId, String(dedupeKey).slice(0, 300), trigger, symbol).changes === 1;
}
function logOutcome(job, outcome, detail = "", runId = null) {
  if (!job.dedupeKey) return;
  try { db.prepare("UPDATE agent_trigger_log SET outcome = ?, detail = ?, runId = ? WHERE agentId = ? AND dedupeKey = ?").run(outcome, String(detail || "").slice(0, 300), runId, job.agentId, job.dedupeKey); } catch { /* table missing in old DBs */ }
}

// Active member-made agents with their parsed spec (bad specs are skipped, not crashed on).
function activeAgents() {
  return db.prepare("SELECT * FROM agents WHERE kind = 'custom' AND status = 'active'").all().map((row) => {
    const a = engine.parseAgent(row);
    const r = specLib.normalize(a.spec);
    return r.errors.length ? null : { ...a, spec: r.spec };
  }).filter(Boolean);
}

// ---- Schedules ----

function nextRunFor(spec, from = new Date()) {
  const cron = require("../platform/cron");
  let best = null;
  for (const t of spec.triggers) {
    if (t.type !== "schedule") continue;
    try {
      const n = cron.nextRun(t.preset || t.cron, t.tz, from);
      if (n && (!best || n < best)) best = n;
    } catch { /* invalid cron: validation should have caught it */ }
  }
  return best;
}
const iso = (d) => (d ? d.toISOString().replace("T", " ").slice(0, 19) : null);

// Sets nextRunAt for one agent from its spec (after a save, resume or run).
function reschedule(agentId, from = new Date()) {
  const a = engine.getAgent(agentId);
  if (!a) return null;
  const r = specLib.normalize(a.spec);
  const next = a.status === "active" && !r.errors.length ? nextRunFor(r.spec, from) : null;
  db.prepare("UPDATE agents SET nextRunAt = ? WHERE id = ?").run(iso(next), agentId);
  return next;
}

// One pass of the schedule loop: every agent whose slot has come up gets queued once per symbol
// in scope, and its nextRunAt moves past now (claimed first, so overlapping passes can't
// double-run a slot).
function scheduleTick(now = new Date()) {
  let queued = 0;
  for (const a of activeAgents()) {
    if (!a.spec.triggers.some((t) => t.type === "schedule")) continue;
    if (!a.nextRunAt) { reschedule(a.id, now); continue; }
    if (a.nextRunAt > iso(now)) continue;
    const slot = a.nextRunAt;
    const next = nextRunFor(a.spec, now);
    const moved = db.prepare("UPDATE agents SET nextRunAt = ? WHERE id = ? AND nextRunAt = ?").run(iso(next), a.id, slot).changes;
    if (!moved) continue;
    for (const symbol of engine.symbolsFor(a.spec)) {
      const key = `schedule:${slot}:${symbol || "fund"}`;
      if (!claim(a.id, key, "schedule", symbol)) continue;
      if (enqueue({ agentId: a.id, symbol, trigger: "schedule", event: { type: "schedule", slot }, dedupeKey: key })) queued++;
    }
  }
  return { queued };
}

// ---- Events ----

// Does an event trigger match an event payload? Pure (tests call it directly).
function matches(t, type, p) {
  if (t.type !== "event" || t.on !== type) return false;
  switch (type) {
    case "filing":
      if (t.forms?.length && !t.forms.includes(p.form)) return false;
      if (t.items?.length && !String(p.items || "").split(/[,\s]+/).some((i) => t.items.includes(i))) return false;
      return true;
    case "price_move":
      if (t.sigma != null && !(Math.abs(Number(p.sigma)) >= t.sigma)) return false;
      if (t.pct != null && !(Math.abs(Number(p.changePct)) >= t.pct)) return false;
      return true;
    case "earnings_soon": return Number(p.days) <= (t.days ?? 7);
    case "insider_buy": return t.minScore == null || Number(p.score) >= t.minScore;
    case "estimate_revision": return t.minScore == null || Math.abs(Number(p.score)) >= t.minScore;
    case "ips_breach": return !t.level || t.level === p.level;
    case "pitch_status": return !t.status?.length || t.status.includes(p.status);
    case "agent_output": return !t.agent || t.agent === p.slug;
    default: return true;
  }
}

// A stable key for "this event": the same filing or the same day's move never fires twice.
function eventKey(type, p) {
  const day = (p.at || new Date().toISOString()).slice(0, 10);
  switch (type) {
    case "filing": return `filing:${p.accession || p.url || `${p.symbol}:${p.form}:${p.filingDate}`}`;
    case "price_move": return `price_move:${p.symbol}:${p.date || day}`;
    case "earnings_soon": return `earnings_soon:${p.symbol}:${p.date}`;
    case "tripwire": return `tripwire:${p.tripwireId || `${p.symbol}:${day}`}`;
    case "pitch_status": return `pitch_status:${p.pitchId}:${p.status}`;
    case "ips_breach": return `ips_breach:${p.symbol || "fund"}:${p.rule}:${day}`;
    case "agent_output": return `agent_output:${p.runId}`;
    case "thesis_change": return `thesis_change:${p.symbol}:${p.pillarId || "all"}:${p.status}:${day}`;
    default: return `${type}:${p.symbol || "fund"}:${p.key || day}`;
  }
}

function onEvent(type, payload = {}) {
  const symbol = payload.symbol ? String(payload.symbol).toUpperCase() : null;
  const key = eventKey(type, payload);
  let queued = 0;
  for (const a of activeAgents()) {
    if (!a.spec.triggers.some((t) => matches(t, type, payload))) continue;
    if (type === "agent_output") {
      if (payload.agentId === a.id) continue; // never trigger itself
      if ((payload.output?.depth ?? 0) + 1 > engine.MAX_HANDOFF_DEPTH) continue;
    }
    // Fund-wide agents run once per event; others only for symbols in their scope.
    const target = a.spec.scope.universe === "fund" ? null : symbol;
    if (a.spec.scope.universe !== "fund" && (!symbol || !engine.inScope(a.spec, symbol))) continue;
    const dedupeKey = `${key}${target ? `:${target}` : ""}`;
    if (!claim(a.id, dedupeKey, "event", target)) continue;
    const depth = type === "agent_output" ? (payload.output?.depth ?? 0) + 1 : 0;
    if (enqueue({ agentId: a.id, symbol: target, trigger: "event", event: { type, ...slim(payload) }, dedupeKey, parentRunId: type === "agent_output" ? payload.runId : null, depth })) queued++;
  }
  return { queued };
}

// Event payloads go into prompts and run records: keep them small.
function slim(p) {
  const out = {};
  for (const [k, v] of Object.entries(p || {})) {
    if (k === "output") { out.output = { summary: v?.summary, verdict: v?.verdict, score: v?.score, headline: v?.headline }; continue; }
    if (v == null || typeof v === "function") continue;
    if (typeof v === "string") out[k] = v.slice(0, 500);
    else if (typeof v !== "object") out[k] = v;
    else if (JSON.stringify(v).length <= 2000) out[k] = v;
  }
  return out;
}

function onHandoff(msg = {}) {
  const depth = msg.payload?.depth ?? 1;
  if (depth > engine.MAX_HANDOFF_DEPTH) return { queued: 0 };
  const symbol = msg.symbol ? String(msg.symbol).toUpperCase() : null;
  let queued = 0;
  for (const a of activeAgents()) {
    if (a.id === msg.fromAgentId) continue;
    const direct = msg.toAgentId && msg.toAgentId === a.id;
    const byTopic = !msg.toAgentId && a.spec.triggers.some((t) => t.type === "handoff" && t.topic === msg.topic);
    if (!direct && !byTopic) continue;
    if (a.spec.scope.universe !== "fund" && (!symbol || !engine.inScope(a.spec, symbol))) continue;
    const target = a.spec.scope.universe === "fund" ? null : symbol;
    const dedupeKey = `handoff:${msg.id}`;
    if (!claim(a.id, dedupeKey, "handoff", target)) continue;
    if (enqueue({ agentId: a.id, symbol: target, trigger: "handoff", event: { type: "handoff", topic: msg.topic, kind: msg.kind, fromAgentId: msg.fromAgentId, ...slim(msg.payload) }, dedupeKey, parentRunId: msg.fromRunId || null, depth })) queued++;
  }
  return { queued };
}

// ---- Market events the app didn't emit before: price moves, earnings soon, policy limits ----

// Symbols any active agent listens to market events for (nothing to compute when nobody does).
function listenedSymbols(types) {
  const out = new Set();
  for (const a of activeAgents()) {
    if (!a.spec.triggers.some((t) => t.type === "event" && types.includes(t.on))) continue;
    for (const s of engine.symbolsFor(a.spec)) if (s) out.add(s);
  }
  return [...out];
}

async function marketScan({ now = new Date(), loaders } = {}) {
  const bus = opt("../platform/bus");
  if (!bus) return { emitted: 0 };
  const registry = require("../metrics/registry");
  const L = loaders || registry.createLoaders();
  let emitted = 0;
  const moveSyms = listenedSymbols(["price_move"]);
  for (const symbol of moveSyms) {
    const [sigma, chg] = await Promise.all([registry.value("price.moveSigma", symbol, { loaders: L }), registry.value("quote.changePct", symbol, { loaders: L })]);
    if (sigma.value == null && chg.value == null) continue;
    if (Math.abs(sigma.value ?? 0) >= 1 || Math.abs(chg.value ?? 0) >= 3) {
      bus.emit("price_move", { symbol, sigma: sigma.value, changePct: chg.value, date: now.toISOString().slice(0, 10) });
      emitted++;
    }
  }
  for (const symbol of listenedSymbols(["earnings_soon"])) {
    const d = await registry.value("street.nextEarningsDays", symbol, { loaders: L });
    if (d.value == null || d.value < 0 || d.value > 30) continue;
    const date = new Date(now.getTime() + d.value * 864e5).toISOString().slice(0, 10);
    bus.emit("earnings_soon", { symbol, days: d.value, date });
    emitted++;
  }
  if (listenedSymbols(["ips_breach"]).length || activeAgents().some((a) => a.spec.scope.universe === "fund" && a.spec.triggers.some((t) => t.on === "ips_breach"))) {
    try {
      const alloc = await L.allocation();
      for (const c of alloc.checks || []) { bus.emit("ips_breach", { symbol: c.symbol || null, level: c.level, rule: c.rule, detail: c.detail }); emitted++; }
    } catch { /* allocation needs prices; try next pass */ }
  }
  return { emitted };
}

// ---- Wiring ----

let installed = false;
function install() {
  if (installed) return;
  installed = true;
  const bus = opt("../platform/bus");
  const jobs = opt("../platform/jobs");
  if (bus) {
    for (const type of Object.keys(specLib.EVENTS)) bus.on(type, (p) => { onEvent(type, p); });
    bus.on("handoff", (m) => { onHandoff(m); });
  }
  if (jobs && process.env.DISABLE_AGENT_TRIGGERS !== "true") {
    jobs.register("agent-schedules", { everyMs: SCHEDULE_EVERY_MS, delayMs: 30 * 1000, fn: async () => { scheduleTick(); await idle(); } });
    jobs.register("agent-market-events", { everyMs: MARKET_EVERY_MS, delayMs: 90 * 1000, fn: () => marketScan() });
  }
}

module.exports = { install, enqueue, idle, stats, scheduleTick, reschedule, nextRunFor, onEvent, onHandoff, matches, eventKey, marketScan, activeAgents, claim, _queue: queue };
