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

// A wider set for the research agents (the Macro page keeps its four tiles). Monthly values,
// end of month for daily/weekly series, transformed where a level means little (CPI → % YoY).
// units: lin = level, pc1 = % change from a year ago, chg = change from the prior month.
const AGENT_SERIES = {
  fedFunds: { id: "DFF", label: "Fed funds effective rate", unit: "%", units: "lin" },
  treasury3m: { id: "DGS3MO", label: "3-month Treasury yield", unit: "%", units: "lin" },
  treasury2y: { id: "DGS2", label: "2-year Treasury yield", unit: "%", units: "lin" },
  treasury10y: { id: "DGS10", label: "10-year Treasury yield", unit: "%", units: "lin" },
  curve10y2y: { id: "T10Y2Y", label: "10-year minus 2-year spread", unit: "pts", units: "lin" },
  breakeven5y: { id: "T5YIE", label: "5-year breakeven inflation", unit: "%", units: "lin" },
  mortgage30y: { id: "MORTGAGE30US", label: "30-year mortgage rate", unit: "%", units: "lin" },
  highYieldSpread: { id: "BAMLH0A0HYM2", label: "High-yield bond spread (OAS)", unit: "%", units: "lin" },
  investmentGradeSpread: { id: "BAMLC0A0CM", label: "Investment-grade bond spread (OAS)", unit: "%", units: "lin" },
  vix: { id: "VIXCLS", label: "VIX (S&P 500 implied volatility)", unit: "", units: "lin" },
  oilWti: { id: "DCOILWTICO", label: "WTI crude oil", unit: "$/bbl", units: "lin" },
  dollarIndex: { id: "DTWEXBGS", label: "Trade-weighted US dollar (broad)", unit: "index", units: "lin" },
  cpiYoY: { id: "CPIAUCSL", label: "CPI inflation, year over year", unit: "%", units: "pc1" },
  coreCpiYoY: { id: "CPILFESL", label: "Core CPI inflation, year over year", unit: "%", units: "pc1" },
  corePceYoY: { id: "PCEPILFE", label: "Core PCE inflation (the Fed's gauge), year over year", unit: "%", units: "pc1" },
  unemployment: { id: "UNRATE", label: "Unemployment rate", unit: "%", units: "lin" },
  payrollsChange: { id: "PAYEMS", label: "Nonfarm payrolls, monthly change", unit: "thousands", units: "chg" },
  initialClaims: { id: "ICSA", label: "Initial jobless claims", unit: "", units: "lin" },
  retailSalesYoY: { id: "RSAFS", label: "Retail sales, year over year", unit: "%", units: "pc1" },
  industrialProductionYoY: { id: "INDPRO", label: "Industrial production, year over year", unit: "%", units: "pc1" },
  consumerSentiment: { id: "UMCSENT", label: "University of Michigan consumer sentiment", unit: "index", units: "lin" },
  realGdpGrowth: { id: "A191RL1Q225SBRN", label: "Real GDP growth (quarterly, annualized)", unit: "%", units: "lin", quarterly: true },
};

async function getAgentSeries(key) {
  const def = AGENT_SERIES[key];
  if (!def) throw new Error(`Unknown FRED series ${key}`);
  if (!apiKey()) throw new Error("FRED_API_KEY not configured");
  return cached(`fred_agent_${def.id}_${def.units}`, 12 * 60 * 60, "fred_series", async () => {
    const freq = def.quarterly ? "q" : "m";
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${def.id}&api_key=${apiKey()}&file_type=json&frequency=${freq}&aggregation_method=eop&units=${def.units}&sort_order=desc&limit=${def.quarterly ? 12 : 25}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`FRED request failed: ${res.status}`);
    const json = await res.json();
    const observations = (json.observations || []).filter((o) => o.value !== ".").map((o) => ({ date: o.date, value: Math.round(parseFloat(o.value) * 1000) / 1000 })).reverse();
    return { id: def.id, label: def.label, unit: def.unit, frequency: def.quarterly ? "quarterly" : "monthly (end of month)", latest: observations.at(-1) || null, observations };
  });
}

async function getAllAgentSeries() {
  const keys = Object.keys(AGENT_SERIES);
  const got = await Promise.allSettled(keys.map((k) => getAgentSeries(k)));
  const out = {};
  keys.forEach((k, i) => { out[k] = got[i].status === "fulfilled" ? got[i].value : { label: AGENT_SERIES[k].label, error: got[i].reason?.message || "unavailable" }; });
  return out;
}

module.exports = { getSeries, getAllSeries, getReleaseDates, getAgentSeries, getAllAgentSeries, SERIES, AGENT_SERIES, RELEASES };
