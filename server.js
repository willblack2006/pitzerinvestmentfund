const express = require("express");
const db = require("./db");

const EDIT_PASSWORD = process.env.EDIT_PASSWORD || "pitzerfund";
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use(express.static("public"));

function requireAuth(req, res, next) {
  const supplied = req.get("x-edit-password") || "";
  if (supplied !== EDIT_PASSWORD) {
    return res.status(401).json({ error: "Invalid or missing edit password." });
  }
  next();
}

app.post("/api/login", (req, res) => {
  const { password } = req.body || {};
  if (password === EDIT_PASSWORD) return res.json({ ok: true });
  res.status(401).json({ error: "Incorrect password." });
});

app.get("/api/positions", (req, res) => {
  const rows = db.prepare("SELECT * FROM positions ORDER BY symbol ASC").all();
  res.json(rows);
});

app.post("/api/positions", requireAuth, (req, res) => {
  const { symbol, shares, lastPrice, avgCost, totalCost, marketValue, divIncome, notes } = req.body || {};
  if (!symbol || typeof shares !== "number") {
    return res.status(400).json({ error: "symbol and shares are required." });
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

app.put("/api/positions/:id", requireAuth, (req, res) => {
  const existing = db.prepare("SELECT * FROM positions WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Position not found." });

  const merged = { ...existing, ...req.body };
  db.prepare(`
    UPDATE positions SET
      symbol = @symbol, shares = @shares, lastPrice = @lastPrice, avgCost = @avgCost,
      totalCost = @totalCost, marketValue = @marketValue, divIncome = @divIncome,
      notes = @notes, updatedAt = datetime('now')
    WHERE id = @id
  `).run({ ...merged, symbol: String(merged.symbol).toUpperCase().trim(), id: req.params.id });

  res.json(db.prepare("SELECT * FROM positions WHERE id = ?").get(req.params.id));
});

app.delete("/api/positions/:id", requireAuth, (req, res) => {
  const info = db.prepare("DELETE FROM positions WHERE id = ?").run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Position not found." });
  res.status(204).end();
});

app.listen(PORT, () => console.log(`PIF tracker running on http://localhost:${PORT}`));
