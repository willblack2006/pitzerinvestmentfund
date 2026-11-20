// Research data as pictures (WS10): event layers for the annotated price chart and the inputs
// for the valuation football field and multiple bands. Every source is best-effort: a missing
// one empties its layer and is named in `errors`, never fails the response.
const express = require("express");
const db = require("../db");
const yahoo = require("../lib/sources/yahoo");
const sec = require("../lib/sources/sec");
const finnhub = require("../lib/sources/finnhub");
const fundamentals = require("../lib/fundamentals");
const { dcfValue } = require("../lib/dcf");
const viz = require("../lib/researchViz");

const router = express.Router();
const TICKER = /^[A-Z0-9.\-^=]{1,12}$/;
const raw = (v) => (v && typeof v === "object" ? ("raw" in v && typeof v.raw !== "object" ? v.raw : null) : v ?? null);
const errOf = (r) => (r.status === "rejected" ? String(r.reason?.message || r.reason) : null);
const val = (r) => (r.status === "fulfilled" ? r.value : null);
const hasTable = (name) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
const columns = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

function symbolParam(req, res) {
  const s = String(req.params.symbol || "").toUpperCase().trim();
  if (!TICKER.test(s)) { res.status(400).json({ error: "That doesn't look like a ticker." }); return null; }
  return s;
}

// Agent runs about this symbol that a member would want on the chart: finished, and not a
// member's private Ask (those are shown only if the run was shared, once WS7's `shared` lands).
function agentRunsFor(symbol, from) {
  if (!hasTable("agent_runs")) return [];
  const cols = columns("agent_runs");
  const summary = cols.includes("summary") ? "summary" : "NULL AS summary";
  const shared = cols.includes("shared") ? "OR shared = 1" : "";
  return db.prepare(`SELECT id, workflow, createdAt, output, ${summary} FROM agent_runs
    WHERE symbol = ? AND status = 'done' AND createdAt >= ? AND (workflow NOT IN ('ask_pif','ask') ${shared})
    ORDER BY createdAt LIMIT 200`).all(symbol, from);
}

async function annotationsFor(symbol, { years = 5 } = {}) {
  const from = new Date(Date.now() - years * 365.25 * 864e5).toISOString().slice(0, 10);
  const [filings, insiders, dividends, qs] = await Promise.allSettled([
    sec.getAllRecentFilings(symbol),
    finnhub.apiKey() ? finnhub.getInsiderHistory(symbol) : Promise.reject(new Error("FINNHUB_API_KEY not configured")),
    yahoo.getDividendEvents(symbol),
    yahoo.getQuoteSummary(symbol),
  ]);
  const q = val(qs);
  const history = (q?.earningsHistory?.history || []).map((h) => ({
    quarter: h.quarter?.fmt, actual: raw(h.epsActual), estimate: raw(h.epsEstimate), surprisePct: raw(h.surprisePercent),
  })).filter((h) => h.actual !== null);
  const nextEarnings = (q?.calendarEvents?.earnings?.earningsDate || []).map((d) => d.fmt).filter(Boolean);
  const pitches = db.prepare("SELECT id, symbol, direction, status, title, author, bullPrice, basePrice, bearPrice, priceAtPitch, createdAt, decidedAt FROM pitches WHERE symbol = ? ORDER BY createdAt").all(symbol);
  const trades = db.prepare("SELECT date, type, shares, price FROM transactions WHERE symbol = ? AND type IN ('buy','sell') ORDER BY date").all(symbol);
  const tripwires = hasTable("tripwires") ? db.prepare("SELECT id, kind, value, status, note FROM tripwires WHERE symbol = ?").all(symbol) : [];
  const out = viz.buildAnnotations({
    from, filings: val(filings) || [], insiders: val(insiders) || [], dividends: val(dividends) || [],
    pitches, trades, runs: agentRunsFor(symbol, from), tripwires, history, nextEarnings,
  });
  // Bull/base/bear marks over time (WS4's scenario_marks) override the pitch cases when present.
  if (hasTable("scenario_marks")) {
    const marks = db.prepare("SELECT createdAt, bullProb, baseProb, bearProb, note FROM scenario_marks WHERE symbol = ? ORDER BY createdAt DESC LIMIT 1").get(symbol);
    if (marks && out.scenarios) out.scenarios.probabilities = { bull: marks.bullProb, base: marks.baseProb, bear: marks.bearProb, asOf: String(marks.createdAt).slice(0, 10) };
  }
  out.symbol = symbol;
  out.errors = { filings: errOf(filings), insiders: errOf(insiders), dividends: errOf(dividends), earnings: errOf(qs) };
  return out;
}

router.get("/research/:symbol/annotations", async (req, res) => {
  const symbol = symbolParam(req, res);
  if (!symbol) return;
  res.json(await annotationsFor(symbol));
});

// Football field + P/E and EV/EBITDA bands, one call for the Valuation tab.
async function valuationVizFor(symbol) {
  const [facts, weekly, qs, quotes, comps] = await Promise.allSettled([
    sec.getCompanyFacts(symbol),
    yahoo.getChart(symbol, "5y", "1wk"),
    yahoo.getQuoteSummary(symbol),
    yahoo.getQuotes([symbol]),
    compsFor(symbol),
  ]);
  const f = val(facts), q = val(qs), bars = val(weekly) || [];
  const price = val(quotes)?.[symbol]?.price ?? raw(q?.financialData?.currentPrice) ?? bars.at(-1)?.close ?? null;
  const bands = viz.multipleBands(f, bars);
  const sd = q?.summaryDetail || {}, fd = q?.financialData || {};
  const marketCap = raw(sd.marketCap) ?? raw(q?.price?.marketCap);
  const analysis = f ? fundamentals.analyze(f, { marketCap }) : null;
  const analystGrowth = raw((q?.earningsTrend?.trend || []).find((t) => t.period === "+1y")?.growth);
  const pitch = db.prepare(`SELECT id, status, bullPrice AS bull, basePrice AS base, bearPrice AS bear FROM pitches
    WHERE symbol = ? AND (bullPrice IS NOT NULL OR basePrice IS NOT NULL OR bearPrice IS NOT NULL) AND status NOT IN ('withdrawn','rejected')
    ORDER BY createdAt DESC LIMIT 1`).get(symbol) || null;
  const lo52 = raw(sd.fiftyTwoWeekLow), hi52 = raw(sd.fiftyTwoWeekHigh);
  const yearBars = bars.slice(-52).map((b) => b.close).filter(Number.isFinite);
  const isFinancial = /financial/i.test(q?.assetProfile?.sector || "");
  const field = viz.footballField({
    price,
    range52: lo52 && hi52 ? { low: lo52, high: hi52 } : yearBars.length ? { low: Math.min(...yearBars), high: Math.max(...yearBars) } : null,
    targets: { low: raw(fd.targetLowPrice), high: raw(fd.targetHighPrice), mean: raw(fd.targetMeanPrice), median: raw(fd.targetMedianPrice) },
    dcf: isFinancial ? null : viz.dcfRange(analysis?.dcf, analystGrowth, dcfValue),
    comps: viz.compsRange(val(comps) || [], symbol, price),
    bands,
    pitch,
  });
  return {
    symbol, price, football: field, bands,
    errors: { facts: errOf(facts) || (f ? null : "No SEC filings (ETF, fund or foreign filer)"), prices: errOf(weekly), quoteSummary: errOf(qs), comps: errOf(comps) },
  };
}

async function compsFor(symbol) {
  if (!finnhub.apiKey()) return [];
  let peers = [];
  try { peers = await yahoo.getPeers(symbol); } catch { /* none */ }
  const symbols = [...new Set([symbol, ...peers.slice(0, 8)])];
  const got = await Promise.allSettled(symbols.map((s) => finnhub.getCompMetrics(s)));
  return symbols.map((s, i) => ({ symbol: s, ...(val(got[i]) || {}) }));
}

router.get("/research/:symbol/valuation-viz", async (req, res) => {
  const symbol = symbolParam(req, res);
  if (!symbol) return;
  res.json(await valuationVizFor(symbol));
});

module.exports = router;
module.exports.autoMount = true; // WS1 auto-mount (server.js mounts routes/*.js with this flag)
module.exports.annotationsFor = annotationsFor;
module.exports.valuationVizFor = valuationVizFor;
