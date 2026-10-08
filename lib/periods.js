// Starting prices for the Holdings page's time frames (5D, 1M, 3M, YTD, 1Y). Each frame's
// "base" is the last daily close before the frame starts; the page compares it with the live
// price. Pure, so it's unit-testable.

const PERIODS = ["5d", "1m", "3m", "ytd", "1y"];

const isoMinusMonths = (iso, months) => {
  const d = new Date(`${iso}T12:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - months);
  // Clamp (Mar 31 minus 1 month = Feb 28/29, not Mar 3).
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
};

// The calendar date each frame is measured from, given the latest trading date.
function periodStartDates(latest) {
  return {
    "1m": isoMinusMonths(latest, 1),
    "3m": isoMinusMonths(latest, 3),
    ytd: `${latest.slice(0, 4)}-01-01`,
    "1y": isoMinusMonths(latest, 12),
  };
}

// history: [{ date, close }] oldest first (Yahoo daily bars; the last bar may be today's
// session in progress). Returns { [period]: { date, close } | null }.
//   5D  = close 5 sessions before the latest bar (Yahoo's "5D" convention)
//   1M/3M/1Y = last close on or before the same calendar day 1/3/12 months earlier
//   YTD = last close of the prior year
function basesFor(history) {
  const bars = (history || []).filter((b) => b && b.date && Number.isFinite(b.close));
  const out = Object.fromEntries(PERIODS.map((p) => [p, null]));
  if (!bars.length) return out;
  const latest = bars.at(-1).date;
  const pick = (b) => (b ? { date: b.date, close: b.close } : null);
  out["5d"] = pick(bars.length > 5 ? bars[bars.length - 6] : null);
  const starts = periodStartDates(latest);
  for (const p of ["1m", "3m", "1y"]) out[p] = pick([...bars].reverse().find((b) => b.date <= starts[p]));
  out.ytd = pick([...bars].reverse().find((b) => b.date < starts.ytd));
  return out;
}

module.exports = { PERIODS, periodStartDates, basesFor };
