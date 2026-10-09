const express = require("express");
const db = require("../db");
const { requireTrader } = require("../middleware/auth");
const { fundChanged } = require("../lib/events");

const router = express.Router();

router.get("/positions", (req, res) => {
  const rows = db.prepare("SELECT * FROM positions ORDER BY symbol ASC").all();
  res.json(rows);
});

router.post("/positions", requireTrader, (req, res) => {
  const { symbol, shares, lastPrice, avgCost, totalCost, marketValue, divIncome, notes } = req.body || {};
  if (!symbol || typeof shares !== "number" || !(shares > 0)) {
    return res.status(400).json({ error: "A ticker and a positive share count are required." });
  }
  try {
    const stmt = db.prepare(`
      INSERT INTO positions (symbol, shares, lastPrice, avgCost, totalCost, marketValue, divIncome, notes, updatedAt)
      VALUES (@symbol, @shares, @lastPrice, @avgCost, @totalCost, @marketValue, @divIncome, @notes, datetime('now'))
    `);
    const info = stmt.run({
      symbol: symbol.toUpperCase().trim(),
      shares,
      lastPrice: lastPrice || 0,
      avgCost: avgCost || 0,
      totalCost: totalCost || 0,
      marketValue: marketValue || 0,
      divIncome: divIncome || 0,
      notes: notes || "",
    });
    const row = db.prepare("SELECT * FROM positions WHERE id = ?").get(info.lastInsertRowid);
    fundChanged(req, "position.add", { symbol: row.symbol, shares: row.shares });
    res.status(201).json(row);
  } catch (e) {
    if (String(e).includes("UNIQUE")) {
      return res.status(409).json({ error: `Position ${symbol} already exists.` });
    }
    res.status(500).json({ error: "Could not add position." });
  }
});

router.put("/positions/:id", requireTrader, (req, res) => {
  const existing = db.prepare("SELECT * FROM positions WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Position not found." });

  const merged = { ...existing, ...req.body };
  if (typeof merged.shares !== "number" || !(merged.shares > 0)) {
    return res.status(400).json({ error: "Shares must be a positive number." });
  }
  db.prepare(`
    UPDATE positions SET
      symbol = @symbol, shares = @shares, lastPrice = @lastPrice, avgCost = @avgCost,
      totalCost = @totalCost, marketValue = @marketValue, divIncome = @divIncome,
      notes = @notes, updatedAt = datetime('now')
    WHERE id = @id
  `).run({ ...merged, symbol: String(merged.symbol).toUpperCase().trim(), id: req.params.id });

  const row = db.prepare("SELECT * FROM positions WHERE id = ?").get(req.params.id);
  fundChanged(req, "position.edit", { symbol: row.symbol, shares: row.shares, previousShares: existing.shares, fields: Object.keys(req.body || {}) });
  res.json(row);
});

router.delete("/positions/:id", requireTrader, (req, res) => {
  const existing = db.prepare("SELECT * FROM positions WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Position not found." });
  db.prepare("DELETE FROM positions WHERE id = ?").run(existing.id);
  fundChanged(req, "position.delete", { symbol: existing.symbol, shares: existing.shares });
  res.status(204).end();
});

module.exports = router;
