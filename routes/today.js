const express = require("express");
const today = require("../lib/today");
const { SLOTS } = require("../lib/marketNews");

const router = express.Router();

// Which editions exist for the last 4 weekdays, plus the requested one (or the latest).
// Read-only: never triggers a capture or an AI call.
router.get("/today/editions", async (req, res) => {
  const editions = today.listEditions();
  const { date, slot } = req.query;
  let edition = null;
  if (date || slot) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !SLOTS.some((s) => s.key === slot)) return res.status(400).json({ error: "Pass ?date=YYYY-MM-DD&slot=premarket|midday|postmarket" });
    if (!editions.some((d) => d.date === date)) return res.status(400).json({ error: "Editions are kept for today and the previous 3 weekdays." });
    edition = today.getEdition(date, slot);
  } else {
    edition = today.latestEdition();
  }
  res.json({
    editions,
    edition,
    liveHeadlines: edition || date ? null : await today.liveHeadlines(),
    aiEnabled: today.recapEnabled(),
  });
});

// Live market numbers, sectors, movers, Fed and this week's events (not stored).
router.get("/today/live", async (req, res) => {
  try {
    res.json(await today.liveSide());
  } catch (err) {
    res.status(502).json({ error: `Live market data unavailable: ${err.message}` });
  }
});

module.exports = router;
