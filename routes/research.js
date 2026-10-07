const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const yahoo = require("../lib/sources/yahoo");
const sec = require("../lib/sources/sec");
const { cached } = require("../lib/cache");
const { scanRedFlags } = require("../lib/redFlags");
const { scoreEstimateRevisions } = require("../lib/estimateRevision");
const { compareFilingSections } = require("../lib/filingDiff");
const { parseCoverPage, buildActivistAlerts, FORMS: ACTIVIST_FORMS } = require("../lib/activistFilings");
const { extractCustomerMentions, economicLinkGap } = require("../lib/supplyChain");
const { normalizeName } = require("../lib/thirteenF");
const { putCallRatio, maxPain, expectedMove, ivSkew, dealerGammaByStrike } = require("../lib/options");
const finnhub = require("../lib/sources/finnhub");
const claude = require("../lib/sources/claude");
const fundamentals = require("../lib/fundamentals");
const analytics = require("../lib/analytics");
const { getSettings } = require("../lib/settings");
const benchmarks = require("../lib/benchmarks");

const router = express.Router();

function settledValue(result) {
  return result.status === "fulfilled" ? result.value : null;
}
// Yahoo wraps numbers as { raw, fmt } and sends {} when a value is missing; never let an
// object leak through as a value.
const raw = (v) => {
  if (v && typeof v === "object") return "raw" in v && typeof v.raw !== "object" ? v.raw : null;
  return v ?? null;
};
const errOf = (r) => (r.status === "rejected" ? String(r.reason?.message || r.reason) : null);

// Everything the "Street" panel needs, flattened out of Yahoo's quoteSummary modules.
function streetView(qs, price) {
  if (!qs) return null;
  const fd = qs.financialData || {};
  const trend = (qs.recommendationTrend?.trend || []).map((t) => ({
    period: t.period, strongBuy: t.strongBuy, buy: t.buy, hold: t.hold, sell: t.sell, strongSell: t.strongSell,
  }));
  const estimates = (qs.earningsTrend?.trend || []).map((t) => ({
    period: t.period,
    endDate: t.endDate,
    growth: raw(t.growth),
    epsAvg: raw(t.earningsEstimate?.avg), epsLow: raw(t.earningsEstimate?.low), epsHigh: raw(t.earningsEstimate?.high),
    epsYearAgo: raw(t.earningsEstimate?.yearAgoEps), analysts: raw(t.earningsEstimate?.numberOfAnalysts),
    revenueAvg: raw(t.revenueEstimate?.avg), revenueYearAgo: raw(t.revenueEstimate?.yearAgoRevenue),
    epsTrend: t.epsTrend ? { current: raw(t.epsTrend.current), d7: raw(t.epsTrend["7daysAgo"]), d30: raw(t.epsTrend["30daysAgo"]), d60: raw(t.epsTrend["60daysAgo"]), d90: raw(t.epsTrend["90daysAgo"]) } : null,
    revisions: t.epsRevisions ? { up7: raw(t.epsRevisions.upLast7days), up30: raw(t.epsRevisions.upLast30days), down7: raw(t.epsRevisions.downLast7Days), down30: raw(t.epsRevisions.downLast30days) } : null,
  }));
  const history = (qs.earningsHistory?.history || []).map((h) => ({
    quarter: h.quarter?.fmt, actual: raw(h.epsActual), estimate: raw(h.epsEstimate), surprisePct: raw(h.surprisePercent),
  })).filter((h) => h.actual !== null);
  const cal = qs.calendarEvents || {};
  const nextEarnings = cal.earnings?.earningsDate?.map((d) => d.fmt) || [];
  const changes = (qs.upgradeDowngradeHistory?.history || []).slice(0, 15).map((h) => ({
    date: new Date(h.epochGradeDate * 1000).toISOString().slice(0, 10),
    firm: h.firm, action: h.action, from: h.fromGrade, to: h.toGrade,
    priceTarget: h.currentPriceTarget || null, priorTarget: h.priorPriceTarget || null, targetAction: h.priceTargetAction || "",
  }));
  const holders = (qs.institutionOwnership?.ownershipList || []).slice(0, 10).map((o) => ({
    name: o.organization, pctHeld: raw(o.pctHeld), value: raw(o.value), pctChange: raw(o.pctChange), reportDate: o.reportDate?.fmt,
  }));
  const mh = qs.majorHoldersBreakdown || {};
  const ks = qs.defaultKeyStatistics || {};
  const target = raw(fd.targetMeanPrice);
  return {
    targets: {
      mean: target, median: raw(fd.targetMedianPrice), high: raw(fd.targetHighPrice), low: raw(fd.targetLowPrice),
      analysts: raw(fd.numberOfAnalystOpinions), recommendationMean: raw(fd.recommendationMean), recommendationKey: fd.recommendationKey || null,
      upside: target && price ? target / price - 1 : null,
    },
    trend,
    estimates,
    revisionScore: scoreEstimateRevisions(estimates),
    history,
    nextEarnings: { dates: nextEarnings, estimated: !!cal.earnings?.isEarningsDateEstimate, epsAvg: raw(cal.earnings?.earningsAverage), revenueAvg: raw(cal.earnings?.revenueAverage) },
    exDividendDate: cal.exDividendDate?.fmt || null,
    changes,
    ownership: {
      institutionsPct: raw(mh.institutionsPercentHeld), insidersPct: raw(mh.insidersPercentHeld), institutionsCount: raw(mh.institutionsCount), holders,
    },
    shortInterest: { pctFloat: raw(ks.shortPercentOfFloat), ratio: raw(ks.shortRatio), shares: raw(ks.sharesShort), priorShares: raw(ks.sharesShortPriorMonth), asOf: ks.dateShortInterest?.fmt || null },
    keyStats: {
      beta: raw(ks.beta), forwardPE: raw(ks.forwardPE), peg: raw(ks.pegRatio), evToEbitda: raw(ks.enterpriseToEbitda), evToRevenue: raw(ks.enterpriseToRevenue),
      priceToBook: raw(ks.priceToBook), enterpriseValue: raw(ks.enterpriseValue), sharesOutstanding: raw(ks.sharesOutstanding),
      grossMargin: raw(fd.grossMargins), operatingMargin: raw(fd.operatingMargins), profitMargin: raw(fd.profitMargins),
      roe: raw(fd.returnOnEquity), revenueGrowth: raw(fd.revenueGrowth), earningsGrowth: raw(fd.earningsGrowth),
      debtToEquity: raw(fd.debtToEquity), currentRatio: raw(fd.currentRatio), freeCashflow: raw(fd.freeCashflow),
    },
  };
}

router.get("/research/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase().trim();

  const [chart, quoteSummary, peers, facts, news, live, quickFilings] = await Promise.allSettled([
    yahoo.getChart(symbol),
    yahoo.getQuoteSummary(symbol),
    yahoo.getPeers(symbol),
    sec.getCompanyFacts(symbol),
    finnhub.getCompanyNews(symbol),
    yahoo.getQuotes([symbol]),
    // Cheap red-flag check for the Overview badge: item codes + late-filing notices only
    // (no EDGAR full-text search here — that runs on the Filings tab's dedicated endpoint).
    sec.getRecentFilings(symbol, ["8-K", "NT 10-K", "NT 10-Q"]),
  ]);

  const qs = settledValue(quoteSummary);
  const quote = settledValue(live)?.[symbol] || null;
  const note = db.prepare("SELECT * FROM research_notes WHERE symbol = ?").get(symbol);
  const position = db.prepare("SELECT * FROM positions WHERE symbol = ?").get(symbol) || null;
  const watch = db.prepare("SELECT * FROM watchlist WHERE symbol = ?").get(symbol) || null;
  const pitches = db.prepare("SELECT id, direction, status, author, basePrice, createdAt FROM pitches WHERE symbol = ? ORDER BY createdAt DESC").all(symbol);
  const alerts = db.prepare("SELECT * FROM price_alerts WHERE symbol = ?").all(symbol);
  const chartPoints = settledValue(chart) || [];
  const factsValue = settledValue(facts);
  // Live quote first; the quoteSummary price can be hours old (that module is cached 6h).
  const price = quote?.price ?? raw(qs?.financialData?.currentPrice) ?? chartPoints.at(-1)?.close ?? null;
  const marketCap = raw(qs?.summaryDetail?.marketCap) ?? raw(qs?.price?.marketCap);
  const closes = chartPoints.map((p) => p.close);

  res.json({
    symbol,
    notFound: !qs && !chartPoints.length && !quote && !position && !watch,
    quote,
    name: qs?.price?.longName || qs?.price?.shortName || factsValue?.companyName || null,
    quoteType: qs?.price?.quoteType || null,
    position,
    watch,
    pitches,
    priceAlerts: alerts,
    profile: qs?.assetProfile || null,
    stats: {
      summaryDetail: qs?.summaryDetail || null,
      defaultKeyStatistics: qs?.defaultKeyStatistics || null,
      financialData: qs?.financialData || null,
      recommendationTrend: qs?.recommendationTrend || null,
    },
    street: streetView(qs, price),
    technicals: closes.length ? { sma50: analytics.sma(closes, 50), sma200: analytics.sma(closes, 200), price } : null,
    financials: factsValue,
    analysis: fundamentals.analyze(factsValue, { marketCap }),
    chart: chartPoints,
    news: settledValue(news) || [],
    peers: settledValue(peers) || [],
    thesis: note || null,
    aiEnabled: claude.configured(),
    redFlags: scanRedFlags(settledValue(quickFilings) || []),
    errors: {
      chart: errOf(chart), quoteSummary: errOf(quoteSummary), peers: errOf(peers), financials: errOf(facts), news: errOf(news),
    },
  });
});

// Red-flag scanner: 8-K items (auditor change, restatement, exec departure), late-filing
// notices, and EDGAR full-text search for going-concern / material-weakness language.
async function redFlagsFor(symbol) {
  return cached(`red_flags_${symbol}`, 24 * 60 * 60, "red_flags", async () => {
    const cik = await sec.cikFor(symbol);
    const filings = await sec.getRecentFilings(symbol, ["8-K", "10-K", "10-Q", "NT 10-K", "NT 10-Q"]);
    let goingConcern = [], materialWeakness = [];
    if (cik) {
      const since = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      [goingConcern, materialWeakness] = await Promise.all([
        sec.fullTextSearch({ q: "going concern", forms: "10-K,10-Q", cik, startdt: since }).catch(() => []),
        sec.fullTextSearch({ q: "material weakness", forms: "10-K,10-Q", cik, startdt: since }).catch(() => []),
      ]);
    }
    return scanRedFlags(filings, { goingConcern, materialWeakness });
  });
}

router.get("/research/:symbol/red-flags", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase().trim();
  try {
    res.json({ symbol, flags: await redFlagsFor(symbol) });
  } catch (err) {
    res.json({ symbol, flags: [], error: err.message });
  }
});

// Filing-change detector ("Lazy Prices", Cohen, Malloy & Nguyen 2020): diff the Risk
// Factors / MD&A / Legal Proceedings sections of the two most recent same-type filings
// (10-K vs prior 10-K, or 10-Q vs prior 10-Q) and score how much they changed.
async function filingDiffFor(symbol, form) {
  // Paragraph lists are capped before caching: uncapped, one diff was up to 1.2 MB, and the
  // whole cache table gets downloaded by every new Vercel instance. Counts stay exact.
  const cap = (paras) => paras.slice(0, 40).map((p) => p.slice(0, 2000));
  return cached(`filing_diff_v2_${symbol}_${form}`, 24 * 60 * 60, "filing_diff", async () => {
    const filings = (await sec.getRecentFilings(symbol, [form])).filter((f) => f.form === form);
    if (filings.length < 2) return { form, available: false, reason: `Need two ${form} filings to compare; only ${filings.length} found.` };
    const [latest, prior] = filings; // newest first
    const [latestText, priorText] = await Promise.all([sec.getFilingText(latest.url), sec.getFilingText(prior.url)]);
    const latestSections = claude.extractSections(latestText, form, { includeLegal: true });
    const priorSections = claude.extractSections(priorText, form, { includeLegal: true });
    const sections = latestSections.map((s) => {
      const match = priorSections.find((p) => p.label === s.label);
      const cmp = compareFilingSections(match?.body, s.body);
      return { label: s.label, ...cmp, addedCount: cmp.added.length, removedCount: cmp.removed.length, added: cap(cmp.added), removed: cap(cmp.removed), hasPrior: !!match };
    });
    return {
      form, available: true,
      latest: { accession: latest.accession, filingDate: latest.filingDate, url: latest.url },
      prior: { accession: prior.accession, filingDate: prior.filingDate, url: prior.url },
      sections,
    };
  });
}

router.get("/research/:symbol/filing-diff", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase().trim();
  const form = req.query.form === "10-Q" ? "10-Q" : "10-K";
  try {
    res.json({ symbol, aiEnabled: claude.configured(), ...(await filingDiffFor(symbol, form)) });
  } catch (err) {
    res.json({ symbol, form, available: false, error: err.message, aiEnabled: claude.configured() });
  }
});

// AI summary of what changed between the two filings (costs API credit, so edit-unlocked only).
router.post("/research/:symbol/filing-diff/summary", require("../middleware/auth").requireAuth, async (req, res) => {
  const symbol = req.params.symbol.toUpperCase().trim();
  const form = req.query.form === "10-Q" ? "10-Q" : "10-K";
  if (!claude.configured()) return res.status(503).json({ error: "AI summaries need ANTHROPIC_API_KEY set on the server." });
  try {
    const diff = await filingDiffFor(symbol, form);
    if (!diff.available) return res.status(404).json({ error: diff.reason || "Not enough filings to compare." });
    res.json(await claude.summarizeFilingChange(symbol, diff));
  } catch (err) {
    res.status(502).json({ error: `Summary failed: ${err.message}` });
  }
});

// Activist / 5%-owner alerts: new SC 13D / 13D-A / 13G / 13G-A filings, with a best-effort
// cover-page parse of the filer and stake %.
async function activistFilingsFor(symbol, { withCoverPages = true, sinceDays = 365 } = {}) {
  return cached(`activist_${symbol}_${withCoverPages}`, 6 * 60 * 60, "activist_filings", async () => {
    const all = await sec.getRecentFilings(symbol, ACTIVIST_FORMS);
    const cutoff = new Date(Date.now() - sinceDays * 864e5).toISOString().slice(0, 10);
    const recent = all.filter((f) => f.filingDate >= cutoff);
    const coverPages = {};
    if (withCoverPages) {
      await Promise.all(recent.slice(0, 10).map(async (f) => {
        try { coverPages[f.accession] = parseCoverPage(await sec.getFilingText(f.url)); } catch { /* best effort */ }
      }));
    }
    return buildActivistAlerts(recent, coverPages);
  });
}

router.get("/research/:symbol/activist-filings", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase().trim();
  try {
    res.json({ symbol, filings: await activistFilingsFor(symbol) });
  } catch (err) {
    res.json({ symbol, filings: [], error: err.message });
  }
});

// Supply-chain map: major customers (>=10% of revenue) disclosed in the latest 10-K, matched
// to tickers via SEC's own ticker/company-name directory, plus a 3-month return comparison
// (Cohen & Frazzini, "Economic Links and Predictable Returns", 2008).
async function supplyChainFor(symbol) {
  return cached(`supply_chain_${symbol}`, 24 * 60 * 60, "supply_chain", async () => {
    const filings = await sec.getRecentFilings(symbol, ["10-K"]);
    if (!filings.length) return { customers: [], filing: null };
    const text = await sec.getFilingText(filings[0].url);
    const mentions = extractCustomerMentions(text);
    if (!mentions.length) return { customers: [], filing: { url: filings[0].url, filingDate: filings[0].filingDate } };
    const directory = await sec.getCompanyDirectory();
    const byName = new Map(directory.map((d) => [normalizeName(d.name), d.ticker]));
    const matched = mentions.map((m) => ({ ...m, ticker: byName.get(normalizeName(m.customer)) || null }));

    const [supplierChart, ...customerCharts] = await Promise.all([
      yahoo.getChart(symbol, "6mo", "1d"),
      ...matched.map((m) => (m.ticker ? yahoo.getChart(m.ticker, "6mo", "1d").catch(() => []) : Promise.resolve([]))),
    ]);
    const ret3mo = (chart) => (chart.length >= 60 ? chart.at(-1).close / chart.at(-60).close - 1 : null);
    const supplierReturn = ret3mo(supplierChart);
    const customers = matched.map((m, i) => {
      const customerReturn = ret3mo(customerCharts[i]);
      return { ...m, customerReturn, supplierReturn, gap: economicLinkGap(customerReturn, supplierReturn) };
    });
    return { customers, filing: { url: filings[0].url, filingDate: filings[0].filingDate } };
  });
}

router.get("/research/:symbol/supply-chain", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase().trim();
  try {
    res.json({ symbol, ...(await supplyChainFor(symbol)) });
  } catch (err) {
    res.json({ symbol, customers: [], error: err.message });
  }
});

// Options positioning: open interest, put/call ratios, max pain, IV skew, expected move from
// the ATM straddle, and estimated dealer gamma by strike — context, not a forecast.
router.get("/research/:symbol/options", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase().trim();
  const date = req.query.date ? Number(req.query.date) : null;
  try {
    const chain = await yahoo.getOptionsChain(symbol, date);
    const { calls, puts, spot, expiration, expirationDates } = chain;
    const mid = (o) => (Number.isFinite(o?.bid) && Number.isFinite(o?.ask) ? (o.bid + o.ask) / 2 : null);
    const nearestStrike = (rows) => rows.reduce((best, r) => (!best || Math.abs(r.strike - spot) < Math.abs(best.strike - spot) ? r : best), null);
    const atmCall = nearestStrike(calls), atmPut = nearestStrike(puts);
    const yearsToExpiry = expiration ? Math.max(0, (expiration * 1000 - Date.now()) / (365 * 864e5)) : null;

    res.json({
      symbol, spot, expiration, expirationDates,
      pcRatio: putCallRatio(calls, puts),
      maxPainStrike: maxPain(calls, puts),
      expectedMovePct: atmCall && atmPut ? expectedMove(mid(atmCall), mid(atmPut), spot) : null,
      atmStrike: atmCall?.strike ?? null,
      skew: ivSkew(calls, puts, spot),
      gammaByStrike: yearsToExpiry ? dealerGammaByStrike(calls, puts, spot, yearsToExpiry) : [],
      callOI: calls.map((c) => ({ strike: c.strike, openInterest: c.openInterest })),
      putOI: puts.map((p) => ({ strike: p.strike, openInterest: p.openInterest })),
    });
  } catch (err) {
    res.json({ symbol, error: err.message });
  }
});

// Peer comparison table: the company plus up to 8 peers on one set of metrics.
router.get("/research/:symbol/comps", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase().trim();
  let peers = [];
  try { peers = await yahoo.getPeers(symbol); } catch { /* none */ }
  const extra = String(req.query.add || "").toUpperCase().split(",").map((s) => s.trim()).filter((s) => /^[A-Z0-9.\-]{1,10}$/.test(s));
  const symbols = [...new Set([symbol, ...peers.slice(0, 8), ...extra])].slice(0, 12);
  const results = await Promise.allSettled(symbols.map((s) => finnhub.getCompMetrics(s)));
  const rows = symbols.map((s, i) => ({ symbol: s, ...(settledValue(results[i]) || {}), error: errOf(results[i]) }));
  const metrics = ["peTTM", "forwardPE", "psTTM", "evEbitda", "pfcf", "pb", "grossMargin", "operatingMargin", "netMargin", "roe", "revenueGrowth", "epsGrowth", "dividendYield", "return1Y"];
  const median = {};
  for (const m of metrics) {
    const vals = rows.filter((r) => r.symbol !== symbol && Number.isFinite(r[m]) && r[m] > -1e6).map((r) => r[m]).sort((a, b) => a - b);
    median[m] = vals.length ? (vals.length % 2 ? vals[(vals.length - 1) / 2] : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2) : null;
  }
  res.json({ symbol, rows, peerMedian: median, keyMissing: !finnhub.apiKey() });
});

// Risk vs the benchmark and the company's sector ETF.
router.get("/research/:symbol/risk", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase().trim();
  let benchmark;
  try { benchmark = benchmarks.normalize(req.query.benchmark || getSettings().benchmark); } catch (e) { return res.status(400).json({ error: e.message }); }
  // The asset/benchmark charts don't depend on the sector lookup, so kick them off in
  // parallel with it instead of waiting for it to finish first (that serial round trip was
  // pure added latency on every Risk tab load).
  const assetPromise = yahoo.getChart(symbol, "2y", "1d");
  const benchPromise = benchmarks.series(benchmark, "2y");
  let sector = "";
  try { sector = (await yahoo.getSector(symbol)).sector; } catch { /* unknown */ }
  const sectorEtf = analytics.SECTOR_ETF[sector] || null;
  const [a, b, s] = await Promise.allSettled([
    assetPromise,
    benchPromise,
    sectorEtf && sectorEtf !== symbol ? yahoo.getChart(sectorEtf, "2y", "1d") : Promise.resolve(null),
  ]);
  const asset = settledValue(a), bench = settledValue(b);
  if (!asset?.length || !bench?.length) return res.json({ symbol, error: "Not enough price history." });
  const profile = analytics.riskProfile(asset, bench, settledValue(s));
  res.json({ symbol, benchmark: benchmarks.shortName(benchmark), benchmarkValue: benchmark, benchmarkLabel: benchmarks.label(benchmark), sector, sectorEtf, profile });
});

// Recent filings with any cached AI summaries attached.
router.get("/research/:symbol/filings", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase().trim();
  try {
    const filings = await sec.getRecentFilings(symbol);
    res.json({
      aiEnabled: claude.configured(),
      filings: filings.slice(0, 12).map((f) => ({ ...f, summary: claude.cachedSummary(f.accession) })),
    });
  } catch (e) {
    res.json({ aiEnabled: claude.configured(), filings: [], error: e.message });
  }
});

// Generating a summary costs API credits, so it's limited to people who can edit.
router.post("/research/:symbol/filings/:accession/summary", requireAuth, async (req, res) => {
  const symbol = req.params.symbol.toUpperCase().trim();
  if (!claude.configured()) return res.status(503).json({ error: "AI summaries need ANTHROPIC_API_KEY set on the server." });
  const filings = await sec.getRecentFilings(symbol);
  const filing = filings.find((f) => f.accession === req.params.accession);
  if (!filing) return res.status(404).json({ error: "Filing not found." });
  try {
    res.json(await claude.summarizeFiling(symbol, filing));
  } catch (e) {
    res.status(502).json({ error: `Summary failed: ${e.message}` });
  }
});

router.put("/research/:symbol/thesis", requireAuth, (req, res) => {
  const symbol = req.params.symbol.toUpperCase().trim();
  const { author, thesis, targetPrice, priceAtThesis } = req.body || {};
  const tp = targetPrice === "" || targetPrice === null || targetPrice === undefined ? null : Number(targetPrice);
  if (tp !== null && !(tp > 0)) return res.status(400).json({ error: "Target price must be a positive number." });
  const existing = db.prepare("SELECT * FROM research_notes WHERE symbol = ?").get(symbol);
  // Price at thesis is locked in when a target is first set, so calls can be graded later.
  const pat = existing?.priceAtThesis ?? (tp !== null && Number(priceAtThesis) > 0 ? Number(priceAtThesis) : null);
  db.prepare(`
    INSERT INTO research_notes (symbol, author, thesis, targetPrice, priceAtThesis, createdAt, updatedAt)
    VALUES (@symbol, @author, @thesis, @targetPrice, @priceAtThesis, datetime('now'), datetime('now'))
    ON CONFLICT(symbol) DO UPDATE SET
      author = excluded.author, thesis = excluded.thesis, targetPrice = excluded.targetPrice,
      priceAtThesis = excluded.priceAtThesis, updatedAt = datetime('now')
  `).run({ symbol, author: author || "", thesis: thesis || "", targetPrice: tp, priceAtThesis: pat });
  res.json(db.prepare("SELECT * FROM research_notes WHERE symbol = ?").get(symbol));
});

module.exports = router;
module.exports.redFlagsFor = redFlagsFor;
module.exports.filingDiffFor = filingDiffFor;
module.exports.activistFilingsFor = activistFilingsFor;
