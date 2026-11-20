// Signal matrix (WS10): GET /api/signal-matrix?scope=holdings|watchlist|all. Holdings × signals
// built from the existing per-signal functions (each cached), the whole result cached for
// 20 minutes so the page and the dashboard widget don't fan out on every load.
const express = require("express");
const db = require("../db");
const yahoo = require("../lib/sources/yahoo");
const sec = require("../lib/sources/sec");
const finnhub = require("../lib/sources/finnhub");
const { cached } = require("../lib/cache");
const { scoreInsiders } = require("../lib/insiderSignals");
const { peHistory } = require("../lib/valuationHistory");
const { buildMatrix, topMovers } = require("../lib/signalMatrix");

const router = express.Router();
const settle = async (fn) => { try { return await fn(); } catch { return null; } };
const hasTable = (name) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);

// Run `fn` over items with at most `n` in flight (Yahoo and SEC both rate-limit bursts).
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

function universe(scope) {
  const positions = db.prepare("SELECT symbol, shares FROM positions").all();
  const owned = positions.map((p) => p.symbol);
  const watched = db.prepare("SELECT symbol FROM watchlist").all().map((r) => r.symbol);
  const symbols = [...new Set([...(scope !== "watchlist" ? owned : []), ...(scope !== "holdings" ? watched : [])])];
  return { symbols, owned: new Set(owned) };
}

function thesisFor(symbol) {
  const note = db.prepare("SELECT thesisStatus FROM research_notes WHERE symbol = ?").get(symbol);
  let pillars = [];
  if (hasTable("thesis_pillars")) pillars = db.prepare("SELECT status FROM thesis_pillars WHERE symbol = ? AND retiredAt IS NULL").all(symbol);
  if (!note && !pillars.length) return null;
  return { status: note?.thesisStatus || null, pillars };
}

async function inputsFor(symbol, owned) {
  const r = { short: require("./shortPressure").shortPressureFor, revision: require("./estimateRevisions").revisionScoreFor, crowding: require("./crowding").crowdingFor };
  const [bars, revision, insider, short, crowding, pe] = await Promise.all([
    settle(() => yahoo.getChart(symbol, "1y", "1d")),
    settle(() => r.revision(symbol)),
    settle(async () => (finnhub.apiKey() ? scoreInsiders(await finnhub.getInsiderHistory(symbol)) : null)),
    settle(() => r.short(symbol)),
    settle(() => r.crowding(symbol)),
    settle(async () => {
      const [facts, weekly] = await Promise.all([sec.getCompanyFacts(symbol), yahoo.getChart(symbol, "5y", "1wk")]);
      const h = facts?.eps?.length ? peHistory(facts.eps, weekly) : null;
      return h?.summary ? { percentile: h.summary.percentile, current: h.summary.current, median: h.summary.median } : { reason: facts ? "Not enough positive earnings for a P/E history" : "No SEC earnings (ETF or foreign filer)" };
    }),
  ]);
  return { symbol, owned, closes: (bars || []).map((b) => b.close), revision, insider, short, crowding, pe, thesis: thesisFor(symbol) };
}

async function signalMatrix(scope = "holdings") {
  const { symbols, owned } = universe(scope);
  const key = `signal_matrix_v1_${scope}_${symbols.slice().sort().join(",")}`;
  return cached(key, 20 * 60, "signal_matrix", async () => {
    const inputs = await pool(symbols, 4, (s) => inputsFor(s, owned.has(s)));
    const m = buildMatrix(inputs);
    return { scope, asOf: new Date().toISOString(), ...m, movers: topMovers(m.rows) };
  });
}

router.get("/signal-matrix", async (req, res) => {
  const scope = ["holdings", "watchlist", "all"].includes(req.query.scope) ? req.query.scope : "holdings";
  res.json(await signalMatrix(scope));
});

module.exports = router;
module.exports.autoMount = true; // WS1 auto-mount (server.js mounts routes/*.js with this flag)
module.exports.signalMatrix = signalMatrix;
