// Federal Reserve: the FOMC calendar (federalreserve.gov/json/calendar.json, the JSON behind
// the Fed's own calendar page; undocumented, so callers treat failure as "no data") and the
// monetary-policy press release RSS feed. Both are public US government sources, no key.
const { cached } = require("../cache");
const { parseFedCalendar, parseRss } = require("../marketNews");

const UA = "Mozilla/5.0 (compatible; PitzerInvestmentFund/1.0)";

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Federal Reserve request failed: ${res.status} ${url}`);
  return (await res.text()).replace(/^﻿/, "");
}

// Raw calendar is cached a day; the "next/last meeting" view is recomputed per call.
async function getFomcCalendar() {
  const json = await cached("fed_calendar_json", 24 * 60 * 60, "fed", async () => JSON.parse(await fetchText("https://www.federalreserve.gov/json/calendar.json")));
  return parseFedCalendar(json);
}

async function getFedPress(limit = 5) {
  return cached(`fed_press_monetary_${limit}`, 60 * 60, "fed", async () => parseRss(await fetchText("https://www.federalreserve.gov/feeds/press_monetary.xml"), limit));
}

module.exports = { getFomcCalendar, getFedPress };
