// Agent valuation tools: the server-side DCF and industry comparisons from SEC XBRL frames.
// Every outside service is mocked with the response shape its documentation describes.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pif-agentb-")), "agentb.db");

const db = require("../db");
const tools = require("../lib/agents/tools");
const { setCached } = require("../lib/cache");

const realFetch = global.fetch;
let routes = {};
let seen = [];
function mock(r) {
  routes = r; seen = [];
  global.fetch = async (url) => {
    const u = String(url);
    seen.push(u);
    const key = Object.keys(routes).find((k) => u.includes(k));
    if (!key) return new Response("not mocked", { status: 404 });
    const v = routes[key];
    return typeof v === "string" ? new Response(v, { status: 200 }) : new Response(JSON.stringify(v), { status: 200 });
  };
}
test.afterEach(() => { global.fetch = realFetch; delete process.env.FMP_API_KEY; delete process.env.FRED_API_KEY; });

// The SEC ticker directory every company lookup starts from.
setCached("sec_company_directory", [{ ticker: "MU", cik: "0000723125", name: "MICRON TECHNOLOGY INC" }, { ticker: "LLY", cik: "0000059478", name: "ELI LILLY & Co" }], 3600, "test");

test("DCF: same math as the Valuation tab, defaults, reverse DCF and sensitivity", async () => {
  const { dcfValue, workbench } = require("../lib/dcf");
  // 100 FCF, flat growth, r 10%, gT 0: value = 100/0.1 = 1000 in total.
  const flat = dcfValue({ fcf: 100, g: 0, gT: 0, r: 0.1, shares: 10, netCash: 0 });
  assert.ok(Math.abs(flat.perShare - 100) < 1e-9);
  assert.equal(dcfValue({ fcf: 100, g: 0.05, gT: 0.1, r: 0.09, shares: 1 }), null, "r must exceed terminal growth");
  const w = workbench({ fcf: 100, shares: 10, cash: 50, debt: 0 }, { price: 110, g: 0, gT: 0, r: 0.1 });
  assert.equal(w.valuePerShare, 105);
  assert.ok(Math.abs(w.impliedGrowthAtPrice) < 0.05 && w.impliedGrowthAtPrice > 0, "a price above value implies some growth");
  assert.equal(w.sensitivity.valuePerShare.length, 5);
  assert.equal(w.sensitivity.valuePerShare[2][2], 105, "the middle cell is the base case");

  tools.setBaseUrl("http://app.test");
  mock({ "http://app.test/api/research/MU": { symbol: "MU", quote: { price: 110 }, profile: { sector: "Technology" }, analysis: { dcf: { fcf: 100, shares: 10, cash: 50, debt: 0, revenueCagr: 0.3 } }, street: { estimates: [{ period: "+1y", growth: 0.4 }] } } });
  const r = await tools.callTool("get_dcf", { symbol: "MU", growth: null, terminalGrowth: null, discountRate: null, useThreeYearAverageFcf: false });
  assert.equal(r.data.assumptions.growthYears1to5, 0.25, "analyst growth clamped to 25% like the page");
  assert.equal(r.data.assumptions.discountRate, 0.09);
  assert.equal(r.source_url, "#/research/MU/valuation");
  const custom = await tools.callTool("get_dcf", { symbol: "MU", growth: 0, terminalGrowth: 0, discountRate: 0.1, useThreeYearAverageFcf: false });
  assert.equal(custom.data.valuePerShare, 105);
});

test("industry comparison: SIC list and XBRL frames parse; percentile and quartiles", () => {
  const { parseSicPage, parseFrame, compare, stats } = require("../lib/sectorComps");
  assert.deepEqual(parseSicPage('<a href="/cgi-bin/browse-edgar?action=getcompany&CIK=0000723125&type=10-K">x</a> CIK=0000002488 CIK=0000723125'), ["0000723125", "0000002488"]);
  const f = parseFrame({ data: [{ cik: 723125, entityName: "Micron", end: "2025-12-31", val: 100 }] });
  assert.equal(f["0000723125"].val, 100);
  assert.deepEqual(stats([1, 2, 3, 4, 5]), { n: 5, p25: 2, median: 3, p75: 4 });
  const rev = (v) => ({ val: v, name: `C${v}` });
  const cur = { revenue: { a: rev(100), b: rev(200), c: rev(400), me: rev(300) }, grossProfit: { a: { val: 10 }, b: { val: 60 }, c: { val: 200 }, me: { val: 210 } }, operatingIncome: {}, netIncome: {}, ocf: {}, capex: {}, rnd: {} };
  const prev = { revenue: { me: rev(150), a: rev(100) } };
  const out = compare({ cik: "me", industry: { sic: "3674" }, year: 2025, ciks: ["a", "b", "c", "me"], cur, prev });
  assert.equal(out.company.grossMargin, 0.7);
  assert.equal(out.company.revenueGrowth, 1);
  assert.equal(out.percentileVsIndustry.grossMargin, 1, "70% beats 10%, 30% and 50%");
  assert.equal(out.industryStats.grossMargin.median, 0.3);
  assert.equal(out.largestByRevenue[0].name, "C400");
});
