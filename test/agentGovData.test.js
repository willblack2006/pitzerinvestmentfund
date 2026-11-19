// Agent government and macro data: lobbying, FDA, Federal Register, wider FRED series, backtests.
// Every outside service is mocked with the response shape its documentation describes.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pif-agentc-")), "agentc.db");

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

test("lobbying, FDA and Federal Register parse their documented shapes", async () => {
  const g = require("../lib/sources/govData");
  const lda = g.parseLda({ results: [{ filing_year: 2026, filing_period_display: "2nd Quarter (Apr 1 - June 30)", filing_type_display: "2nd Quarter - Report", registrant: { name: "Akin" }, client: { name: "MICRON TECHNOLOGY" }, income: "120000.00", expenses: null,
    lobbying_activities: [{ general_issue_code_display: "Trade (domestic/foreign)", description: "CHIPS Act implementation", government_entities: [{ name: "Commerce, Dept of (DOC)" }] }], dt_posted: "2026-07-20T10:00:00-04:00" }] });
  assert.equal(lda[0].amountUsd, 120000);
  assert.equal(lda[0].amountKind, "paid to lobbying firm");
  assert.deepEqual(lda[0].agencies, ["Commerce, Dept of (DOC)"]);
  const rec = g.parseRecalls({ results: [{ report_date: "20260812", recalling_firm: "Eli Lilly and Company", classification: "Class II", reason_for_recall: "Subpotent", product_description: "Insulin" }] });
  assert.equal(rec[0].date, "2026-08-12");
  const ap = g.parseApprovals({ results: [{ application_number: "NDA1", sponsor_name: "ELI LILLY AND CO", products: [{ brand_name: "ZEPBOUND" }], submissions: [{ submission_status: "AP", submission_status_date: "20260301", submission_type: "SUPPL" }, { submission_status: "TA", submission_status_date: "20260401" }] }] });
  assert.deepEqual(ap.map((x) => [x.brand, x.date]), [["ZEPBOUND", "2026-03-01"]]);
  const fr = g.parseFedReg({ results: [{ title: "Export controls on advanced computing items", type: "Rule", publication_date: "2026-10-02", agencies: [{ name: "Industry and Security Bureau" }], html_url: "https://www.federalregister.gov/d/2026-1" }] });
  assert.equal(fr[0].agencies[0], "Industry and Security Bureau");

  mock({ "lda.gov/api/v1/filings": { results: [{ filing_year: 2026, client: { name: "MICRON" }, expenses: "500000" }] } });
  const r = await tools.callTool("get_lobbying", { symbol: "MU" });
  assert.equal(r.error, undefined, r.error);
  assert.equal(r.data.searchedAs, "MICRON TECHNOLOGY");
  assert.ok(seen[0].includes("client_name=MICRON%20TECHNOLOGY"));
  assert.equal(r.data.totalReportedByYear[2026], 1000000, "two years requested, both mocked with the same filing");

  mock({ "api.fda.gov/drug/enforcement": { results: [{ report_date: "20260812", recalling_firm: "Eli Lilly", classification: "Class II" }] } });
  const fda = await tools.callTool("get_fda_activity", { symbol: "LLY" });
  assert.equal(fda.data.drugRecalls.length, 1);
  assert.deepEqual(fda.data.deviceRecalls, [], "a 404 (no matches) is an empty list");

  mock({ "federalregister.gov/api/v1/documents.json": { count: 1, results: [{ title: "T", type: "Rule", publication_date: "2026-10-02", html_url: "https://www.federalregister.gov/d/1" }] } });
  const reg = await tools.callTool("search_federal_register", { query: "semiconductor export" });
  assert.equal(reg.data.documents[0].title, "T");
  assert.ok(seen[0].includes("conditions[term]=semiconductor%20export"));
});

test("FRED detail: every series monthly with its transform; one failing series doesn't sink the rest", async () => {
  process.env.FRED_API_KEY = "k";
  mock({ "series_id=": { observations: [{ date: "2026-10-01", value: "4.1" }, { date: "2026-09-01", value: "." }, { date: "2026-08-01", value: "4.3" }] } });
  routes["series_id=VIXCLS"] = undefined; // not mocked → 404
  delete routes["series_id=VIXCLS"];
  global.fetch = async (url) => { const u = String(url); seen.push(u); if (u.includes("VIXCLS")) return new Response("x", { status: 500 }); return new Response(JSON.stringify(routes["series_id="]), { status: 200 }); };
  const r = await tools.callTool("get_macro_detail", {});
  const s = r.data.series;
  assert.deepEqual(s.unemployment.observations.map((o) => o.date), ["2026-08-01", "2026-10-01"], "oldest first, missing values dropped");
  assert.equal(s.unemployment.latest.value, 4.1);
  assert.match(s.vix.error, /500/);
  assert.ok(seen.some((u) => u.includes("series_id=CPIAUCSL") && u.includes("units=pc1")), "CPI as % year over year");
  assert.ok(seen.some((u) => u.includes("series_id=PAYEMS") && u.includes("units=chg")));
});

test("backtest: Yahoo-valid ranges (a 7-year request used to ask Yahoo for '7y')", () => {
  const { yahooRange } = require("../routes/backtest");
  assert.deepEqual([1, 2, 3, 5, 7, 10].map(yahooRange), ["1y", "2y", "5y", "5y", "10y", "10y"]);
});
