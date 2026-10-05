// Benchmarks: a curated catalogue plus support for custom tickers and weighted blends.
//
// A benchmark is stored as a string:
//   "SPY"                 — any single Yahoo ticker (ETF, index like ^GSPC, or stock)
//   "SPY:60,AGG:40"       — a blend, rebalanced daily, weights in percent (normalized to 100)

const yahoo = require("./sources/yahoo");
const { SECTOR_KEY } = require("./analytics");

const PRESETS = [
  { group: "US large cap", items: [
    ["SPY", "S&P 500"],
    ["RSP", "S&P 500 Equal Weight"],
    ["DIA", "Dow Jones Industrial Average"],
    ["QQQ", "Nasdaq-100"],
    ["ONEQ", "Nasdaq Composite"],
    ["IWB", "Russell 1000"],
    ["OEF", "S&P 100"],
  ] },
  { group: "US total market", items: [
    ["VTI", "CRSP US Total Market"],
    ["IWV", "Russell 3000"],
    ["ITOT", "S&P Total Market"],
  ] },
  { group: "US mid & small cap", items: [
    ["MDY", "S&P MidCap 400"],
    ["IWR", "Russell Midcap"],
    ["IJR", "S&P SmallCap 600"],
    ["IWM", "Russell 2000"],
    ["IWC", "Russell Microcap"],
  ] },
  { group: "US style & factor", items: [
    ["IWF", "Russell 1000 Growth"],
    ["IWD", "Russell 1000 Value"],
    ["IWO", "Russell 2000 Growth"],
    ["IWN", "Russell 2000 Value"],
    ["VUG", "CRSP US Large Growth"],
    ["VTV", "CRSP US Large Value"],
    ["MTUM", "MSCI USA Momentum"],
    ["QUAL", "MSCI USA Quality"],
    ["USMV", "MSCI USA Min Volatility"],
    ["SCHD", "Dow Jones US Dividend 100"],
    ["NOBL", "S&P 500 Dividend Aristocrats"],
  ] },
  { group: "Global & international", items: [
    ["ACWI", "MSCI ACWI (global)"],
    ["VT", "FTSE Global All Cap"],
    ["URTH", "MSCI World (developed)"],
    ["VXUS", "Total International ex-US"],
    ["EFA", "MSCI EAFE (developed ex-US)"],
    ["EEM", "MSCI Emerging Markets"],
    ["VGK", "FTSE Developed Europe"],
    ["EWJ", "MSCI Japan"],
  ] },
  { group: "US sectors (SPDR)", items: [
    ["XLK", "Technology"],
    ["XLC", "Communication Services"],
    ["XLY", "Consumer Discretionary"],
    ["XLP", "Consumer Staples"],
    ["XLF", "Financials"],
    ["XLV", "Health Care"],
    ["XLI", "Industrials"],
    ["XLE", "Energy"],
    ["XLU", "Utilities"],
    ["XLRE", "Real Estate"],
    ["XLB", "Materials"],
  ] },
  { group: "Themes & industries", items: [
    ["SOXX", "Semiconductors"],
    ["IGV", "Software"],
    ["IBB", "Biotech"],
    ["KRE", "Regional Banks"],
    ["ITB", "Homebuilders"],
    ["ICLN", "Clean Energy"],
    ["ARKK", "ARK Innovation"],
  ] },
  { group: "Bonds", items: [
    ["AGG", "US Aggregate Bond"],
    ["BND", "Total Bond Market"],
    ["TLT", "20+ Year Treasury"],
    ["IEF", "7–10 Year Treasury"],
    ["SHY", "1–3 Year Treasury"],
    ["LQD", "Investment-Grade Corporate"],
    ["HYG", "High-Yield Corporate"],
    ["TIP", "TIPS (inflation-protected)"],
  ] },
  { group: "Multi-asset & blends", items: [
    ["SPY:60,AGG:40", "60/40 stocks/bonds (classic balanced)"],
    ["SPY:70,AGG:30", "70/30 stocks/bonds"],
    ["SPY:80,AGG:20", "80/20 stocks/bonds"],
    ["VTI:60,VXUS:40", "Global equity 60/40 US/international"],
    ["SPY:50,IWM:50", "Half large cap, half small cap"],
    ["SPY:50,QQQ:50", "Half S&P 500, half Nasdaq-100"],
    ["AOR", "iShares Growth Allocation (60/40 fund)"],
    ["AOA", "iShares Aggressive Allocation (80/20 fund)"],
  ] },
  { group: "Price indices (no dividends)", items: [
    ["^GSPC", "S&P 500 index"],
    ["^IXIC", "Nasdaq Composite index"],
    ["^DJI", "Dow Jones index"],
    ["^RUT", "Russell 2000 index"],
  ] },
];

const LABELS = new Map(PRESETS.flatMap((g) => g.items));
const TICKER_RE = /^[A-Z0-9.\-^=]{1,12}$/;

// "spy:60, agg:40" -> [{ symbol: "SPY", weight: 0.6 }, { symbol: "AGG", weight: 0.4 }]
function parse(benchmark) {
  const str = String(benchmark || "").toUpperCase().replace(/\s+/g, "");
  if (!str) throw new Error("Choose a benchmark.");
  const parts = str.split(",");
  if (parts.length === 1 && !str.includes(":")) {
    if (!TICKER_RE.test(str)) throw new Error(`"${benchmark}" isn't a valid ticker.`);
    return [{ symbol: str, weight: 1 }];
  }
  if (parts.length > 6) throw new Error("A blend can have at most 6 components.");
  const comps = parts.map((p) => {
    const [symbol, w] = p.split(":");
    const weight = Number(w);
    if (!TICKER_RE.test(symbol || "") || !(weight > 0)) throw new Error(`Blend part "${p}" should look like SPY:60.`);
    return { symbol, weight };
  });
  if (new Set(comps.map((c) => c.symbol)).size !== comps.length) throw new Error("Each ticker can appear once in a blend.");
  const total = comps.reduce((s, c) => s + c.weight, 0);
  return comps.map((c) => ({ ...c, weight: c.weight / total }));
}

function normalize(benchmark) {
  const comps = parse(benchmark);
  return comps.length === 1 ? comps[0].symbol : comps.map((c) => `${c.symbol}:${+(c.weight * 100).toFixed(2)}`).join(",");
}

function label(benchmark) {
  const key = normalize(benchmark);
  if (LABELS.has(key)) return LABELS.get(key);
  const comps = parse(key);
  if (comps.length === 1) return key;
  return comps.map((c) => `${(c.weight * 100).toFixed(0)}% ${LABELS.get(c.symbol) || c.symbol}`).join(" + ");
}

// Short name for chart legends: the ticker, or "60/40 SPY/AGG" for blends.
function shortName(benchmark) {
  const comps = parse(benchmark);
  if (comps.length === 1) return comps[0].symbol;
  return `${comps.map((c) => (c.weight * 100).toFixed(0)).join("/")} ${comps.map((c) => c.symbol).join("/")}`;
}

// Daily price series for the benchmark. Single tickers are returned as-is; blends are built as
// a daily-rebalanced index (start = 100) from each component's daily returns on common dates.
async function series(benchmark, range = "1y") {
  const comps = parse(benchmark);
  if (comps.length === 1) return yahoo.getChart(comps[0].symbol, range, "1d");
  const charts = await Promise.all(comps.map((c) => yahoo.getChart(c.symbol, range, "1d")));
  const maps = charts.map((ch) => new Map(ch.map((p) => [p.date, p.close])));
  const dates = charts[0].map((p) => p.date).filter((d) => maps.every((m) => m.has(d)));
  if (dates.length < 2) throw new Error("Not enough overlapping history for this blend.");
  const out = [{ date: dates[0], close: 100 }];
  for (let i = 1; i < dates.length; i++) {
    const r = comps.reduce((s, c, k) => s + c.weight * (maps[k].get(dates[i]) / maps[k].get(dates[i - 1]) - 1), 0);
    out.push({ date: dates[i], close: out[i - 1].close * (1 + r) });
  }
  return out;
}

// Sector weights (in %, keyed by Yahoo sector name) for the benchmark, blended by weight.
// Components without sector data (bonds, single stocks, price indices) are left out, and
// `coverage` reports how much of the benchmark the breakdown represents.
async function sectorWeights(benchmark) {
  const comps = parse(benchmark);
  const out = {};
  let coverage = 0;
  for (const c of comps) {
    let raw = {};
    try { raw = await yahoo.getBenchmarkSectorWeights(c.symbol.replace(/^\^GSPC$/, "SPY")); } catch { raw = {}; }
    const entries = Object.entries(raw);
    if (!entries.length) continue;
    coverage += c.weight;
    for (const [k, v] of entries) {
      const name = SECTOR_KEY[k] || k;
      out[name] = (out[name] || 0) + v * 100 * c.weight;
    }
  }
  // Rescale to the equity sleeve so a 60/40 blend's sectors still sum to 100% and compare
  // like-for-like with an all-equity fund.
  if (coverage > 0 && coverage < 1) for (const k of Object.keys(out)) out[k] /= coverage;
  return { weights: out, coverage };
}

module.exports = { PRESETS, parse, normalize, label, shortName, series, sectorWeights };
