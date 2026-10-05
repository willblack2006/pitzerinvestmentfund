const express = require("express");
const db = require("../db");
const finnhub = require("../lib/sources/finnhub");

const router = express.Router();

router.get("/insiders/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase().trim();
  try {
    const transactions = await finnhub.getInsiderTransactions(symbol);
    res.json({ symbol, transactions });
  } catch (err) {
    res.status(200).json({ symbol, transactions: [], error: err.message });
  }
});

router.get("/insiders", async (req, res) => {
  const holdings = db.prepare("SELECT symbol FROM positions ORDER BY symbol ASC").all();
  const results = await Promise.allSettled(
    holdings.map(async (h) => ({ symbol: h.symbol, transactions: await finnhub.getInsiderTransactions(h.symbol) }))
  );

  const bySymbol = {};
  let netShares = 0;
  let netValue = 0;
  const recent = [];

  results.forEach((r, i) => {
    const symbol = holdings[i].symbol;
    if (r.status !== "fulfilled") {
      bySymbol[symbol] = { error: r.reason?.message || String(r.reason) };
      return;
    }
    const transactions = r.value.transactions;
    bySymbol[symbol] = { count: transactions.length };
    for (const t of transactions) {
      netShares += t.change || 0;
      netValue += (t.change || 0) * (t.transactionPrice || 0);
      recent.push({ symbol, ...t });
    }
  });

  recent.sort((a, b) => new Date(b.transactionDate) - new Date(a.transactionDate));

  res.json({
    netShares,
    netValue,
    bySymbol,
    recent: recent.slice(0, 40),
  });
});

module.exports = router;
