const express = require("express");
const db = require("../db");
const yahoo = require("../lib/sources/yahoo");
const usaspending = require("../lib/sources/usaspending");
const { isGovRelevant, recipientSearchText, summarizeAwards } = require("../lib/govContracts");

const router = express.Router();
const raw = (v) => (v && typeof v === "object" ? ("raw" in v && typeof v.raw !== "object" ? v.raw : null) : v ?? null);

async function govContractsFor(symbol, days = 90) {
  const qs = await yahoo.getQuoteSummary(symbol);
  const name = qs.price?.longName || qs.price?.shortName || null;
  const sector = qs.assetProfile?.sector || "";
  const industry = qs.assetProfile?.industry || "";
  const searchText = name ? recipientSearchText(name) : null;
  const relevant = isGovRelevant(sector, industry);
  if (!searchText) return { symbol, name, relevant, available: false, reason: "No company name to search for." };
  const rows = await usaspending.getRecentContracts(searchText, days);
  return {
    symbol, name, sector, industry, relevant, available: true, days, searchText,
    ...summarizeAwards(rows, { annualRevenue: raw(qs.financialData?.totalRevenue) }),
  };
}

router.get("/research/:symbol/gov-contracts", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase().trim();
  try {
    res.json(await govContractsFor(symbol));
  } catch (err) {
    res.json({ symbol, available: false, error: err.message });
  }
});

// Holdings in defense, health and IT, ranked by recent award dollars.
router.get("/gov-contracts", async (req, res) => {
  const symbols = db.prepare("SELECT symbol FROM positions").all().map((r) => r.symbol);
  const results = await Promise.allSettled(symbols.map((s) => govContractsFor(s)));
  const rows = results
    .filter((r) => r.status === "fulfilled" && r.value.available && (r.value.relevant || r.value.count))
    .map((r) => (({ symbol, name, count, total, pctOfRevenue, top }) => ({ symbol, name, count, total, pctOfRevenue, largest: top[0] || null }))(r.value))
    .sort((a, b) => b.total - a.total);
  res.json({ rows });
});

module.exports = router;
module.exports.govContractsFor = govContractsFor;
