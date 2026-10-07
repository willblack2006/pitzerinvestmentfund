const db = require("../db");
const fred = require("./sources/fred");
const yahoo = require("./sources/yahoo");
const portfolio = require("./portfolio");
const signals = require("./signals");

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
  };

  tick(); // warm on boot
  setInterval(tick, TICK_MS);
  console.log(`[scheduler] started (tick every ${TICK_MS / 60000}min, AUTO_REFRESH_PRICES=${autoRefreshPrices})`);
}

module.exports = { start };
