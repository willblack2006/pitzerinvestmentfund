// Nightly analyst estimate and price-target snapshots (rebuild plan step 1.2). Yahoo only shows
// today's consensus; keeping a copy each day is what later gives us revision history and beat/miss
// against what was expected at the time (plan 3.5). Stored changed-only: a value is written when it
// differs from the last stored one, so a flat estimate costs one row, not one per day.
// Source "yahoo_est"; entity = ticker; metrics listed in METRICS below.
const yahoo = require("../sources/yahoo");
const warehouse = require("../warehouse");
const db = require("../../db");
const { define, HOUR, DAY } = require("./index");
const { trackedSymbols } = require("./universe");

const SOURCE = "yahoo_est";
const raw = (v) => {
  const n = v && typeof v === "object" ? v.raw : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const PERIODS = { "0q": "q0", "+1q": "q1", "0y": "y0", "+1y": "y1" };

// Flat { metric: value } from one quoteSummary result. Pure.
function extract(q) {
  const out = {};
  const fd = q?.financialData || {};
  out.target_mean = raw(fd.targetMeanPrice);
  out.target_high = raw(fd.targetHighPrice);
  out.target_low = raw(fd.targetLowPrice);
  out.analysts = raw(fd.numberOfAnalystOpinions);
  out.rating_mean = raw(fd.recommendationMean);
  for (const t of q?.earningsTrend?.trend || []) {
    const p = PERIODS[t.period];
    if (!p) continue;
    out[`eps_${p}`] = raw(t.earningsEstimate?.avg);
    out[`eps_n_${p}`] = raw(t.earningsEstimate?.numberOfAnalysts);
    out[`rev_${p}`] = raw(t.revenueEstimate?.avg);
    if (p === "y0" || p === "y1") {
      out[`eps_up30_${p}`] = raw(t.epsRevisions?.upLast30days);
      out[`eps_down30_${p}`] = raw(t.epsRevisions?.downLast30days);
    }
  }
  for (const k of Object.keys(out)) if (out[k] == null) delete out[k];
  return out;
}

// Rows to write for one symbol: only metrics whose value changed since the last stored value.
function changedRows(symbol, values, date, latest) {
  const rows = [];
  for (const [metric, value] of Object.entries(values)) {
    const prev = latest.get(metric);
    if (prev != null && Math.abs(prev - value) <= Math.abs(prev) * 1e-9) continue;
    rows.push({ source: SOURCE, entity: symbol, metric, date, value });
  }
  return rows;
}

async function collect({ now = new Date(), getSummary = yahoo.getQuoteSummary, symbols = null, pauseMs = 250 } = {}) {
  warehouse.attach();
  const date = now.toISOString().slice(0, 10);
  const list = [...(symbols || trackedSymbols())].filter((s) => /^[A-Z0-9.\-^]{1,12}$/.test(s));
  const latestStmt = db.prepare(`SELECT metric, value FROM wh.alt_series a WHERE source = ? AND entity = ?
    AND date = (SELECT MAX(date) FROM wh.alt_series b WHERE b.source = a.source AND b.entity = a.entity AND b.metric = a.metric)`);
  let rows = 0, failed = 0, seen = 0;
  for (const symbol of list) {
    let q;
    try { q = await getSummary(symbol); } catch { failed++; continue; }
    const values = extract(q);
    if (!Object.keys(values).length) continue; // ETFs and funds have no estimates
    seen++;
    const latest = new Map(latestStmt.all(SOURCE, symbol).map((r) => [r.metric, r.value]));
    const batch = changedRows(symbol, values, date, latest);
    if (batch.length) rows += warehouse.putSeries(batch);
    if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
  }
  if (failed && failed === list.length) throw new Error(`Yahoo returned nothing for all ${failed} symbols`);
  return { rows, asOf: date, message: `${seen} of ${list.length} symbols have estimates${failed ? `, ${failed} failed` : ""}` };
}

// A symbol's stored value of one metric as of a date (the last change on or before it).
function valueAsOf(symbol, metric, date) {
  warehouse.attach();
  return db.prepare("SELECT date, value FROM wh.alt_series WHERE source = ? AND entity = ? AND metric = ? AND date <= ? ORDER BY date DESC LIMIT 1")
    .get(SOURCE, String(symbol).toUpperCase(), metric, date) || null;
}

define({
  name: "yahoo-estimates",
  label: "Analyst estimates and targets",
  source: "Yahoo Finance consensus",
  everyMs: 6 * HOUR,
  delayMs: 5 * 60 * 1000,
  staleAfterMs: 2 * DAY,
  // Once a day is enough: estimates move slowly and the quote summary is cached for 6 hours.
  collect: async ({ lastOk }) => {
    const today = new Date().toISOString().slice(0, 10);
    if (lastOk?.as_of === today) return { rows: 0, asOf: today, message: "Already saved today" };
    return collect();
  },
});

module.exports = { collect, extract, changedRows, valueAsOf, SOURCE };
