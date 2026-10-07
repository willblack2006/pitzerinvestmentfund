// FINRA daily consolidated short-sale volume (Reg SHO), used for the short-volume-ratio trend.
// Note for the UI: this "short volume" is mostly market-maker/arbitrage order flow required to
// mark trades short, not bearish bets — see the explainer shown alongside it.
const { cached } = require("../cache");

function dateStamp(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

// Pure parse: "Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market" pipe-delimited text.
function parseShortVolumeFile(text) {
  const lines = text.trim().split("\n");
  if (!lines.length) return {};
  const header = lines[0].split("|").map((h) => h.trim());
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const out = {};
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cols = line.split("|");
    const symbol = cols[idx.Symbol];
    if (!symbol) continue;
    out[symbol] = {
      shortVolume: Number(cols[idx.ShortVolume]) || 0,
      totalVolume: Number(cols[idx.TotalVolume]) || 0,
    };
  }
  return out;
}

// One day's file, for every symbol (~730 KB parsed). Kept in memory only: storing these in the
// database made it ~20 MB bigger, and every new Vercel instance downloads the whole database.
// A missing file (weekend/holiday, or not yet posted) throws and is never cached.
const dayFiles = new Map();
async function fetchDay(d) {
  const ds = dateStamp(d);
  if (!dayFiles.has(ds)) {
    dayFiles.set(ds, (async () => {
      const url = `https://cdn.finra.org/equity/regsho/daily/CNMSshvol${ds}.txt`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`No FINRA short-volume file for ${ds}`);
      return parseShortVolumeFile(await res.text());
    })().catch((err) => { dayFiles.delete(ds); throw err; }));
    while (dayFiles.size > 45) dayFiles.delete(dayFiles.keys().next().value);
  }
  return dayFiles.get(ds);
}

// Walks back from yesterday (today's file isn't posted until after the close), skipping
// weekends, collecting up to `days` trading-day data points for `symbol`. Missing files
// (holidays, not-yet-posted) are skipped rather than failing the whole call.
async function getShortVolumeHistory(symbol, days = 20, maxCalendarDays = 45) {
  return cached(`finra_hist_${symbol}_${days}_${dateStamp(new Date())}`, 24 * 60 * 60, "finra_hist", async () => {
    const out = await shortVolumeHistory(symbol, days, maxCalendarDays);
    if (!out.length) throw new Error(`No FINRA short-volume data for ${symbol}`); // don't cache an outage
    return out;
  });
}

async function shortVolumeHistory(symbol, days, maxCalendarDays) {
  const out = [];
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  for (let i = 0; i < maxCalendarDays && out.length < days; i++) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      try {
        const rows = await fetchDay(d);
        const row = rows[symbol];
        if (row && row.totalVolume > 0) {
          out.push({ date: d.toISOString().slice(0, 10), ratio: row.shortVolume / row.totalVolume, shortVolume: row.shortVolume, totalVolume: row.totalVolume });
        }
      } catch { /* holiday or not yet posted */ }
    }
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out.reverse(); // oldest first
}

module.exports = { parseShortVolumeFile, getShortVolumeHistory };
