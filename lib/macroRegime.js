// Macro regime dashboard (WS10): ten years of monthly FRED data for the yield curve, inflation,
// credit spreads, jobs and policy rates, plus NBER recession months for shading, and a plain
// rule-based read of where the cycle is. No model; every call is explained by its numbers.
const { cached } = require("./cache");

const REGIME_SERIES = {
  curve10y2y: { id: "T10Y2Y", label: "10-year minus 2-year Treasury", unit: "pts", units: "lin", group: "Rates" },
  curve10y3m: { id: "T10Y3M", label: "10-year minus 3-month Treasury", unit: "pts", units: "lin", group: "Rates" },
  fedFunds: { id: "FEDFUNDS", label: "Fed funds rate", unit: "%", units: "lin", group: "Rates" },
  coreCpi: { id: "CPILFESL", label: "Core CPI, year over year", unit: "%", units: "pc1", group: "Inflation" },
  corePce: { id: "PCEPILFE", label: "Core PCE, year over year", unit: "%", units: "pc1", group: "Inflation" },
  breakeven5y: { id: "T5YIE", label: "5-year breakeven inflation", unit: "%", units: "lin", group: "Inflation" },
  hySpread: { id: "BAMLH0A0HYM2", label: "High-yield credit spread", unit: "%", units: "lin", group: "Credit" },
  igSpread: { id: "BAMLC0A0CM", label: "Investment-grade credit spread", unit: "%", units: "lin", group: "Credit" },
  unemployment: { id: "UNRATE", label: "Unemployment rate", unit: "%", units: "lin", group: "Jobs" },
  claims: { id: "ICSA", label: "Initial jobless claims (thousands)", unit: "k", units: "lin", group: "Jobs", scale: 0.001 },
  vix: { id: "VIXCLS", label: "VIX (expected stock volatility)", unit: "", units: "lin", group: "Credit" },
};
const RECESSION = { id: "USREC", units: "lin" };

async function fetchMonthly(def, apiKey, years = 10) {
  return cached(`fred_regime_${def.id}_${def.units}_${years}`, 12 * 60 * 60, "fred_series", async () => {
    const start = new Date(Date.now() - years * 365.25 * 864e5).toISOString().slice(0, 10);
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${def.id}&api_key=${apiKey}&file_type=json&frequency=m&aggregation_method=avg&units=${def.units}&observation_start=${start}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`FRED request failed: ${res.status}`);
    const json = await res.json();
    return (json.observations || []).filter((o) => o.value !== ".").map((o) => ({ date: o.date, value: Math.round(parseFloat(o.value) * (def.scale || 1) * 1000) / 1000 }));
  });
}

// Recession months as [start, end] date ranges (first-of-month dates).
function recessionRanges(obs = []) {
  const out = [];
  let cur = null;
  for (const o of obs) {
    if (o.value >= 1 && !cur) cur = { start: o.date, end: o.date };
    else if (o.value >= 1) cur.end = o.date;
    else if (cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
}

const last = (s) => s?.at(-1)?.value ?? null;
const ago = (s, n) => (s && s.length > n ? s[s.length - 1 - n].value : null);

// Sahm rule: 3-month average unemployment minus its low over the prior 12 months.
function sahm(unemp = []) {
  if (unemp.length < 15) return null;
  const avg3 = (i) => (unemp[i].value + unemp[i - 1].value + unemp[i - 2].value) / 3;
  const n = unemp.length - 1;
  let low = Infinity;
  for (let i = n - 12; i < n; i++) if (i >= 2) low = Math.min(low, avg3(i));
  return Math.round((avg3(n) - low) * 100) / 100;
}

// Each read: { key, label, status: 'good'|'watch'|'warn', text }. Thresholds are the common
// rules of thumb, stated in the text so a member can disagree with them.
function readRegime(s) {
  const reads = [];
  const add = (key, label, status, text) => reads.push({ key, label, status, text });
  const c = last(s.curve10y2y), c3 = last(s.curve10y3m);
  if (c !== null) {
    const inverted = c < 0 || (c3 !== null && c3 < 0);
    const wasInverted = (s.curve10y2y || []).slice(-24).some((o) => o.value < 0);
    add("curve", "Yield curve", inverted ? "warn" : wasInverted ? "watch" : "good",
      inverted ? `Inverted (10y−2y ${c.toFixed(2)} pts${c3 !== null ? `, 10y−3m ${c3.toFixed(2)}` : ""}). Inversions have come before most US recessions, often by a year or more.`
        : wasInverted ? `Positive again (${c.toFixed(2)} pts) after inverting in the last two years. Past recessions often started after the curve un-inverted.`
          : `Positive (${c.toFixed(2)} pts): longer rates above short ones, the normal shape.`);
  }
  const pce = last(s.corePce), pce6 = ago(s.corePce, 6);
  if (pce !== null) {
    const trend = pce6 !== null ? pce - pce6 : 0;
    add("inflation", "Inflation", pce > 3 ? "warn" : pce > 2.5 ? "watch" : "good",
      `Core PCE ${pce.toFixed(1)}% a year (the Fed targets 2%), ${Math.abs(trend) < 0.15 ? "flat" : trend > 0 ? "rising" : "falling"} over six months.`);
  }
  const hy = last(s.hySpread), hy3 = ago(s.hySpread, 3);
  if (hy !== null) {
    const widen = hy3 !== null ? hy - hy3 : 0;
    add("credit", "Credit", hy > 6 || widen > 1 ? "warn" : hy > 4.5 || widen > 0.5 ? "watch" : "good",
      `High-yield spread ${hy.toFixed(2)}%${hy3 !== null ? `, ${widen >= 0 ? "up" : "down"} ${Math.abs(widen).toFixed(2)} pts in three months` : ""}. Above about 6% or widening fast means lenders are worried about defaults.`);
  }
  const sr = sahm(s.unemployment);
  const u = last(s.unemployment);
  if (sr !== null) {
    add("jobs", "Jobs", sr >= 0.5 ? "warn" : sr >= 0.3 ? "watch" : "good",
      `Unemployment ${u.toFixed(1)}%. Sahm rule reading ${sr.toFixed(2)} (0.5 or more has marked the start of every US recession since 1970).`);
  }
  const ff = last(s.fedFunds), ff6 = ago(s.fedFunds, 6);
  if (ff !== null && ff6 !== null) {
    const d = ff - ff6;
    add("policy", "Fed policy", "info", `Fed funds ${ff.toFixed(2)}%, ${Math.abs(d) < 0.1 ? "unchanged" : d > 0 ? `up ${d.toFixed(2)}` : `down ${Math.abs(d).toFixed(2)}`} over six months${pce !== null ? `; ${(ff - pce).toFixed(1)} pts above core inflation` : ""}.`);
  }
  // Growth × inflation quadrant from the jobs and inflation trends.
  const growthDown = sr !== null && sr >= 0.3;
  const inflUp = pce !== null && pce6 !== null && pce - pce6 > 0.15;
  const regime = growthDown ? (inflUp ? "Stagflation risk" : "Slowdown") : (inflUp ? "Reheating" : "Expansion, cooling inflation");
  const regimeText = {
    "Stagflation risk": "Jobs weakening while inflation rises: the hardest mix for stocks and for the Fed.",
    Slowdown: "Jobs weakening with inflation steady or falling: rate cuts likely, earnings at risk.",
    Reheating: "Jobs holding up and inflation turning higher: rates may stay high for longer.",
    "Expansion, cooling inflation": "Jobs holding up and inflation steady or easing: the friendliest backdrop for stocks.",
  }[regime];
  const warns = reads.filter((r) => r.status === "warn").length;
  return { regime, regimeText, warnings: warns, reads };
}

async function macroRegime({ apiKey = process.env.FRED_API_KEY || "", years = 10 } = {}) {
  if (!apiKey) return { available: false, reason: "FRED_API_KEY not configured" };
  const keys = Object.keys(REGIME_SERIES);
  const got = await Promise.allSettled([...keys.map((k) => fetchMonthly(REGIME_SERIES[k], apiKey, years)), fetchMonthly(RECESSION, apiKey, years)]);
  const series = {}, errors = {};
  keys.forEach((k, i) => { if (got[i].status === "fulfilled") series[k] = got[i].value; else errors[k] = String(got[i].reason?.message || got[i].reason); });
  const rec = got.at(-1).status === "fulfilled" ? got.at(-1).value : [];
  if (!Object.keys(series).length) return { available: false, reason: Object.values(errors)[0] || "FRED unavailable" };
  return {
    available: true,
    asOf: new Date().toISOString(),
    series: Object.fromEntries(Object.entries(series).map(([k, obs]) => [k, { ...REGIME_SERIES[k], key: k, latest: obs.at(-1) || null, observations: obs }])),
    recessions: recessionRanges(rec),
    ...readRegime(series),
    errors,
  };
}

module.exports = { REGIME_SERIES, recessionRanges, sahm, readRegime, macroRegime };
