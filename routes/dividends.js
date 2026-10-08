const express = require("express");
const { requireAuth, memberFromRequest } = require("../middleware/auth");
const dividends = require("../lib/dividends");

const router = express.Router();

// Projected income, upcoming dates and the log of dividends owed/received since tracking began.
// Logs any ex-dates that passed since the last scheduler run first, so the page is never stale.
router.get("/dividends", async (req, res) => {
  try {
    await dividends.syncDividends();
    res.json(await dividends.overview());
  } catch (err) {
    res.status(502).json({ error: `Dividend data unavailable: ${err.message}` });
  }
});

const key = (b) => ({ symbol: String(b?.symbol || "").toUpperCase().trim(), exDate: /^\d{4}-\d{2}-\d{2}$/.test(b?.exDate || "") ? b.exDate : null });

// Confirm a logged dividend was paid (records a dividend transaction, crediting cash).
router.post("/dividends/received", requireAuth, (req, res) => {
  const { symbol, exDate } = key(req.body);
  if (!symbol || !exDate) return res.status(400).json({ error: "Pass symbol and exDate (YYYY-MM-DD)." });
  const amount = req.body.amount === undefined || req.body.amount === "" ? undefined : Number(req.body.amount);
  if (amount !== undefined && !(amount > 0)) return res.status(400).json({ error: "Amount must be a positive number." });
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.body.date || "") ? req.body.date : undefined;
  try {
    res.status(201).json(dividends.markReceived({ symbol, exDate, amount, date, createdBy: memberFromRequest(req)?.name || "" }));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Mark a logged dividend as not owed (e.g. shares sold before the ex-date), or undo that.
router.post("/dividends/skip", requireAuth, (req, res) => {
  const { symbol, exDate } = key(req.body);
  if (!symbol || !exDate) return res.status(400).json({ error: "Pass symbol and exDate (YYYY-MM-DD)." });
  try {
    dividends.setSkipped({ symbol, exDate, skipped: req.body.skipped !== false });
    res.status(204).end();
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
