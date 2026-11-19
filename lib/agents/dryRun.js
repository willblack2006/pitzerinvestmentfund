// Dry run (plan WS2): "this agent would have fired N times in the last 30/90 days, on these
// dates". Replays the spec's triggers and conditions over data the app already has (daily
// closes, stored filings and tripwires, pitch history) without calling a model or writing
// anything. Metrics with a history (lib/metrics/registry.js `history`) are evaluated as of each
// date; metrics without one are reported as not checkable, and the fire is counted with a note.
const db = require("../../db");
const registry = require("../metrics/registry");
const { compare } = require("./conditions");
const engine = require("./engine");

const MAX_SYMBOLS = 25;
const MAX_FIRES = 500;

function dayList(fromDate, toDate) {
  const out = [];
  for (let t = Date.parse(`${fromDate}T00:00:00Z`); t <= Date.parse(`${toDate}T00:00:00Z`); t += 864e5) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

// Value of a history series as of a date (last point on or before it) and the point before.
function asOf(series, date) {
  let cur = null, prev = null;
  for (const p of series) { if (p.date > date) break; prev = cur; cur = p; }
  return { value: cur?.value ?? null, prev: prev?.value ?? null };
}

async function candidates(spec, symbol, { since, until, L }) {
  const out = []; // { date, trigger, reason }
  const skipped = [];
  for (const t of spec.triggers) {
    if (t.type === "manual") continue;
    if (t.type === "handoff") { skipped.push({ trigger: `handoff:${t.topic}`, reason: "Depends on other agents; not replayed." }); continue; }
    if (t.type === "schedule") {
      const cron = require("../platform/cron");
      let at = new Date(`${since}T00:00:00Z`);
      const end = new Date(`${until}T23:59:59Z`);
      for (let i = 0; i < 400; i++) {
        const n = cron.nextRun(t.preset || t.cron, t.tz, at);
        if (!n || n > end) break;
        out.push({ date: n.toISOString().slice(0, 10), at: n.toISOString(), trigger: "schedule", reason: `scheduled (${t.preset || t.cron})` });
        at = n;
      }
      continue;
    }
    // Events
    if (t.on === "price_move") {
      if (!symbol) { skipped.push({ trigger: "price_move", reason: "Needs a ticker scope." }); continue; }
      const [sig, chg] = await Promise.all([registry.history("price.moveSigma", symbol, 400, { loaders: L }), registry.history("price.change1dPct", symbol, 400, { loaders: L })]);
      const chgBy = new Map((chg || []).map((p) => [p.date, p.value]));
      for (const p of sig || []) {
        if (p.date < since || p.date > until) continue;
        const c = chgBy.get(p.date);
        const okSigma = t.sigma == null || (p.value != null && Math.abs(p.value) >= t.sigma);
        const okPct = t.pct == null || (c != null && Math.abs(c) >= t.pct);
        if (okSigma && okPct) out.push({ date: p.date, trigger: "price_move", reason: `moved ${c != null ? `${c > 0 ? "+" : ""}${c.toFixed(1)}%` : "?"} (${p.value != null ? `${p.value.toFixed(1)}σ` : "?"})` });
      }
    } else if (t.on === "filing") {
      if (!symbol) { skipped.push({ trigger: "filing", reason: "Needs a ticker scope." }); continue; }
      const rows = db.prepare("SELECT type, items, asOf FROM agent_events WHERE symbol = ? AND dedupeKey LIKE 'filing:%' AND asOf >= ? AND asOf <= ?").all(symbol, since, until);
      for (const r of rows) {
        if (t.forms?.length && !t.forms.includes(r.type)) continue;
        if (t.items?.length && !String(r.items || "").split(/[,\s]+/).some((i) => t.items.includes(i))) continue;
        out.push({ date: r.asOf, trigger: "filing", reason: `${r.type} filed${r.items ? ` (items ${r.items})` : ""}` });
      }
      if (!rows.length) skipped.push({ trigger: "filing", reason: `No stored filings for ${symbol} in the window (filings are recorded for holdings only).` });
    } else if (t.on === "tripwire") {
      const rows = db.prepare(`SELECT symbol, kind, value, trippedAt FROM tripwires WHERE trippedAt IS NOT NULL AND substr(trippedAt, 1, 10) BETWEEN ? AND ?${symbol ? " AND symbol = ?" : ""}`).all(...(symbol ? [since, until, symbol] : [since, until]));
      for (const r of rows) out.push({ date: r.trippedAt.slice(0, 10), trigger: "tripwire", reason: `${r.symbol} ${r.kind.replace("_", " ")} tripwire tripped` });
    } else if (t.on === "pitch_status") {
      const rows = db.prepare(`SELECT id, symbol, status, votingOpenedAt, decidedAt FROM pitches WHERE ${symbol ? "symbol = ?" : "1 = 1"}`).all(...(symbol ? [symbol] : []));
      for (const r of rows) {
        const evs = [["voting", r.votingOpenedAt], [r.status, r.decidedAt]].filter(([s, d]) => d && (!t.status?.length || t.status.includes(s)));
        for (const [s, d] of evs) if (d.slice(0, 10) >= since && d.slice(0, 10) <= until) out.push({ date: d.slice(0, 10), trigger: "pitch_status", reason: `pitch #${r.id} ${s}` });
      }
    } else if (t.on === "earnings_soon") {
      skipped.push({ trigger: "earnings_soon", reason: "Past earnings dates aren't stored; this one is checked live only." });
    } else {
      skipped.push({ trigger: t.on, reason: "Not stored with history; checked live only." });
    }
  }
  return { out, skipped };
}

// Returns { fires: [{date, symbol, reason}], evaluated, days, skipped, notes, symbols }.
async function dryRun(spec, { days = 30, now = new Date(), loaders } = {}) {
  days = [30, 90].includes(Number(days)) ? Number(days) : Math.max(1, Math.min(180, Number(days) || 30));
  const until = now.toISOString().slice(0, 10);
  const since = new Date(now.getTime() - days * 864e5).toISOString().slice(0, 10);
  const L = loaders || registry.createLoaders();
  let symbols = engine.symbolsFor(spec);
  const notes = [];
  if (symbols.length > MAX_SYMBOLS) { notes.push(`Checked the first ${MAX_SYMBOLS} of ${symbols.length} tickers.`); symbols = symbols.slice(0, MAX_SYMBOLS); }
  const condHist = {};
  const uncheckable = new Set();
  for (const c of spec.conditions || []) {
    if (c.metric.startsWith("$")) { uncheckable.add(c.metric); continue; }
    if (!registry.get(c.metric)?.history) uncheckable.add(c.metric);
  }
  if (uncheckable.size) notes.push(`Not checkable on past dates, counted as passing: ${[...uncheckable].join(", ")}.`);
  if ((spec.steps || []).some((s) => s.type === "rule")) notes.push("Rule steps read live tool data, so they aren't replayed; a real run may stop at a rule.");

  const fires = [];
  let evaluated = 0;
  const skippedAll = new Map();
  for (const symbol of symbols) {
    const { out, skipped } = await candidates(spec, symbol, { since, until, L });
    for (const s of skipped) skippedAll.set(`${s.trigger}:${s.reason}`, s);
    // One fire per symbol per day (the engine dedupes the same way).
    const byDay = new Map();
    for (const c of out.sort((a, b) => a.date.localeCompare(b.date))) if (!byDay.has(c.date)) byDay.set(c.date, c);
    for (const c of byDay.values()) {
      evaluated++;
      let pass = true; const why = [];
      for (const cond of spec.conditions || []) {
        if (uncheckable.has(cond.metric)) continue;
        const key = `${cond.metric}:${symbol}`;
        if (!(key in condHist)) condHist[key] = await registry.history(cond.metric, symbol, days + 400, { loaders: L }) || [];
        const { value, prev } = asOf(condHist[key], c.date);
        let target = cond.value;
        if (typeof target === "string" && registry.has(target)) {
          const tk = `${target}:${symbol}`;
          if (!(tk in condHist)) condHist[tk] = await registry.history(target, symbol, days + 400, { loaders: L }) || [];
          target = asOf(condHist[tk], c.date).value;
        }
        if (!compare(cond.op, value, target, prev)) { pass = false; break; }
        why.push(`${cond.metric} ${value != null ? Math.round(value * 100) / 100 : "n/a"}`);
      }
      if (pass) fires.push({ date: c.date, symbol, reason: `${c.reason}${why.length ? `; ${why.join(", ")}` : ""}` });
      if (fires.length >= MAX_FIRES) break;
    }
  }
  fires.sort((a, b) => b.date.localeCompare(a.date) || String(a.symbol).localeCompare(String(b.symbol)));
  const est = require("./spec").estimateCost(spec, { symbols: symbols.length });
  const aiCost = est.typicalRunUsd * fires.length;
  return { fires, evaluated, days, since, until, symbols: symbols.length, skipped: [...skippedAll.values()], notes, wouldCostUsd: Math.round(aiCost * 10000) / 10000 };
}

module.exports = { dryRun, asOf, dayList };
