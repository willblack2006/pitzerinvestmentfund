const { cached } = require("../cache");
const { schedule } = require("../fetchWithLimit");

function apiKey() {
  return process.env.FINNHUB_API_KEY || "";
}

function requireKey() {
  if (!apiKey()) throw new Error("FINNHUB_API_KEY not configured");
}

async function fetchJson(url) {
  return schedule(async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Finnhub request failed: ${res.status} ${url}`);
    return res.json();
  });
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
    }));
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

module.exports = { getCompanyNews, getInsiderTransactions, getMetrics, apiKey };
