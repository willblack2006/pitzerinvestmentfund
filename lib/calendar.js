// Market & event calendar: pure date math for the mechanical events (options expiration,
// S&P rebalance dates, month/quarter end) plus assembly of a combined, sorted event list and
// an .ics export. Data-backed events (earnings, ex-dividend dates, CPI/jobs releases) are
// fetched by the route and passed in here as plain {date, ...} arrays.

function pad(n) { return String(n).padStart(2, "0"); }
function iso(y, m, d) { return `${y}-${pad(m + 1)}-${pad(d)}`; }

// The nth weekday (0=Sun..6=Fri) of a given month (0-indexed). "Third Friday" = nth=3, dow=5.
function nthWeekday(year, month, dow, nth) {
  const first = new Date(Date.UTC(year, month, 1));
  const firstDow = first.getUTCDay();
  const day = 1 + ((dow - firstDow + 7) % 7) + (nth - 1) * 7;
  return iso(year, month, day);
}
const thirdFriday = (year, month) => nthWeekday(year, month, 5, 3);

function lastDayOfMonth(year, month) {
  return iso(year, month, new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
}

// Monthly options-expiration dates (third Friday of each month) over the next `months`.
function monthlyOpexDates(from = new Date(), months = 6) {
  const out = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + i, 1));
    out.push({ date: thirdFriday(d.getUTCFullYear(), d.getUTCMonth()), quarterly: [2, 5, 8, 11].includes(d.getUTCMonth()) });
  }
  return out;
}

// S&P/Russell-style quarterly rebalance effective dates: third Friday of Mar/Jun/Sep/Dec
// (same day as quarterly options expiration — "triple/quadruple witching").
function quarterlyRebalanceDates(from = new Date(), years = 1) {
  const out = [];
  const startYear = from.getUTCFullYear();
  for (let y = startYear; y <= startYear + years; y++) {
    for (const m of [2, 5, 8, 11]) {
      const date = thirdFriday(y, m);
      if (date >= iso(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())) out.push(date);
    }
  }
  return out;
}

function monthEnds(from = new Date(), months = 6) {
  const out = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + i, 1));
    out.push(lastDayOfMonth(d.getUTCFullYear(), d.getUTCMonth()));
  }
  return out;
}

// Merge every event source into one sorted, typed list. `windowStart`/`windowEnd` are ISO
// date strings; events outside the window are dropped.
function buildCalendarEvents({ earnings = [], exDividends = [], cpiDates = [], jobsDates = [], fomcDates = [] } = {}, { windowStart, windowEnd } = {}) {
  const events = [];
  for (const e of earnings) events.push({ date: e.date, type: "earnings", title: `${e.symbol} earnings`, detail: e.hour ? (e.hour === "bmo" ? "Before the open" : "After the close") : "" });
  for (const e of exDividends) events.push({ date: e.date, type: "ex-dividend", title: `${e.symbol} ex-dividend`, detail: "" });
  for (const d of cpiDates) events.push({ date: d, type: "macro", title: "CPI release", detail: "Consumer Price Index (BLS)" });
  for (const d of jobsDates) events.push({ date: d, type: "macro", title: "Jobs report", detail: "Employment Situation (BLS)" });
  for (const d of fomcDates) events.push({ date: d, type: "fomc", title: "FOMC meeting", detail: "" });
  for (const o of monthlyOpexDates(windowStart ? new Date(windowStart) : undefined, 6)) {
    events.push({ date: o.date, type: "opex", title: o.quarterly ? "Quarterly options expiration + S&P rebalance" : "Monthly options expiration", detail: o.quarterly ? "S&P and other index quarterly rebalances take effect after this close (\"quadruple witching\")" : "" });
  }
  for (const d of monthEnds(windowStart ? new Date(windowStart) : undefined, 6)) events.push({ date: d, type: "month-end", title: "Month end", detail: "" });

  const filtered = events.filter((e) => (!windowStart || e.date >= windowStart) && (!windowEnd || e.date <= windowEnd));
  const seen = new Set();
  const deduped = filtered.filter((e) => {
    const key = `${e.date}|${e.type}|${e.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  deduped.sort((a, b) => a.date.localeCompare(b.date));
  return deduped;
}

// Minimal .ics (iCalendar) export — all-day events, no recurrence, no external deps.
function toICS(events, calendarName = "Pitzer Investment Fund") {
  const esc = (s) => String(s || "").replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
  const dtstamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:-//${esc(calendarName)}//Calendar//EN`, "CALSCALE:GREGORIAN"];
  events.forEach((e, i) => {
    const date = e.date.replace(/-/g, "");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${date}-${i}@pitzer-investment-fund`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${date}`,
      `SUMMARY:${esc(e.title)}`,
      e.detail ? `DESCRIPTION:${esc(e.detail)}` : null,
      "END:VEVENT",
    );
  });
  lines.push("END:VCALENDAR");
  return lines.filter(Boolean).join("\r\n");
}

module.exports = { thirdFriday, monthlyOpexDates, quarterlyRebalanceDates, monthEnds, buildCalendarEvents, toICS };
