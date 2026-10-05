const { cached, getCached, setCached } = require("../cache");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function fetchJson(url, extraHeaders = {}) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json", ...extraHeaders } });
  if (!res.ok) throw new Error(`Yahoo request failed: ${res.status} ${url}`);
  return res.json();
}

// Yahoo's quoteSummary endpoint requires a session cookie + "crumb" token (undocumented,
// matches the handshake the yfinance Python library uses). Cached for an hour so we don't
// renegotiate on every request.
async function getCrumb() {
  const hit = getCached("yahoo_crumb_session");
  if (hit) return hit;

  const cookieRes = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": UA }, redirect: "manual" });
  const setCookies = typeof cookieRes.headers.getSetCookie === "function" ? cookieRes.headers.getSetCookie() : [];
  const cookieHeader = setCookies.map((c) => c.split(";")[0]).join("; ");
  if (!cookieHeader) throw new Error("Could not obtain Yahoo session cookie");

  const crumbRes = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": UA, Cookie: cookieHeader },
  });
  if (!crumbRes.ok) throw new Error(`Could not obtain Yahoo crumb: ${crumbRes.status}`);
  const crumb = await crumbRes.text();
  if (!crumb || crumb.includes("<html")) throw new Error("Yahoo crumb response was invalid");

  const session = { crumb, cookieHeader };
  setCached("yahoo_crumb_session", session, 55 * 60, "yahoo_crumb");
  return session;
}

async function getChart(symbol, range = "1y", interval = "1d") {
  return cached(`yahoo_chart_${symbol}_${range}_${interval}`, 15 * 60, "yahoo_chart", async () => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
    const json = await fetchJson(url);
    const result = json?.chart?.result?.[0];
    if (!result) throw new Error("No chart data");
    const timestamps = result.timestamp || [];
    const quote = result.indicators?.quote?.[0] || {};
    return timestamps.map((t, i) => ({
      date: new Date(t * 1000).toISOString().slice(0, 10),
      close: quote.close?.[i] ?? null,
      volume: quote.volume?.[i] ?? null,
    })).filter((p) => p.close !== null);
  });
}

async function getQuoteSummary(symbol) {
  const modules = [
    "assetProfile", "summaryDetail", "defaultKeyStatistics", "financialData", "earnings", "recommendationTrend", "price",
    // Street view: estimates & revisions, next earnings date, beat/miss history, rating changes, ownership.
    "earningsTrend", "calendarEvents", "earningsHistory", "upgradeDowngradeHistory", "institutionOwnership", "majorHoldersBreakdown",
  ].join(",");
  return cached(`yahoo_quotesummary_v2_${symbol}`, 6 * 60 * 60, "yahoo_quotesummary", async () => {
    const { crumb, cookieHeader } = await getCrumb();
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}&crumb=${encodeURIComponent(crumb)}`;
    const json = await fetchJson(url, { Cookie: cookieHeader });
    const result = json?.quoteSummary?.result?.[0];
    if (!result) throw new Error("No quoteSummary data");
    return result;
  });
}

async function getPeers(symbol) {
  return cached(`yahoo_peers_${symbol}`, 24 * 60 * 60, "yahoo_recommendations", async () => {
    const url = `https://query1.finance.yahoo.com/v6/finance/recommendationsbysymbol/${encodeURIComponent(symbol)}`;
    const json = await fetchJson(url);
    const recs = json?.finance?.result?.[0]?.recommendedSymbols || [];
    return recs.map((r) => r.symbol);
  });
}

// ---- Live quotes ----
// Near-real-time quotes for many symbols in one call. Cached in memory (not the database) so
// intraday refreshes don't turn into database writes: 60 seconds while US markets are trading
// or in extended hours, 10 minutes when they're closed.
const quoteCache = new Map(); // symbol -> { at, ttl, quote }
const LIVE_STATES = new Set(["REGULAR", "PRE", "POST"]);

async function getQuotes(symbols) {
  const wanted = [...new Set(symbols.map((s) => String(s).toUpperCase()).filter(Boolean))];
  const now = Date.now();
  const out = {};
  const missing = [];
  for (const sym of wanted) {
    const hit = quoteCache.get(sym);
    if (hit && now - hit.at < hit.ttl) out[sym] = hit.quote;
    else missing.push(sym);
  }
  for (let i = 0; i < missing.length; i += 50) {
    const chunk = missing.slice(i, i + 50);
    const { crumb, cookieHeader } = await getCrumb();
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${chunk.map(encodeURIComponent).join(",")}&crumb=${encodeURIComponent(crumb)}`;
    const json = await fetchJson(url, { Cookie: cookieHeader });
    for (const q of json?.quoteResponse?.result || []) {
      if (typeof q.regularMarketPrice !== "number") continue;
      const quote = {
        symbol: q.symbol,
        price: q.regularMarketPrice,
        change: q.regularMarketChange ?? null,
        changePct: q.regularMarketChangePercent ?? null,
        previousClose: q.regularMarketPreviousClose ?? null,
        time: q.regularMarketTime ? new Date(q.regularMarketTime * 1000).toISOString() : null,
        marketState: q.marketState || null,
        // Extended-hours price when trading before/after the regular session.
        extPrice: q.marketState === "PRE" ? q.preMarketPrice ?? null : q.marketState === "POST" ? q.postMarketPrice ?? null : null,
        name: q.longName || q.shortName || null,
      };
      quoteCache.set(q.symbol, { at: now, ttl: LIVE_STATES.has(quote.marketState) ? 60 * 1000 : 10 * 60 * 1000, quote });
      out[q.symbol] = quote;
    }
  }
  return out;
}

// S&P 500 sector weights from SPY's holdings breakdown, for allocation-vs-benchmark views.
async function getBenchmarkSectorWeights(etf = "SPY") {
  return cached(`yahoo_sector_weights_${etf}`, 7 * 24 * 60 * 60, "yahoo_quotesummary", async () => {
    const { crumb, cookieHeader } = await getCrumb();
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(etf)}?modules=topHoldings&crumb=${encodeURIComponent(crumb)}`;
    const json = await fetchJson(url, { Cookie: cookieHeader });
    const rows = json?.quoteSummary?.result?.[0]?.topHoldings?.sectorWeightings || [];
    const out = {};
    for (const row of rows) for (const [k, v] of Object.entries(row)) out[k] = v.raw;
    return out;
  });
}

// Just the sector/industry for a ticker (long-lived cache; used for allocation views).
async function getSector(symbol) {
  return cached(`yahoo_sector_${symbol}`, 30 * 24 * 60 * 60, "yahoo_quotesummary", async () => {
    const qs = await getQuoteSummary(symbol);
    return {
      sector: qs.assetProfile?.sector || (qs.price?.quoteType === "ETF" ? "ETF / Fund" : ""),
      industry: qs.assetProfile?.industry || "",
      name: qs.price?.longName || qs.price?.shortName || "",
    };
  });
}

module.exports = { getChart, getQuoteSummary, getPeers, getBenchmarkSectorWeights, getSector, getQuotes };
