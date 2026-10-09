const express = require("express");
const db = require("../db");
const { requireSignedIn } = require("../middleware/auth");

const router = express.Router();

router.get("/watchlist", (req, res) => {
  res.json(db.prepare("SELECT * FROM watchlist ORDER BY addedAt DESC").all());
});

router.post("/watchlist", requireSignedIn, (req, res) => {
  const { symbol, note, sourcedFrom } = req.body || {};
  if (!symbol) return res.status(400).json({ error: "symbol is required." });
  try {
    const info = db.prepare(`
      INSERT INTO watchlist (symbol, note, sourcedFrom, addedAt)
      VALUES (@symbol, @note, @sourcedFrom, datetime('now'))
    `).run({
      symbol: symbol.toUpperCase().trim(),
      note: note || "",
      sourcedFrom: sourcedFrom || "",
    });
    res.status(201).json(db.prepare("SELECT * FROM watchlist WHERE id = ?").get(info.lastInsertRowid));
  } catch (e) {
    if (String(e).includes("UNIQUE")) {
      return res.status(409).json({ error: `${symbol} is already on the watchlist.` });
    }
    res.status(500).json({ error: "Could not add to watchlist." });
  }
});

router.delete("/watchlist/:id", requireSignedIn, (req, res) => {
  const info = db.prepare("DELETE FROM watchlist WHERE id = ?").run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Not found." });
  res.status(204).end();
});

module.exports = router;
