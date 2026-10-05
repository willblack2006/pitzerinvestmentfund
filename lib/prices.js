const yahoo = require("./sources/yahoo");

// Latest close for each symbol (Yahoo 5-day chart, cached 15 min per symbol). Runs a few at a
// time so a 30+ name portfolio doesn't fire every request at once.
async function latestPrices(symbols, concurrency = 6) {
  const out = {};
  // Live quotes first (one batched call); fall back to daily charts for anything missing.
  try {
    const quotes = await yahoo.getQuotes(symbols);
    for (const [sym, q] of Object.entries(quotes)) {
      out[sym] = { price: q.price, date: (q.time || new Date().toISOString()).slice(0, 10), change: q.changePct != null ? q.changePct / 100 : null };
    }
  } catch { /* fall through to charts */ }
  const queue = [...new Set(symbols)].filter((s) => !out[s]);
  async function worker() {
    while (queue.length) {
      const s = queue.shift();
      try {
        const chart = await yahoo.getChart(s, "5d", "1d");
        const last = chart.at(-1), prev = chart.at(-2);
        if (last) out[s] = { price: last.close, date: last.date, change: prev ? last.close / prev.close - 1 : null };
      } catch { /* leave missing */ }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return out;
}

// Daily closes for many symbols (1y by default), same concurrency rules.
async function histories(symbols, range = "1y", concurrency = 6) {
  const out = {};
  const queue = [...new Set(symbols)];
  async function worker() {
    while (queue.length) {
      const s = queue.shift();
      try { out[s] = await yahoo.getChart(s, range, "1d"); } catch { /* skip */ }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return out;
}

module.exports = { latestPrices, histories };
