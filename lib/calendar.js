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

// NYSE full-day market holidays for a year, as YYYY-MM-DD. Weekend holidays move to the Friday
// before (Saturday) or Monday after (Sunday), except New Year's Day on a Saturday, which NYSE
// does not observe on the Friday before. Juneteenth from 2022.
function lastWeekday(year, month, dow) {
  const last = new Date(Date.UTC(year, month + 1, 0));
  const day = last.getUTCDate() - ((last.getUTCDay() - dow + 7) % 7);
  return iso(year, month, day);
}
function easterSunday(year) { // anonymous Gregorian algorithm
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}
function observed(year, month, day, { satToFriday = true } = {}) {
  const dow = new Date(Date.UTC(year, month, day)).getUTCDay();
  if (dow === 6) return satToFriday ? iso(year, month, day - 1) : null;
  if (dow === 0) return iso(year, month, day + 1);
  return iso(year, month, day);
}
const holidayCache = new Map();
function marketHolidays(year) {
  if (holidayCache.has(year)) return holidayCache.get(year);
  const good = easterSunday(year); good.setUTCDate(good.getUTCDate() - 2);
  const list = [
    observed(year, 0, 1, { satToFriday: false }),
    nthWeekday(year, 0, 1, 3), // MLK Day
    nthWeekday(year, 1, 1, 3), // Washington's Birthday
    good.toISOString().slice(0, 10), // Good Friday
    lastWeekday(year, 4, 1), // Memorial Day
    year >= 2022 ? observed(year, 5, 19) : null,
    observed(year, 6, 4),
    nthWeekday(year, 8, 1, 1), // Labor Day
    nthWeekday(year, 10, 4, 4), // Thanksgiving
    observed(year, 11, 25),
  ].filter(Boolean).map((d) => new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10));
  const set = new Set(list);
  holidayCache.set(year, set);
  return set;
}
// Weekday that isn't an NYSE holiday. `date` is YYYY-MM-DD.
function isTradingDay(date) {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = d.getUTCDay();
  return dow !== 0 && dow !== 6 && !marketHolidays(d.getUTCFullYear()).has(date);
}

module.exports = { marketHolidays, isTradingDay, thirdFriday, monthlyOpexDates, quarterlyRebalanceDates, monthEnds, buildCalendarEvents, toICS };
