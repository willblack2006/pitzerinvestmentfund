// Metrics a thesis KPI can watch (plan section 3.5). The shared registry is
// lib/metrics/registry.js (WS2); these thesis entries are registered into it when it exists, and
// `resolve()` falls back to them when it doesn't, so thesis rules work either way.
//
// Every metric reads one research overview per symbol (the same data the Research page shows),
// fetched once per evaluation pass and reused for every pillar on that symbol.
const db = require("../../db");

const raw = (v) => (v && typeof v === "object" && "raw" in v ? v.raw : v);
const num = (v) => { const x = Number(raw(v)); return v == null || v === "" || !Number.isFinite(x) ? null : x; };

let fetchOverviewImpl = null;
// Tests (and anything without a listening server) can swap the data source.
function setOverviewFetcher(fn) { fetchOverviewImpl = fn; }
async function fetchOverview(symbol) {
  if (fetchOverviewImpl) return fetchOverviewImpl(symbol);
  const { getApi } = require("../agents/tools");
  return getApi(`/research/${encodeURIComponent(symbol)}`);
}

const ks = (o) => o?.street?.keyStats || {};
const lastFiscal = (o) => o?.analysis?.annual?.at?.(-1) || null;
const priceOf = (o) => num(o?.quote?.price) ?? num(o?.technicals?.price) ?? null;
const yahooUrl = (s) => `https://finance.yahoo.com/quote/${encodeURIComponent(s)}`;
const qAsOf = (o) => num(o?.stats?.defaultKeyStatistics?.mostRecentQuarter) ? new Date(num(o.stats.defaultKeyStatistics.mostRecentQuarter) * 1000).toISOString().slice(0, 10) : null;
const today = () => new Date().toISOString().slice(0, 10);

function latestPitch(symbol) {
  return db.prepare("SELECT * FROM pitches WHERE symbol = ? AND status IN ('approved','executed') ORDER BY COALESCE(decidedAt, createdAt) DESC LIMIT 1").get(symbol)
    || db.prepare("SELECT * FROM pitches WHERE symbol = ? ORDER BY createdAt DESC LIMIT 1").get(symbol) || null;
}

// name -> { label, unit, group, fetch(symbol, overview) -> { value, asOf, sourceUrl } }
const METRICS = {
  "price.last": { label: "Share price", unit: "usd", group: "Price", read: (o, s) => ({ value: priceOf(o), asOf: today(), sourceUrl: yahooUrl(s) }) },
  "price.vsBearPct": {
    label: "Price above the bear case", unit: "pct", group: "Price",
    read: (o, s) => { const p = priceOf(o), b = num(latestPitch(s)?.bearPrice); return { value: p && b ? p / b - 1 : null, asOf: today(), sourceUrl: `#/research/${s}/thesis` }; },
  },
  "price.toBasePct": {
    label: "Upside to the base case", unit: "pct", group: "Price",
    read: (o, s) => { const p = priceOf(o), b = num(latestPitch(s)?.basePrice); return { value: p && b ? b / p - 1 : null, asOf: today(), sourceUrl: `#/research/${s}/thesis` }; },
  },
  "price.sinceThesisPct": {
    label: "Move since the thesis was set", unit: "pct", group: "Price",
    read: (o, s) => { const p = priceOf(o), t = num(o?.thesis?.priceAtThesis); return { value: p && t ? p / t - 1 : null, asOf: today(), sourceUrl: `#/research/${s}/thesis` }; },
  },
  "price.vs200dPct": {
    label: "Price vs 200-day average", unit: "pct", group: "Price",
    read: (o, s) => { const p = priceOf(o), m = num(o?.technicals?.sma200); return { value: p && m ? p / m - 1 : null, asOf: today(), sourceUrl: yahooUrl(s) }; },
  },
  "fundamentals.revenueGrowthYoY": { label: "Revenue growth (YoY, latest quarter)", unit: "pct", group: "Growth", read: (o, s) => ({ value: num(ks(o).revenueGrowth), asOf: qAsOf(o), sourceUrl: yahooUrl(s) }) },
  "fundamentals.earningsGrowthYoY": { label: "Earnings growth (YoY, latest quarter)", unit: "pct", group: "Growth", read: (o, s) => ({ value: num(ks(o).earningsGrowth), asOf: qAsOf(o), sourceUrl: yahooUrl(s) }) },
  "fundamentals.grossMargin": { label: "Gross margin", unit: "pct", group: "Margins", read: (o, s) => ({ value: num(ks(o).grossMargin), asOf: qAsOf(o), sourceUrl: yahooUrl(s) }) },
  "fundamentals.operatingMargin": { label: "Operating margin", unit: "pct", group: "Margins", read: (o, s) => ({ value: num(ks(o).operatingMargin), asOf: qAsOf(o), sourceUrl: yahooUrl(s) }) },
  "fundamentals.profitMargin": { label: "Net margin", unit: "pct", group: "Margins", read: (o, s) => ({ value: num(ks(o).profitMargin), asOf: qAsOf(o), sourceUrl: yahooUrl(s) }) },
  "fundamentals.roe": { label: "Return on equity", unit: "pct", group: "Quality", read: (o, s) => ({ value: num(ks(o).roe), asOf: qAsOf(o), sourceUrl: yahooUrl(s) }) },
  "fundamentals.debtToEquity": { label: "Debt to equity (%)", unit: null, group: "Balance sheet", read: (o, s) => ({ value: num(ks(o).debtToEquity), asOf: qAsOf(o), sourceUrl: yahooUrl(s) }) },
  "fundamentals.currentRatio": { label: "Current ratio", unit: null, group: "Balance sheet", read: (o, s) => ({ value: num(ks(o).currentRatio), asOf: qAsOf(o), sourceUrl: yahooUrl(s) }) },
  "fundamentals.freeCashflow": { label: "Free cash flow (TTM)", unit: "usd", group: "Cash flow", read: (o, s) => ({ value: num(ks(o).freeCashflow), asOf: qAsOf(o), sourceUrl: yahooUrl(s) }) },
  "fundamentals.revenueFY": {
    label: "Revenue (last fiscal year, SEC)", unit: "usd", group: "Growth",
    read: (o, s) => { const y = lastFiscal(o); return { value: num(y?.revenue), asOf: y?.end || y?.fy || null, sourceUrl: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&ticker=${encodeURIComponent(s)}` }; },
  },
  "valuation.forwardPE": { label: "Forward P/E", unit: null, group: "Valuation", read: (o, s) => ({ value: num(ks(o).forwardPE), asOf: today(), sourceUrl: yahooUrl(s) }) },
  "valuation.evToEbitda": { label: "EV / EBITDA", unit: null, group: "Valuation", read: (o, s) => ({ value: num(ks(o).evToEbitda), asOf: today(), sourceUrl: yahooUrl(s) }) },
  "valuation.evToRevenue": { label: "EV / revenue", unit: null, group: "Valuation", read: (o, s) => ({ value: num(ks(o).evToRevenue), asOf: today(), sourceUrl: yahooUrl(s) }) },
  "estimates.revisionScore": {
    label: "Estimate revision score", unit: null, group: "Street",
    read: (o, s) => { const r = o?.street?.revisionScore; return { value: num(r?.score ?? r), asOf: today(), sourceUrl: `#/research/${s}/street` }; },
  },
  "estimates.targetUpsidePct": { label: "Street target upside", unit: "pct", group: "Street", read: (o, s) => ({ value: num(o?.street?.targets?.upside), asOf: today(), sourceUrl: yahooUrl(s) }) },
  "ownership.institutionsPct": { label: "Held by institutions", unit: "pct", group: "Ownership", read: (o, s) => ({ value: num(o?.street?.ownership?.institutionsPct), asOf: today(), sourceUrl: yahooUrl(s) }) },
  "ownership.shortPctFloat": { label: "Short interest (% of float)", unit: "pct", group: "Ownership", read: (o, s) => ({ value: num(o?.street?.shortInterest?.pctFloat), asOf: o?.street?.shortInterest?.asOf || today(), sourceUrl: yahooUrl(s) }) },
  "quality.piotroski": { label: "Piotroski F-score", unit: null, group: "Quality", read: (o, s) => ({ value: num(o?.analysis?.piotroski?.score), asOf: lastFiscal(o)?.end || null, sourceUrl: `#/research/${s}/risk` }) },
  "quality.altmanZ": { label: "Altman Z-score", unit: null, group: "Quality", read: (o, s) => ({ value: num(o?.analysis?.altman?.z), asOf: lastFiscal(o)?.end || null, sourceUrl: `#/research/${s}/risk` }) },
};

// Registers these into the shared registry (WS2) when it exists. Safe to call more than once.
let registered = false;
function registerShared() {
  if (registered) return;
  registered = true;
  let reg;
  try { reg = require("../metrics/registry"); } catch { return; }
  for (const [name, m] of Object.entries(METRICS)) {
    const entry = { label: m.label, unit: m.unit, group: m.group, fetch: async (symbol) => m.read(await fetchOverview(symbol), symbol) };
    try {
      if (typeof reg.register === "function") { if (!(reg.get?.(name))) reg.register(name, entry); }
      else if (reg.METRICS && !reg.METRICS[name]) reg.METRICS[name] = entry;
    } catch { /* a name WS2 already owns wins */ }
  }
}

function sharedEntry(name) {
  let reg;
  try { reg = require("../metrics/registry"); } catch { return null; }
  return (typeof reg.get === "function" ? reg.get(name) : null) || reg.METRICS?.[name] || null;
}

// One metric's definition: our own first (they read the cached overview), then the shared
// registry (for anything other workstreams added).
function definition(name) {
  if (METRICS[name]) return { name, label: METRICS[name].label, unit: METRICS[name].unit, group: METRICS[name].group };
  const e = sharedEntry(name);
  return e ? { name, label: e.label || name, unit: e.unit || null, group: e.group || "Other" } : null;
}

function catalog() {
  const out = Object.entries(METRICS).map(([name, m]) => ({ name, label: m.label, unit: m.unit, group: m.group }));
  try {
    const reg = require("../metrics/registry");
    const list = typeof reg.list === "function" ? reg.list() : Object.entries(reg.METRICS || {}).map(([name, e]) => ({ name, ...e }));
    for (const e of list || []) if (e?.name && !METRICS[e.name]) out.push({ name: e.name, label: e.label || e.name, unit: e.unit || null, group: e.group || "Other" });
  } catch { /* no shared registry yet */ }
  return out;
}

// A reader bound to one evaluation pass: caches one overview per symbol.
function reader() {
  const overviews = new Map();
  const overview = (s) => { if (!overviews.has(s)) overviews.set(s, Promise.resolve().then(() => fetchOverview(s)).catch((e) => ({ __error: e.message }))); return overviews.get(s); };
  return async function read(name, symbol) {
    if (METRICS[name]) {
      const o = await overview(symbol);
      if (o?.__error) return { value: null, asOf: null, sourceUrl: null, error: o.__error };
      try { return METRICS[name].read(o, symbol); } catch (e) { return { value: null, error: e.message }; }
    }
    const e = sharedEntry(name);
    if (!e?.fetch) return { value: null, asOf: null, sourceUrl: null, error: `Unknown metric ${name}.` };
    try { return await e.fetch(symbol); } catch (err) { return { value: null, error: err.message }; }
  };
}

module.exports = { METRICS, definition, catalog, reader, registerShared, setOverviewFetcher, fetchOverview, latestPitch };
