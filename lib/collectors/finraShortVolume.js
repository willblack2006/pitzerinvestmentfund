// FINRA Reg SHO daily short-sale volume, kept as history (rebuild plan step 1.2, first collector).
// The research page used to rebuild the last 20 days from FINRA's files on every visit and kept
// nothing; this stores each trading day once. Stored per symbol: short_volume and total_volume
// (the ratio is short/total). One marker row per file (entity "_file", metric "symbols") records
// that the day was ingested, so holidays and not-yet-posted days are retried, and done days aren't.
const finra = require("../sources/finra");
const warehouse = require("../warehouse");
const db = require("../../db");
const { define, HOUR, DAY } = require("./index");
const { trackedSymbols, wholeMarket } = require("./universe");

const SOURCE = "finra_regsho";
const LOOKBACK_WEEKDAYS = 10; // FINRA posts each file after the close; we fill gaps up to two weeks back

// Weekdays before `from` (UTC), newest first.
function recentWeekdays(from = new Date(), n = LOOKBACK_WEEKDAYS) {
  const out = [];
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  while (out.length < n) {
    d.setUTCDate(d.getUTCDate() - 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(new Date(d));
  }
  return out;
}

// Turns one parsed day file into alt_series rows, for the symbols we keep.
function rowsForDay(date, file, keep) {
  const rows = [];
  let symbols = 0;
  for (const [symbol, v] of Object.entries(file)) {
    symbols++;
    if (keep && !keep.has(symbol)) continue;
    if (!(v.totalVolume > 0)) continue;
    rows.push({ source: SOURCE, entity: symbol, metric: "short_volume", date, value: v.shortVolume });
    rows.push({ source: SOURCE, entity: symbol, metric: "total_volume", date, value: v.totalVolume });
  }
  rows.push({ source: SOURCE, entity: "_file", metric: "symbols", date, value: symbols });
  return rows;
}

async function collect({ now = new Date(), fetchDay = finra.fetchDay } = {}) {
  warehouse.attach();
  const days = recentWeekdays(now);
  const done = new Set(db.prepare(`SELECT date FROM wh.alt_series WHERE source = ? AND entity = '_file' AND metric = 'symbols' AND date >= ?`)
    .all(SOURCE, days[days.length - 1].toISOString().slice(0, 10)).map((r) => r.date));
  const keep = wholeMarket() ? null : trackedSymbols();
  let rows = 0, latest = null, missing = 0;
  for (const d of days) {
    const date = d.toISOString().slice(0, 10);
    if (done.has(date)) continue;
    let file;
    try { file = await fetchDay(d); } catch { missing++; continue; } // holiday or not posted yet
    const batch = rowsForDay(date, file, keep);
    warehouse.putSeries(batch);
    rows += batch.length - 1;
    if (!latest || date > latest) latest = date;
  }
  return { rows, asOf: latest, message: missing ? `${missing} weekday file${missing === 1 ? "" : "s"} not posted (holiday or not yet out)` : null };
}

// Stored history for one symbol, oldest first: [{ date, ratio, shortVolume, totalVolume }].
function history(symbol, days = 60) {
  warehouse.attach();
  const rows = db.prepare(`SELECT date, metric, value FROM wh.alt_series WHERE source = ? AND entity = ? AND metric IN ('short_volume','total_volume') ORDER BY date DESC LIMIT ?`)
    .all(SOURCE, String(symbol).toUpperCase(), days * 2);
  const byDate = new Map();
  for (const r of rows) {
    const o = byDate.get(r.date) || { date: r.date };
    o[r.metric === "short_volume" ? "shortVolume" : "totalVolume"] = r.value;
    byDate.set(r.date, o);
  }
  return [...byDate.values()].filter((o) => o.totalVolume > 0 && o.shortVolume != null)
    .map((o) => ({ ...o, ratio: o.shortVolume / o.totalVolume })).sort((a, b) => a.date.localeCompare(b.date));
}

define({
  name: "finra-short-volume",
  label: "Short-sale volume",
  source: "FINRA Reg SHO daily files",
  sourceUrl: "https://www.finra.org/finra-data/browse-catalog/short-sale-volume-data/daily-short-sale-volume-files",
  everyMs: 6 * HOUR,
  staleAfterMs: 4 * DAY, // long weekends leave up to 3 days without a new file
  collect: () => collect(),
});

module.exports = { collect, history, rowsForDay, recentWeekdays, SOURCE };
