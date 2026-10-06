const { cached } = require("../cache");

const SERIES = {
  fedFundsRate: { id: "FEDFUNDS", label: "Fed Funds Rate", unit: "%" },
  cpi: { id: "CPIAUCSL", label: "CPI (Index)", unit: "" },
  unemployment: { id: "UNRATE", label: "Unemployment Rate", unit: "%" },
  treasury10y: { id: "DGS10", label: "10-Year Treasury Yield", unit: "%" },
};

function apiKey() {
  return process.env.FRED_API_KEY || "";
}

async function getSeries(key) {
  const def = SERIES[key];
  if (!def) throw new Error(`Unknown FRED series ${key}`);
  if (!apiKey()) throw new Error("FRED_API_KEY not configured");

  return cached(`fred_${def.id}`, 24 * 60 * 60, "fred_series", async () => {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${def.id}&api_key=${apiKey()}&file_type=json&sort_order=desc&limit=24`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`FRED request failed: ${res.status}`);
    const json = await res.json();
    const observations = (json.observations || [])
      .filter((o) => o.value !== ".")
      .map((o) => ({ date: o.date, value: parseFloat(o.value) }))
      .reverse();
    return { label: def.label, unit: def.unit, observations };
  });
}

async function getAllSeries() {
  const entries = await Promise.allSettled(Object.keys(SERIES).map((k) => getSeries(k)));
  const out = {};
  Object.keys(SERIES).forEach((k, i) => {
    out[k] = entries[i].status === "fulfilled" ? entries[i].value : null;
  });
  return out;
}

// FRED's release calendar: scheduled release dates for a named economic report, including
// future dates that don't have data yet. Release IDs are static FRED identifiers: 10 =
// Consumer Price Index, 50 = Employment Situation (the monthly jobs report).
const RELEASES = { cpi: 10, jobs: 50 };

async function getReleaseDates(key, { months = 6 } = {}) {
  const releaseId = RELEASES[key];
  if (!releaseId) throw new Error(`Unknown FRED release "${key}"`);
  if (!apiKey()) throw new Error("FRED_API_KEY not configured");
  return cached(`fred_release_${key}`, 24 * 60 * 60, "fred_release", async () => {
    const start = new Date().toISOString().slice(0, 10);
    const end = new Date(Date.now() + months * 31 * 864e5).toISOString().slice(0, 10);
    const url = `https://api.stlouisfed.org/fred/release/dates?release_id=${releaseId}&api_key=${apiKey()}&file_type=json&include_release_dates_with_no_data=true&sort_order=asc&realtime_start=${start}&realtime_end=${end}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`FRED request failed: ${res.status}`);
    const json = await res.json();
    return (json.release_dates || []).map((r) => r.date);
  });
}

module.exports = { getSeries, getAllSeries, getReleaseDates, SERIES, RELEASES };
