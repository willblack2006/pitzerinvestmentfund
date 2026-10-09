const db = require("../db");
const fred = require("./sources/fred");
const yahoo = require("./sources/yahoo");
const portfolio = require("./portfolio");
const signals = require("./signals");
const house = require("./sources/houseDisclosures");
const today = require("./today");
const dividends = require("./dividends");
const memberAlerts = require("./memberAlerts");
const paperSeason = require("./paperSeason");

const DAY_MS = 24 * 60 * 60 * 1000;
const TICK_MS = 15 * 60 * 1000;

let lastMacroWarm = 0;
let snapshotRunning = false;

// Refresh today's valuation snapshot (idempotent per market date) — feeds time-weighted returns.
async function maybeSnapshot() {
  if (snapshotRunning) return;
  snapshotRunning = true;
  try {
    const r = await portfolio.snapshot();
    console.log(`[scheduler] valuation snapshot saved for ${r.date}`);
  } catch (err) {
    console.error("[scheduler] snapshot failed:", err.message);
  } finally {
    snapshotRunning = false;
  }
}

async function warmMacro() {
  try {
    await fred.getAllSeries();
    lastMacroWarm = Date.now();
    console.log("[scheduler] macro series pre-warmed");
  } catch (err) {
    console.error("[scheduler] macro pre-warm failed:", err.message);
  }
}

async function refreshPrices() {
  const positions = db.prepare("SELECT id, symbol FROM positions").all();
  const update = db.prepare("UPDATE positions SET lastPrice = ?, marketValue = ?, updatedAt = datetime('now') WHERE id = ?");
  for (const p of positions) {
    try {
      const chart = await yahoo.getChart(p.symbol, "5d", "1d");
      const last = chart[chart.length - 1];
      if (!last) continue;
      const row = db.prepare("SELECT shares FROM positions WHERE id = ?").get(p.id);
      update.run(last.close, last.close * row.shares, p.id);
    } catch (err) {
      console.error(`[scheduler] price refresh failed for ${p.symbol}:`, err.message);
    }
  }
  console.log("[scheduler] price refresh pass complete");
}

function start() {
  const autoRefreshPrices = process.env.AUTO_REFRESH_PRICES === "true";

  const tick = async () => {
    if (Date.now() - lastMacroWarm > DAY_MS) await warmMacro();
    if (autoRefreshPrices) await refreshPrices();
    await maybeSnapshot();
    try {
      const r = await signals.refreshSignals();
      if (r.refreshed) console.log(`[scheduler] refreshed signals for ${r.refreshed} symbols (${r.remaining} left)`);
    } catch (err) {
      console.error("[scheduler] signal refresh failed:", err.message);
    }
    // Dividends: log any holding's ex-date that has passed (cheap; data cached 12h).
    try { const d = await dividends.syncDividends(); if (d.added) console.log(`[scheduler] logged ${d.added} dividend(s) owed`); } catch (err) { console.error("[scheduler] dividend sync failed:", err.message); }
    // Today page: premarket / midday / postmarket news editions (and AI recap if a key is set).
    try { await today.maybeCapture(); } catch (err) { console.error("[scheduler] news edition failed:", err.message); }
    // House trade reports: each PDF is parsed once and cached, so this keeps the Congress
    // trades page from downloading dozens of PDFs on its first visit.
    try { await house.getRecentPtrs(60); } catch (err) { console.error("[scheduler] House disclosures failed:", err.message); }
  };

  tick(); // warm on boot
  setInterval(tick, TICK_MS);
  // Personal price alerts and paper orders waiting for the open: every 5 minutes (quotes are
  // cached 60s while the market is open, so this is a handful of Yahoo calls).
  const quick = async () => {
    try { const r = await memberAlerts.checkAlerts(); if (r.fired) console.log(`[scheduler] ${r.fired} price alert(s) fired`); } catch (err) { console.error("[scheduler] price alerts failed:", err.message); }
    try { const r = await paperSeason.fillPending(); if (r.filled || r.cancelled) console.log(`[scheduler] paper orders: ${r.filled} filled, ${r.cancelled} cancelled`); } catch (err) { console.error("[scheduler] paper fills failed:", err.message); }
  };
  quick();
  setInterval(quick, 5 * 60 * 1000);
  console.log(`[scheduler] started (tick every ${TICK_MS / 60000}min, AUTO_REFRESH_PRICES=${autoRefreshPrices})`);
}

module.exports = { start };
