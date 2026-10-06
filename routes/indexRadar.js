const express = require("express");
const db = require("../db");
const yahoo = require("../lib/sources/yahoo");
const sec = require("../lib/sources/sec");
const { russellReconstitutionDate, sp500EligibilityCheck } = require("../lib/indexRadar");

const router = express.Router();
const raw = (v) => (v && typeof v === "object" ? ("raw" in v && typeof v.raw !== "object" ? v.raw : null) : v ?? null);

async function screenFor(symbol) {
  const [qs, facts] = await Promise.all([yahoo.getQuoteSummary(symbol), sec.getCompanyFacts(symbol)]);
  const marketCap = raw(qs.summaryDetail?.marketCap) ?? raw(qs.price?.marketCap);
  const floatShares = raw(qs.defaultKeyStatistics?.floatShares);
  const sharesOutstanding = raw(qs.defaultKeyStatistics?.sharesOutstanding);
  const publicFloatPct = floatShares && sharesOutstanding ? floatShares / sharesOutstanding : null;
  const quarterlyNetIncome = (facts?.netIncome || []).filter((p) => p.form === "10-Q").slice(-4);
  const latestQuarterEarnings = quarterlyNetIncome.at(-1)?.val ?? null;
  const trailingQuarterEarnings = quarterlyNetIncome.map((p) => p.val);
  const result = sp500EligibilityCheck({ marketCap, trailingQuarterEarnings, latestQuarterEarnings, publicFloatPct });
  return { symbol, marketCap, publicFloatPct, latestQuarterEarnings, ...result };
}

router.get("/index-radar", async (req, res) => {
  // S&P addition candidates come from the watchlist and non-S&P-sized holdings; screening
  // actual S&P 500 members is pointless, so this covers everything the fund tracks.
  const owned = db.prepare("SELECT symbol FROM positions").all().map((r) => r.symbol);
  const watched = db.prepare("SELECT symbol FROM watchlist").all().map((r) => r.symbol);
  const symbols = [...new Set([...owned, ...watched])];
  const results = await Promise.allSettled(symbols.map(screenFor));
  const rows = results.map((r, i) => (r.status === "fulfilled" ? r.value : { symbol: symbols[i], error: r.reason?.message || String(r.reason) }));
  rows.sort((a, b) => (b.eligible === a.eligible ? (b.marketCap || 0) - (a.marketCap || 0) : b.eligible ? 1 : -1));

  const thisYear = new Date().getUTCFullYear();
  const reconDates = [thisYear, thisYear + 1]
    .map((y) => russellReconstitutionDate(y))
    .filter((d) => d >= new Date().toISOString().slice(0, 10));

  res.json({ rows, russellReconstitution: reconDates });
});

module.exports = router;
