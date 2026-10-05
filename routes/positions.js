const express = require("express");
const db = require("../db");
const { requireAuth, EDIT_PASSWORD, safeEqual } = require("../middleware/auth");
const { loginLimiter } = require("../middleware/rateLimit");

const router = express.Router();

router.post("/login", loginLimiter("edit"), (req, res) => {
  const { password } = req.body || {};
  if (typeof password === "string" && safeEqual(password, EDIT_PASSWORD)) {
    req.loginSucceeded();
    return res.json({ ok: true });
  }
  req.loginFailed();
  res.status(401).json({ error: "Incorrect password." });
});

router.get("/positions", (req, res) => {
  const rows = db.prepare("SELECT * FROM positions ORDER BY symbol ASC").all();
  res.json(rows);
});

router.post("/positions", requireAuth, (req, res) => {
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
    res.status(201).json(db.prepare("SELECT * FROM positions WHERE id = ?").get(info.lastInsertRowid));
  } catch (e) {
    if (String(e).includes("UNIQUE")) {
      return res.status(409).json({ error: `Position ${symbol} already exists.` });
    }
    res.status(500).json({ error: "Could not add position." });
  }
});

router.put("/positions/:id", requireAuth, (req, res) => {
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

  res.json(db.prepare("SELECT * FROM positions WHERE id = ?").get(req.params.id));
});

router.delete("/positions/:id", requireAuth, (req, res) => {
  const info = db.prepare("DELETE FROM positions WHERE id = ?").run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Position not found." });
  res.status(204).end();
});

module.exports = router;
