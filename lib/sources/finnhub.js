const { cached } = require("../cache");
const { schedule } = require("../fetchWithLimit");

function apiKey() {
  return process.env.FINNHUB_API_KEY || "";
}

function requireKey() {
  if (!apiKey()) throw new Error("FINNHUB_API_KEY not configured");
}

// The free tier allows ~60 calls/minute; bursts (e.g. scoring 30+ holdings on a cold cache)
// get 429s. Back off and retry a few times rather than failing those symbols.
async function fetchJson(url, attempt = 0) {
  const res = await schedule(() => fetch(url));
  if (res.status === 429 && attempt < 4) {
    await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
    return fetchJson(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`Finnhub request failed: ${res.status}`);
  return res.json();
}

async function getCompanyNews(symbol, days = 14) {
  requireKey();
  return cached(`finnhub_news_${symbol}`, 30 * 60, "finnhub_news", async () => {
    const to = new Date();
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const fmt = (d) => d.toISOString().slice(0, 10);
    const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${fmt(from)}&to=${fmt(to)}&token=${apiKey()}`;
    const json = await fetchJson(url);
    return (Array.isArray(json) ? json : []).slice(0, 15).map((n) => ({
      headline: n.headline,
      source: n.source,
      url: n.url,
      datetime: n.datetime ? new Date(n.datetime * 1000).toISOString() : null,
      summary: n.summary,
      image: n.image || null,
    }));
  });
}

// Market-wide wire headlines (Reuters, CNBC, Bloomberg via Finnhub's free "general" feed).
async function getMarketNews(category = "general") {
  requireKey();
  return cached(`finnhub_market_news_${category}`, 15 * 60, "finnhub_news", async () => {
    const json = await fetchJson(`https://finnhub.io/api/v1/news?category=${encodeURIComponent(category)}&token=${apiKey()}`);
    return (Array.isArray(json) ? json : []).map((n) => ({
      headline: n.headline,
      source: n.source,
      url: n.url,
      datetime: n.datetime ? new Date(n.datetime * 1000).toISOString() : null,
      summary: n.summary,
      image: n.image || null,
    }));
  });
}

// Company logo URL (Finnhub profile2). Logos rarely change, so cache a month.
async function getLogo(symbol) {
  requireKey();
  return cached(`finnhub_logo_${symbol}`, 30 * 24 * 60 * 60, "finnhub_profile", async () => {
    const json = await fetchJson(`https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${apiKey()}`);
    return /^https:\/\//.test(json?.logo || "") ? json.logo : null;
  });
}

async function getInsiderTransactions(symbol) {
  requireKey();
  return cached(`finnhub_insider_${symbol}`, 6 * 60 * 60, "finnhub_insider", async () => {
    const url = `https://finnhub.io/api/v1/stock/insider-transactions?symbol=${encodeURIComponent(symbol)}&token=${apiKey()}`;
    const json = await fetchJson(url);
    return (json?.data || []).slice(0, 25).map((t) => ({
      name: t.name,
      share: t.share,
      change: t.change,
      transactionDate: t.transactionDate,
      transactionCode: t.transactionCode,
      transactionPrice: t.transactionPrice,
    }));
  });
}

// Full Form 4 history since 2018 (non-derivative and derivative rows), for classifying each
// insider's trading pattern. One call per symbol, cached 12h.
async function getInsiderHistory(symbol) {
  requireKey();
  return cached(`finnhub_insider_hist_${symbol}`, 12 * 60 * 60, "finnhub_insider", async () => {
    const to = new Date().toISOString().slice(0, 10);
    const url = `https://finnhub.io/api/v1/stock/insider-transactions?symbol=${encodeURIComponent(symbol)}&from=2018-01-01&to=${to}&token=${apiKey()}`;
    const json = await fetchJson(url);
    return (json?.data || [])
      .filter((t) => t.transactionCode === "P" || t.transactionCode === "S")
      .map((t) => ({
        name: t.name,
        share: t.share,
        change: t.change,
        transactionDate: t.transactionDate,
        filingDate: t.filingDate,
        transactionCode: t.transactionCode,
        transactionPrice: t.transactionPrice,
        isDerivative: !!t.isDerivative,
      }));
  });
}

async function getMetrics(symbol) {
  requireKey();
  return cached(`finnhub_metric_${symbol}`, 6 * 60 * 60, "finnhub_metric", async () => {
    const url = `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${apiKey()}`;
    const json = await fetchJson(url);
    const m = json?.metric || {};
    return {
      peTTM: m.peTTM ?? null,
      marketCap: m.marketCapitalization ?? null,
      revenueGrowthTTM: m["revenueGrowthTTMYoy"] ?? null,
      priceChange1Y: m["52WeekPriceReturnDaily"] ?? null,
    };
  });
}

// Full valuation/quality metric set for peer comparison tables. Shares the cache entry's
// TTL with getMetrics but keeps more fields.
async function getCompMetrics(symbol) {
  requireKey();
  return cached(`finnhub_comp_${symbol}`, 12 * 60 * 60, "finnhub_metric", async () => {
    const url = `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${apiKey()}`;
    const json = await fetchJson(url);
    const m = json?.metric || {};
    return {
      marketCap: m.marketCapitalization != null ? m.marketCapitalization * 1e6 : null,
      peTTM: m.peTTM ?? null,
      forwardPE: m.forwardPE ?? null,
      psTTM: m.psTTM ?? null,
      pb: m.pb ?? null,
      evEbitda: m.evEbitdaTTM ?? null,
      evRevenue: m.evRevenueTTM ?? null,
      pfcf: m.pfcfShareTTM ?? null,
      grossMargin: m.grossMarginTTM ?? null,
      operatingMargin: m.operatingMarginTTM ?? null,
      netMargin: m.netProfitMarginTTM ?? null,
      roe: m.roeTTM ?? null,
      revenueGrowth: m.revenueGrowthTTMYoy ?? null,
      epsGrowth: m.epsGrowthTTMYoy ?? null,
      dividendYield: m.currentDividendYieldTTM ?? null,
      beta: m.beta ?? null,
      return1Y: m["52WeekPriceReturnDaily"] ?? null,
    };
  });
}

// Upcoming earnings for specific symbols. Finnhub's all-market calendar caps at 1,500 rows
// (which truncates peak earnings season), so query per symbol and cache each for 12h.
async function getUpcomingEarnings(symbol, days = 60) {
  requireKey();
  return cached(`finnhub_earn_${symbol}`, 12 * 60 * 60, "finnhub_calendar", async () => {
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
    const url = `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&symbol=${encodeURIComponent(symbol)}&token=${apiKey()}`;
    const json = await fetchJson(url);
    return (json?.earningsCalendar || []).map((e) => ({
      symbol: e.symbol, date: e.date, hour: e.hour, epsEstimate: e.epsEstimate, revenueEstimate: e.revenueEstimate,
    }));
  });
}

async function getEarningsCalendar(symbols, from, to) {
  const results = await Promise.allSettled(symbols.map((s) => getUpcomingEarnings(s)));
  return results.flatMap((r) => (r.status === "fulfilled" ? r.value : []))
    .filter((e) => e.date >= from && e.date <= to);
}

module.exports = { getCompanyNews, getMarketNews, getLogo, getInsiderTransactions, getInsiderHistory, getMetrics, getCompMetrics, getEarningsCalendar, getUpcomingEarnings, apiKey };
