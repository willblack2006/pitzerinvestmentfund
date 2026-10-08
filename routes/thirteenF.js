const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const thirteenF = require("../lib/sources/thirteenF");
const yahoo = require("../lib/sources/yahoo");
const { computeWeights, topConviction, matchOverlaps, qoqChanges } = require("../lib/thirteenF");

const router = express.Router();

router.get("/13f/managers", (req, res) => {
  res.json(db.prepare("SELECT * FROM thirteenf_managers ORDER BY name").all());
});

// Look up 13F filers by name, so members don't need to find a CIK by hand.
router.get("/13f/search", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 2 || q.length > 80) return res.status(400).json({ error: "Type at least 2 characters of the manager's name." });
  try {
    res.json({ results: (await thirteenF.searchManagers(q)).slice(0, 12) });
  } catch (err) {
    res.status(502).json({ error: `EDGAR search failed: ${err.message}` });
  }
});

router.post("/13f/managers", requireAuth, (req, res) => {
  const cik = String(req.body?.cik || "").replace(/\D/g, "").padStart(10, "0");
  const name = String(req.body?.name || "").trim();
  if (!/^\d{10}$/.test(cik)) return res.status(400).json({ error: "CIK must be numeric (the fund's EDGAR CIK, e.g. 0001067983 for Berkshire)." });
  const count = db.prepare("SELECT COUNT(*) AS c FROM thirteenf_managers").get().c;
  if (count >= 20) return res.status(400).json({ error: "Limit of 20 managers; remove one first." });
  db.prepare("INSERT OR IGNORE INTO thirteenf_managers (cik, name) VALUES (?, ?)").run(cik, name);
  res.status(201).json(db.prepare("SELECT * FROM thirteenf_managers WHERE cik = ?").get(cik));
});

router.delete("/13f/managers/:cik", requireAuth, (req, res) => {
  db.prepare("DELETE FROM thirteenf_managers WHERE cik = ?").run(req.params.cik);
  res.status(204).end();
});

// Our own universe's company names, for matching 13F issuer names to tickers (a free
// substitute for CUSIP-to-ticker resolution).
async function universeWithNames() {
  const owned = db.prepare("SELECT symbol FROM positions").all().map((r) => r.symbol);
  const watched = db.prepare("SELECT symbol FROM watchlist").all().map((r) => r.symbol);
  const symbols = [...new Set([...owned, ...watched])];
  const results = await Promise.allSettled(symbols.map(async (s) => ({ symbol: s, name: (await yahoo.getQuoteSummary(s)).price?.longName || null })));
  return { universe: results.map((r, i) => (r.status === "fulfilled" ? r.value : { symbol: symbols[i], name: null })), owned, watched };
}

router.get("/13f/:cik", async (req, res) => {
  const cik = req.params.cik.replace(/\D/g, "").padStart(10, "0");
  try {
    const data = await thirteenF.getHoldings(cik);
    if (!data.filings.length) return res.json({ cik, companyName: data.companyName, available: false, reason: "No 13F-HR filings found for this CIK." });
    const { universe, owned, watched } = await universeWithNames();
    const conviction = topConviction(data.current, 15);
    const overlaps = matchOverlaps(computeWeights(data.current), universe).map((h) => ({ ...h, owned: owned.includes(h.matchedSymbol), watching: watched.includes(h.matchedSymbol) }));
    const changes = data.prior.length ? qoqChanges(data.current, data.prior) : null;
    res.json({
      cik, companyName: data.companyName, available: true,
      filings: data.filings, conviction, overlaps,
      changes: changes ? changes.filter((c) => c.isNew || Math.abs(c.weightChangePct || 0) >= 0.005).slice(0, 25) : null,
    });
  } catch (err) {
    res.json({ cik, available: false, error: err.message });
  }
});

module.exports = router;
