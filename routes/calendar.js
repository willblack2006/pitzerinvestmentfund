const express = require("express");
const db = require("../db");
const finnhub = require("../lib/sources/finnhub");
const yahoo = require("../lib/sources/yahoo");
const fred = require("../lib/sources/fred");
const fed = require("../lib/sources/fed");
const { buildCalendarEvents, toICS, quarterlyRebalanceDates } = require("../lib/calendar");

const router = express.Router();

async function gatherEvents(months) {
  const owned = db.prepare("SELECT symbol FROM positions").all().map((r) => r.symbol);
  const watched = db.prepare("SELECT symbol FROM watchlist").all().map((r) => r.symbol);
  const symbols = [...new Set([...owned, ...watched])];
  const windowStart = new Date().toISOString().slice(0, 10);
  const windowEnd = new Date(Date.now() + months * 31 * 864e5).toISOString().slice(0, 10);

  const [earningsR, exDivR, cpiR, jobsR, fomcR] = await Promise.allSettled([
    finnhub.apiKey() ? finnhub.getEarningsCalendar(symbols, windowStart, windowEnd) : Promise.resolve([]),
    Promise.all(symbols.map(async (s) => {
      try {
        const qs = await yahoo.getQuoteSummary(s);
        const d = qs.calendarEvents?.exDividendDate?.fmt;
        return d ? { symbol: s, date: d } : null;
      } catch { return null; }
    })).then((rows) => rows.filter(Boolean)),
    fred.getReleaseDates("cpi", { months }).catch(() => []),
    fred.getReleaseDates("jobs", { months }).catch(() => []),
    fed.getFomcCalendar(),
  ]);

  const events = buildCalendarEvents({
    earnings: earningsR.status === "fulfilled" ? earningsR.value : [],
    exDividends: exDivR.status === "fulfilled" ? exDivR.value : [],
    cpiDates: cpiR.status === "fulfilled" ? cpiR.value : [],
    jobsDates: jobsR.status === "fulfilled" ? jobsR.value : [],
    fomcDates: fomcR.status === "fulfilled" ? fomcR.value.meetingDates : [], // decision day of each two-day meeting
  }, { windowStart, windowEnd });

  return {
    events, windowStart, windowEnd,
    rebalanceDates: quarterlyRebalanceDates(new Date(windowStart), Math.ceil(months / 12) || 1).filter((d) => d <= windowEnd),
    fredConfigured: !!process.env.FRED_API_KEY,
    finnhubConfigured: finnhub.apiKey(),
  };
}

router.get("/calendar", async (req, res) => {
  const months = Math.min(12, Math.max(1, Number(req.query.months) || 3));
  try {
    res.json(await gatherEvents(months));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/calendar.ics", async (req, res) => {
  const months = Math.min(12, Math.max(1, Number(req.query.months) || 3));
  try {
    const { events } = await gatherEvents(months);
    res.set("Content-Type", "text/calendar; charset=utf-8");
    res.set("Content-Disposition", "attachment; filename=\"pitzer-fund-calendar.ics\"");
    res.send(toICS(events));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
