// Metric registry (plan section 3.5): one dotted name -> { label, unit, group, source,
// fetch(symbol, L) -> { value, asOf, sourceUrl } }. It powers agent conditions and rule steps
// (lib/agents/engine.js), thesis KPIs (WS4) and chart overlays (WS10). Other modules add their
// own metrics with register(); names are final once added (add, don't rename).
//
// `L` is a per-evaluation loader set (createLoaders()) so evaluating 10 metrics on one symbol
// fetches Yahoo's quote summary and price history once. Every source call is cached upstream
// (lib/cache.js), so a scheduled agent re-reading a metric every hour costs nothing new.
//
// Metrics with `history(symbol, L, days)` can be backtested by the dry run: they return
// [{ date, value }] from data the app already stores (daily closes). Others are "now only".
const db = require("../../db");

const REG = new Map();

const num = (v) => (v && typeof v === "object" && "raw" in v ? num(v.raw) : Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : null);
const today = () => new Date().toISOString().slice(0, 10);
const research = (s, tab = "") => `#/research/${encodeURIComponent(s)}${tab ? `/${tab}` : ""}`;
const DAY = 864e5;

function register(name, def) {
  if (!/^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/.test(name)) throw new Error(`Bad metric name ${name}`);
  if (typeof def.fetch !== "function") throw new Error(`Metric ${name} needs fetch()`);
  REG.set(name, { name, label: def.label || name, unit: def.unit || "", group: def.group || name.split(".")[0], source: def.source || "custom", description: def.description || "", needsSymbol: def.needsSymbol !== false, fetch: def.fetch, history: def.history || null });
}
const has = (name) => REG.has(name);
const get = (name) => REG.get(name) || null;
function list() {
  return [...REG.values()].map(({ name, label, unit, group, source, description, needsSymbol, history }) => ({ name, label, unit, group, source, description, needsSymbol, backtestable: !!history }));
}
// Closest names for a typo ("quote.chngPct" -> "quote.changePct").
function suggest(name, n = 2) {
  const lev = (a, b) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  };
  const lower = String(name).toLowerCase();
  return [...REG.keys()].map((k) => [k, lev(lower, k.toLowerCase())]).filter(([, d]) => d <= Math.max(3, lower.length / 3)).sort((a, b) => a[1] - b[1]).slice(0, n).map(([k]) => k);
}

// ---- Loaders (memoized per evaluation) ----

function createLoaders(overrides = {}) {
  const memo = new Map();
  const once = (key, fn) => { if (!memo.has(key)) memo.set(key, Promise.resolve().then(fn).catch((err) => ({ __error: err.message || String(err) }))); return memo.get(key).then((v) => { if (v && v.__error) throw new Error(v.__error); return v; }); };
  const L = {
    quote: (s) => once(`quote:${s}`, async () => (await require("../sources/yahoo").getQuotes([s]))[s] || null),
    summary: (s) => once(`qs:${s}`, () => require("../sources/yahoo").getQuoteSummary(s)),
    chart: (s) => once(`chart:${s}`, () => require("../sources/yahoo").getChart(s, "1y", "1d")),
    allocation: () => once("alloc", () => require("../portfolio").allocation()),
    insiders: (s) => once(`ins:${s}`, async () => require("../insiderSignals").scoreInsiders(await require("../sources/finnhub").getInsiderHistory(s))),
    shortPressure: (s) => once(`sp:${s}`, () => require("../../routes/shortPressure").shortPressureFor(s)),
    revisions: (s) => once(`rev:${s}`, () => require("../../routes/estimateRevisions").revisionScoreFor(s)),
    breadth: (s) => once(`13f:${s}`, async () => require("../thirteenFLive").breadthHistory(s)),
    news: (s) => once(`news:${s}`, () => require("../sources/finnhub").getCompanyNews(s, 7)),
    thesis: (s) => once(`thesis:${s}`, async () => db.prepare("SELECT * FROM research_notes WHERE symbol = ?").get(s) || null),
    position: (s) => once(`pos:${s}`, async () => db.prepare("SELECT * FROM positions WHERE symbol = ?").get(s) || null),
    tripwires: (s) => once(`trip:${s}`, async () => db.prepare("SELECT * FROM tripwires WHERE symbol = ? AND status = 'active'").all(s)),
    settings: () => once("settings", async () => require("../settings").getSettings()),
    ...overrides,
  };
  return L;
}

// ---- Price math (pure, exported for tests and the dry run) ----

const closesOf = (chart) => (chart || []).map((p) => p.close).filter((v) => Number.isFinite(v));
function smaAt(closes, n, i = closes.length - 1) {
  if (i + 1 < n) return null;
  let s = 0; for (let k = i - n + 1; k <= i; k++) s += closes[k];
  return s / n;
}
function rsiSeries(values, n = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length <= n) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) { const d = values[i] - values[i - 1]; if (d >= 0) gain += d; else loss -= d; }
  gain /= n; loss /= n;
  const val = () => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
  out[n] = val();
  for (let i = n + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n; loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = val();
  }
  return out;
}
// Daily return on day i measured in standard deviations of the prior `window` daily returns
// (vol-scaled move: a 3% day is big for a utility and noise for a quantum stock).
function sigmaMoveAt(closes, i = closes.length - 1, window = 60) {
  if (i < 2 || i - window < 1) return null;
  const rets = [];
  for (let k = Math.max(1, i - window); k < i; k++) rets.push(closes[k] / closes[k - 1] - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1));
  if (!sd) return null;
  return (closes[i] / closes[i - 1] - 1) / sd;
}
const pctChangeAt = (closes, days, i = closes.length - 1) => (i - days >= 0 && closes[i - days] ? (closes[i] / closes[i - days] - 1) * 100 : null);
function volAt(closes, window = 21, i = closes.length - 1) {
  if (i - window < 1) return null;
  const rets = [];
  for (let k = i - window + 1; k <= i; k++) rets.push(Math.log(closes[k] / closes[k - 1]));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  return Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1)) * Math.sqrt(252) * 100;
}
function drawdownAt(closes, i = closes.length - 1, lookback = 252) {
  const from = Math.max(0, i - lookback + 1);
  let hi = -Infinity; for (let k = from; k <= i; k++) hi = Math.max(hi, closes[k]);
  return hi > 0 ? (closes[i] / hi - 1) * 100 : null;
}

// A chart-based metric: value now from the last bar, history from every bar in the window.
function chartMetric(name, label, unit, f, description = "") {
  register(name, {
    label, unit, group: "price", source: "price", description,
    async fetch(s, L) {
      const chart = await L.chart(s);
      const closes = closesOf(chart);
      return { value: round(f(closes, closes.length - 1)), asOf: chart.at(-1)?.date || null, sourceUrl: research(s, "chart") };
    },
    async history(s, L, days) {
      const chart = (await L.chart(s)).filter((p) => Number.isFinite(p.close));
      const closes = chart.map((p) => p.close);
      const since = new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
      const out = [];
      chart.forEach((p, i) => { if (p.date >= since) out.push({ date: p.date, value: round(f(closes, i)) }); });
      return out;
    },
  });
}
const round = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10000) / 10000);

// ---- Quote ----
register("quote.price", {
  label: "Price", unit: "$", group: "quote", source: "yahoo", description: "Latest trade price.",
  async fetch(s, L) { const q = await L.quote(s).catch(() => null); if (q?.price != null) return { value: q.price, asOf: q.time || new Date().toISOString(), sourceUrl: research(s) }; const c = await L.chart(s); return { value: c.at(-1)?.close ?? null, asOf: c.at(-1)?.date || null, sourceUrl: research(s, "chart") }; },
  async history(s, L, days) { return REG.get("price.close").history(s, L, days); },
});
register("quote.changePct", {
  label: "Change today", unit: "%", group: "quote", source: "yahoo", description: "Percent change from the previous close.",
  async fetch(s, L) { const q = await L.quote(s).catch(() => null); if (q?.changePct != null) return { value: round(q.changePct), asOf: q.time || new Date().toISOString(), sourceUrl: research(s) }; const c = closesOf(await L.chart(s)); return { value: round(pctChangeAt(c, 1)), asOf: today(), sourceUrl: research(s, "chart") }; },
  async history(s, L, days) { return REG.get("price.change1dPct").history(s, L, days); },
});
// ---- Price history ----
chartMetric("price.close", "Daily close", "$", (c, i) => c[i]);
chartMetric("price.change1dPct", "1-day change", "%", (c, i) => pctChangeAt(c, 1, i));
chartMetric("price.change5dPct", "5-day change", "%", (c, i) => pctChangeAt(c, 5, i));
chartMetric("price.change21dPct", "1-month change", "%", (c, i) => pctChangeAt(c, 21, i));
chartMetric("price.change63dPct", "3-month change", "%", (c, i) => pctChangeAt(c, 63, i));
chartMetric("price.moveSigma", "Move in standard deviations", "σ", (c, i) => sigmaMoveAt(c, i), "Today's move divided by the stock's typical daily move over the last 60 days. ±2 or more is unusual.");
chartMetric("price.sma50", "50-day average", "$", (c, i) => smaAt(c, 50, i));
chartMetric("price.sma200", "200-day average", "$", (c, i) => smaAt(c, 200, i));
chartMetric("price.vsSma50Pct", "Price vs 50-day average", "%", (c, i) => { const m = smaAt(c, 50, i); return m ? (c[i] / m - 1) * 100 : null; });
chartMetric("price.vsSma200Pct", "Price vs 200-day average", "%", (c, i) => { const m = smaAt(c, 200, i); return m ? (c[i] / m - 1) * 100 : null; });
chartMetric("price.rsi14", "RSI (14)", "", (c, i) => rsiSeries(c.slice(0, i + 1), 14)[i], "Momentum from 0 to 100; above 70 is often called overbought, below 30 oversold.");
chartMetric("price.vol21d", "Volatility (1 month, annualized)", "%", (c, i) => volAt(c, 21, i));
chartMetric("price.drawdownPct", "Below 52-week high", "%", (c, i) => drawdownAt(c, i), "How far the price is under its highest close of the last year (0 at a new high).");

// ---- Valuation and fundamentals (Yahoo quote summary, cached 6h) ----
function summaryMetric(name, label, unit, group, pickFn, description = "", scale = 1) {
  register(name, {
    label, unit, group, source: "yahoo", description,
    async fetch(s, L) {
      const qs = await L.summary(s);
      const v = num(pickFn(qs));
      return { value: v == null ? null : round(v * scale), asOf: today(), sourceUrl: research(s, group === "valuation" ? "valuation" : "financials") };
    },
  });
}
summaryMetric("valuation.pe", "P/E (trailing)", "x", "valuation", (q) => q.summaryDetail?.trailingPE);
summaryMetric("valuation.forwardPe", "P/E (forward)", "x", "valuation", (q) => q.summaryDetail?.forwardPE ?? q.defaultKeyStatistics?.forwardPE);
summaryMetric("valuation.evEbitda", "EV / EBITDA", "x", "valuation", (q) => q.defaultKeyStatistics?.enterpriseToEbitda);
summaryMetric("valuation.evRevenue", "EV / revenue", "x", "valuation", (q) => q.defaultKeyStatistics?.enterpriseToRevenue);
summaryMetric("valuation.ps", "Price / sales", "x", "valuation", (q) => q.summaryDetail?.priceToSalesTrailing12Months);
summaryMetric("valuation.peg", "PEG", "x", "valuation", (q) => q.defaultKeyStatistics?.pegRatio);
summaryMetric("valuation.pb", "Price / book", "x", "valuation", (q) => q.defaultKeyStatistics?.priceToBook);
register("valuation.fcfYield", {
  label: "Free cash flow yield", unit: "%", group: "valuation", source: "yahoo", description: "Trailing free cash flow divided by market cap.",
  async fetch(s, L) { const q = await L.summary(s); const f = num(q.financialData?.freeCashflow), m = num(q.summaryDetail?.marketCap ?? q.price?.marketCap); return { value: f != null && m ? round((f / m) * 100) : null, asOf: today(), sourceUrl: research(s, "valuation") }; },
});
summaryMetric("valuation.marketCap", "Market cap", "$", "valuation", (q) => q.summaryDetail?.marketCap ?? q.price?.marketCap);
summaryMetric("valuation.dividendYield", "Dividend yield", "%", "valuation", (q) => q.summaryDetail?.dividendYield, "", 100);
summaryMetric("fundamentals.revenueGrowthYoY", "Revenue growth (YoY)", "%", "fundamentals", (q) => q.financialData?.revenueGrowth, "Latest quarter vs a year earlier.", 100);
summaryMetric("fundamentals.epsGrowthYoY", "Earnings growth (YoY)", "%", "fundamentals", (q) => q.financialData?.earningsGrowth, "", 100);
summaryMetric("fundamentals.grossMargin", "Gross margin", "%", "fundamentals", (q) => q.financialData?.grossMargins, "", 100);
summaryMetric("fundamentals.operatingMargin", "Operating margin", "%", "fundamentals", (q) => q.financialData?.operatingMargins, "", 100);
summaryMetric("fundamentals.netMargin", "Net margin", "%", "fundamentals", (q) => q.financialData?.profitMargins, "", 100);
summaryMetric("fundamentals.roe", "Return on equity", "%", "fundamentals", (q) => q.financialData?.returnOnEquity, "", 100);
summaryMetric("fundamentals.debtToEquity", "Debt / equity", "%", "fundamentals", (q) => q.financialData?.debtToEquity);
summaryMetric("fundamentals.currentRatio", "Current ratio", "x", "fundamentals", (q) => q.financialData?.currentRatio);
summaryMetric("risk.beta", "Beta", "", "risk", (q) => q.defaultKeyStatistics?.beta);

// ---- Street ----
const epsTrend = (q, period = "0y") => (q.earningsTrend?.trend || []).find((t) => t.period === period)?.epsTrend || null;
function revisionPct(q, daysKey) {
  const t = epsTrend(q);
  const cur = num(t?.current), then = num(t?.[daysKey]);
  return cur != null && then ? round((cur / then - 1) * 100) : null;
}
summaryMetric("street.epsRevision30dPct", "EPS estimate change, 30 days", "%", "street", (q) => revisionPct(q, "30daysAgo"), "This year's consensus EPS now vs 30 days ago.");
summaryMetric("street.epsRevision90dPct", "EPS estimate change, 90 days", "%", "street", (q) => revisionPct(q, "90daysAgo"), "This year's consensus EPS now vs 90 days ago.");
register("street.revisionScore", {
  label: "Estimate revision score", unit: "", group: "street", source: "yahoo", description: "-100 (analysts cutting) to +100 (raising).",
  async fetch(s, L) { const r = await L.revisions(s); return { value: num(r?.score), asOf: today(), sourceUrl: research(s, "street") }; },
});
register("street.targetUpsidePct", {
  label: "Upside to analyst target", unit: "%", group: "street", source: "yahoo",
  async fetch(s, L) { const q = await L.summary(s); const t = num(q.financialData?.targetMeanPrice), p = num(q.financialData?.currentPrice); return { value: t && p ? round((t / p - 1) * 100) : null, asOf: today(), sourceUrl: research(s, "street") }; },
});
summaryMetric("street.recommendationMean", "Analyst rating (1 buy - 5 sell)", "", "street", (q) => q.financialData?.recommendationMean);
register("street.nextEarningsDays", {
  label: "Days to next earnings", unit: "days", group: "street", source: "yahoo",
  async fetch(s, L) {
    const q = await L.summary(s);
    const raw = q.calendarEvents?.earnings?.earningsDate?.[0];
    const t = num(raw) != null ? num(raw) * 1000 : raw?.fmt ? Date.parse(raw.fmt) : null;
    return { value: t ? Math.ceil((t - Date.now()) / DAY) : null, asOf: today(), sourceUrl: research(s, "street") };
  },
});

// ---- Ownership and flows ----
summaryMetric("ownership.shortPctFloat", "Short interest (% of float)", "%", "ownership", (q) => q.defaultKeyStatistics?.shortPercentOfFloat, "", 100);
summaryMetric("ownership.daysToCover", "Days to cover", "days", "ownership", (q) => q.defaultKeyStatistics?.shortRatio);
register("ownership.shortPressureScore", {
  label: "Short pressure score", unit: "", group: "ownership", source: "finra", description: "0-100: short interest, days to cover and FINRA short-volume trend.",
  async fetch(s, L) { const r = await L.shortPressure(s); return { value: num(r?.score), asOf: today(), sourceUrl: research(s, "ownership") }; },
});
register("ownership.insiderScore", {
  label: "Insider signal score", unit: "", group: "ownership", source: "finnhub", description: "Positive when insiders buy with their own money (clusters count more); negative for broad selling.",
  async fetch(s, L) { const r = await L.insiders(s); return { value: num(r?.score), asOf: today(), sourceUrl: research(s, "ownership") }; },
});
register("ownership.insiderBuys90d", {
  label: "Insider open-market buys (90 days)", unit: "", group: "ownership", source: "finnhub",
  async fetch(s, L) { const r = await L.insiders(s); const c = r?.counts || {}; const v = Object.entries(c).filter(([k]) => /Buys$/.test(k)).reduce((a, [, n]) => a + (Number(n) || 0), 0); return { value: r ? v : null, asOf: today(), sourceUrl: research(s, "ownership") }; },
});
register("ownership.thirteenFNetPct", {
  label: "13F holders adding minus cutting", unit: "%", group: "ownership", source: "sec", description: "Net share of institutional filers that added the stock last quarter.",
  async fetch(s, L) { const r = await L.breadth(s); const last = r?.rows?.at(-1); return { value: num(last?.netPct), asOf: last?.period || null, sourceUrl: research(s, "ownership") }; },
});

// ---- The fund ----
register("fund.weightPct", {
  label: "Weight in the fund", unit: "%", group: "fund", source: "fund",
  async fetch(s, L) { const a = await L.allocation(); const p = a.positions.find((x) => x.symbol === s); return { value: p ? p.weight : 0, asOf: today(), sourceUrl: "#/allocation" }; },
});
register("fund.ipsHeadroomPct", {
  label: "Room under the position limit", unit: "pts", group: "fund", source: "fund", description: "Max position % minus current weight. Negative means over the limit.",
  async fetch(s, L) { const [a, st] = await Promise.all([L.allocation(), L.settings()]); const p = a.positions.find((x) => x.symbol === s); const max = st.maxPositionPct; return { value: max == null ? null : round(max - (p ? p.weight : 0)), asOf: today(), sourceUrl: "#/allocation" }; },
});
register("fund.unrealizedPct", {
  label: "Gain since bought", unit: "%", group: "fund", source: "fund", description: "Current price vs the fund's average cost.",
  async fetch(s, L) {
    const pos = await L.position(s);
    if (!pos || !pos.shares) return { value: null, asOf: today(), sourceUrl: "#/holdings" };
    const per = num(pos.avgCost) || (num(pos.totalCost) ? pos.totalCost / pos.shares : null);
    const price = (await REG.get("quote.price").fetch(s, L)).value;
    return { value: per && price ? round((price / per - 1) * 100) : null, asOf: today(), sourceUrl: "#/holdings" };
  },
});
register("fund.targetDistancePct", {
  label: "Distance to thesis target", unit: "%", group: "fund", source: "fund", description: "How far the price must move to reach the thesis target price (positive = upside left).",
  async fetch(s, L) { const t = await L.thesis(s); const tp = num(t?.targetPrice); if (!tp) return { value: null, asOf: null, sourceUrl: research(s, "thesis") }; const price = (await REG.get("quote.price").fetch(s, L)).value; return { value: price ? round((tp / price - 1) * 100) : null, asOf: today(), sourceUrl: research(s, "thesis") }; },
});
register("fund.tripwireDistancePct", {
  label: "Distance to nearest price tripwire", unit: "%", group: "fund", source: "fund", description: "Percent move to the nearest active price tripwire (smaller = closer).",
  async fetch(s, L) {
    const trips = (await L.tripwires(s)).filter((t) => t.kind.startsWith("price_") && Number.isFinite(t.value));
    if (!trips.length) return { value: null, asOf: null, sourceUrl: research(s, "thesis") };
    const price = (await REG.get("quote.price").fetch(s, L)).value;
    if (!price) return { value: null, asOf: null, sourceUrl: research(s, "thesis") };
    const d = Math.min(...trips.map((t) => Math.abs(t.value / price - 1) * 100));
    return { value: round(d), asOf: today(), sourceUrl: research(s, "thesis") };
  },
});
register("fund.cashPct", {
  label: "Fund cash", unit: "%", group: "fund", source: "fund", needsSymbol: false,
  async fetch(_s, L) { const a = await L.allocation(); return { value: round(a.cashPct), asOf: today(), sourceUrl: "#/allocation" }; },
});
register("fund.ipsBreaches", {
  label: "Policy limits breached", unit: "", group: "fund", source: "fund", needsSymbol: false,
  async fetch(_s, L) { const a = await L.allocation(); return { value: a.checks.filter((c) => c.level === "breach").length, asOf: today(), sourceUrl: "#/allocation" }; },
});
register("fund.positions", {
  label: "Number of holdings", unit: "", group: "fund", source: "fund", needsSymbol: false,
  async fetch() { return { value: db.prepare("SELECT COUNT(*) AS n FROM positions").get().n, asOf: today(), sourceUrl: "#/holdings" }; },
});

// ---- Thesis and news ----
register("thesis.daysSinceUpdate", {
  label: "Days since the thesis was updated", unit: "days", group: "thesis", source: "fund",
  async fetch(s, L) { const t = await L.thesis(s); if (!t || !t.thesis) return { value: null, asOf: null, sourceUrl: research(s, "thesis") }; const at = Date.parse(`${String(t.updatedAt).replace(" ", "T")}Z`); return { value: Number.isFinite(at) ? Math.floor((Date.now() - at) / DAY) : null, asOf: t.updatedAt, sourceUrl: research(s, "thesis") }; },
});
register("thesis.status", {
  label: "Thesis status", unit: "", group: "thesis", source: "fund", description: "intact, watch, weakened, broken, or blank when never checked.",
  async fetch(s, L) { const t = await L.thesis(s); return { value: t?.thesisStatus || null, asOf: t?.thesisStatusAt || null, sourceUrl: research(s, "thesis") }; },
});
register("thesis.hasThesis", {
  label: "Has a written thesis", unit: "", group: "thesis", source: "fund",
  async fetch(s, L) { const t = await L.thesis(s); return { value: t && String(t.thesis || "").trim() ? 1 : 0, asOf: t?.updatedAt || null, sourceUrl: research(s, "thesis") }; },
});
register("news.count7d", {
  label: "News stories (7 days)", unit: "", group: "news", source: "finnhub",
  async fetch(s, L) { const n = await L.news(s); return { value: Array.isArray(n) ? n.length : null, asOf: today(), sourceUrl: research(s, "news") }; },
});

// Reads one metric. Never throws: an unavailable source comes back as { value: null, error }.
async function value(name, symbol, { loaders = createLoaders() } = {}) {
  const m = REG.get(name);
  if (!m) return { value: null, error: `Unknown metric ${name}` };
  if (m.needsSymbol && !symbol) return { value: null, error: `${m.label} needs a ticker.` };
  try {
    const r = await m.fetch(symbol, loaders);
    return { value: r?.value ?? null, asOf: r?.asOf ?? null, sourceUrl: r?.sourceUrl ?? null };
  } catch (err) { return { value: null, error: err.message || String(err) }; }
}

async function history(name, symbol, days, { loaders = createLoaders() } = {}) {
  const m = REG.get(name);
  if (!m?.history) return null;
  try { return await m.history(symbol, loaders, days); } catch { return []; }
}

module.exports = { register, has, get, list, suggest, value, history, createLoaders, sigmaMoveAt, rsiSeries, smaAt, pctChangeAt, volAt, drawdownAt };
