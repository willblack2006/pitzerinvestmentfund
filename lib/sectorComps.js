// How a company compares with every SEC filer in its industry (same 4-digit SIC code), from
// SEC XBRL "frames": one file per concept and calendar year with that number for every filer.
// The fund's peer table (Research → Valuation) covers up to 8 Yahoo peers; this covers the whole
// industry. Not checked against live SEC from the build environment; the parsers are unit-tested.
const { cached } = require("./cache");
const sec = require("./sources/sec");

const { secFetch } = require("./secFetch");
async function get(url, as = "json") {
  const res = await secFetch(url, { accept: as === "json" ? "application/json" : "text/html" });
  if (!res.ok) throw new Error(`SEC request failed: ${res.status} ${url}`);
  return as === "json" ? res.json() : res.text();
}

// Revenue has several tags; a filer uses one. First tag with a value wins.
const CONCEPTS = {
  revenue: ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax"],
  grossProfit: ["GrossProfit"],
  operatingIncome: ["OperatingIncomeLoss"],
  netIncome: ["NetIncomeLoss"],
  ocf: ["NetCashProvidedByUsedInOperatingActivities"],
  capex: ["PaymentsToAcquirePropertyPlantAndEquipment"],
  rnd: ["ResearchAndDevelopmentExpense"],
};

// The company's SIC industry code from its EDGAR submissions record.
async function industryOf(symbol) {
  const cik = await sec.cikFor(symbol);
  if (!cik) return null;
  return cached(`sec_industry_${cik}`, 30 * 24 * 60 * 60, "sec_industry", async () => {
    const j = await get(`https://data.sec.gov/submissions/CIK${cik}.json`);
    return { cik, name: j.name, sic: String(j.sic || ""), sicDescription: j.sicDescription || "" };
  });
}

// CIKs EDGAR lists under a SIC code (company browse pages, 100 per page).
function parseSicPage(html) {
  return [...new Set([...String(html).matchAll(/CIK=(\d{10})/g)].map((m) => m[1]))];
}
async function companiesInSic(sic, { pages = 4 } = {}) {
  return cached(`sec_sic_${sic}`, 30 * 24 * 60 * 60, "sec_industry", async () => {
    const ciks = new Set();
    for (let p = 0; p < pages; p++) {
      const html = await get(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&SIC=${sic}&type=10-K&owner=include&count=100&start=${p * 100}`, "text");
      const found = parseSicPage(html);
      found.forEach((c) => ciks.add(c));
      if (found.length < 100) break;
    }
    return [...ciks];
  });
}

// One frame as { cik(10 digits): { val, name, end } }.
function parseFrame(json) {
  const out = {};
  for (const r of json?.data || []) out[String(r.cik).padStart(10, "0")] = { val: r.val, name: r.entityName, end: r.end };
  return out;
}
async function frame(tag, year) {
  return cached(`sec_frame_${tag}_CY${year}`, 7 * 24 * 60 * 60, "sec_frames", async () => {
    try { return parseFrame(await get(`https://data.sec.gov/api/xbrl/frames/us-gaap/${tag}/USD/CY${year}.json`)); }
    catch (err) { if (/404/.test(err.message)) return {}; throw err; }
  });
}
async function concept(key, year, ciks) {
  const out = {};
  for (const tag of CONCEPTS[key]) {
    const f = await frame(tag, year);
    for (const c of ciks) if (out[c] == null && f[c]) out[c] = f[c];
  }
  return out;
}

const div = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b ? a / b : null);
const r4 = (x) => (Number.isFinite(x) ? Math.round(x * 10000) / 10000 : null);
function stats(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const q = (p) => { const i = (v.length - 1) * p, lo = Math.floor(i); return v[lo] + (v[Math.ceil(i)] - v[lo]) * (i - lo); };
  return { n: v.length, p25: r4(q(0.25)), median: r4(q(0.5)), p75: r4(q(0.75)) };
}
const percentile = (x, values) => { const v = values.filter(Number.isFinite); return Number.isFinite(x) && v.length ? r4(v.filter((y) => y < x).length / v.length) : null; };

// Per-company metrics for one calendar year (and growth vs the year before).
function metricsFor(c, cur, prev) {
  const rev = cur.revenue[c]?.val;
  return {
    revenue: rev ?? null,
    revenueGrowth: r4(div(rev, prev.revenue[c]?.val) != null ? div(rev, prev.revenue[c].val) - 1 : null),
    grossMargin: r4(div(cur.grossProfit[c]?.val, rev)),
    operatingMargin: r4(div(cur.operatingIncome[c]?.val, rev)),
    netMargin: r4(div(cur.netIncome[c]?.val, rev)),
    fcfMargin: r4(div(cur.ocf[c]?.val != null && cur.capex[c]?.val != null ? cur.ocf[c].val - cur.capex[c].val : null, rev)),
    rndToRevenue: r4(div(cur.rnd[c]?.val, rev)),
  };
}
const METRICS = ["revenue", "revenueGrowth", "grossMargin", "operatingMargin", "netMargin", "fcfMargin", "rndToRevenue"];

// Builds the comparison from already-loaded data (pure; unit-tested).
function compare({ cik, industry, year, ciks, cur, prev, top = 10 }) {
  const rows = ciks.filter((c) => cur.revenue[c]?.val > 0).map((c) => ({ cik: c, name: cur.revenue[c].name, ...metricsFor(c, cur, prev) }));
  const me = rows.find((r) => r.cik === cik) || (cur.revenue[cik] ? { cik, name: cur.revenue[cik].name, ...metricsFor(cik, cur, prev) } : null);
  const others = rows.filter((r) => r.cik !== cik);
  const industryStats = {}, rank = {};
  for (const m of METRICS) {
    industryStats[m] = stats(others.map((r) => r[m]));
    rank[m] = me ? percentile(me[m], others.map((r) => r[m])) : null;
  }
  return {
    industry, calendarYear: year, companiesWithData: rows.length,
    company: me, percentileVsIndustry: rank, industryStats,
    largestByRevenue: [...rows].sort((a, b) => b.revenue - a.revenue).slice(0, top).map(({ cik: _, ...r }) => r),
    note: "Percentile = share of industry filers below this company (0.9 = higher than 90%). Calendar-year XBRL frames; fiscal years that don't end in December are mapped to the closest calendar year by SEC.",
  };
}

async function sectorComps(symbol, { year = new Date().getUTCFullYear() - 1 } = {}) {
  const ind = await industryOf(symbol);
  if (!ind?.sic) throw new Error(`No SEC industry code for ${symbol}.`);
  const ciks = [...new Set([ind.cik, ...(await companiesInSic(ind.sic))])];
  const load = async (y) => Object.fromEntries(await Promise.all(Object.keys(CONCEPTS).map(async (k) => [k, k === "revenue" || y === year ? await concept(k, y, ciks) : {}])));
  let cur = await load(year);
  // Early in a year most filers haven't reported the last calendar year yet; fall back a year.
  if (Object.keys(cur.revenue).length < 5 && !cur.revenue[ind.cik]) { year -= 1; cur = await load(year); }
  const prev = await load(year - 1);
  return { symbol, ...compare({ cik: ind.cik, industry: { sic: ind.sic, description: ind.sicDescription }, year, ciks, cur, prev }) };
}

module.exports = { sectorComps, compare, parseSicPage, parseFrame, stats, CONCEPTS };
