const express = require("express");
const db = require("../db");
const finnhub = require("../lib/sources/finnhub");
const { scoreInsiders } = require("../lib/insiderSignals");

const router = express.Router();

// Insider signal for one ticker (classified history + score + reasons).
router.get("/insiders/:symbol/signal", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase().trim();
  try {
    const rows = await finnhub.getInsiderHistory(symbol);
    res.json({ symbol, ...scoreInsiders(rows) });
  } catch (err) {
    res.json({ symbol, error: err.message });
  }
});

// Insider signals ranked across holdings and/or the watchlist.
router.get("/insider-signals", async (req, res) => {
  const scope = ["holdings", "watchlist", "all"].includes(req.query.scope) ? req.query.scope : "all";
  const owned = db.prepare("SELECT symbol FROM positions").all().map((r) => r.symbol);
  const watched = db.prepare("SELECT symbol FROM watchlist").all().map((r) => r.symbol);
  const symbols = [...new Set([...(scope !== "watchlist" ? owned : []), ...(scope !== "holdings" ? watched : [])])];
  if (!finnhub.apiKey()) return res.json({ scope, rows: [], error: "FINNHUB_API_KEY not configured" });
  const results = await Promise.allSettled(symbols.map(async (s) => ({ symbol: s, ...scoreInsiders(await finnhub.getInsiderHistory(s)) })));
  const rows = results.map((r, i) => (r.status === "fulfilled"
    ? (({ symbol, score, label, cluster, counts, reasons }) => ({ symbol, score, label, cluster, counts, topReason: reasons[0], owned: owned.includes(symbol) }))(r.value)
    : { symbol: symbols[i], error: r.reason?.message || String(r.reason), owned: owned.includes(symbols[i]) }));
  rows.sort((a, b) => (b.score ?? -999) - (a.score ?? -999));
  res.json({ scope, rows });
});

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
  // Only open-market purchases (P) and sales (S) are discretionary signals; option
  // exercises (M), grants (A), tax withholding (F) etc. would swamp the net figure.
  let netShares = 0;
  let netValue = 0;
  let buys = 0;
  let sells = 0;
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
      if (t.transactionCode === "P" || t.transactionCode === "S") {
        netShares += t.change || 0;
        netValue += (t.change || 0) * (t.transactionPrice || 0);
        if (t.transactionCode === "P") buys++;
        else sells++;
      }
      recent.push({ symbol, ...t });
    }
  });

  recent.sort((a, b) => new Date(b.transactionDate) - new Date(a.transactionDate));

  res.json({
    holdingsCount: holdings.length,
    netShares,
    netValue,
    buys,
    sells,
    bySymbol,
    recent: recent.slice(0, 100),
  });
});

module.exports = router;
