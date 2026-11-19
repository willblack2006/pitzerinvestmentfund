// Agent data sources: earnings releases and transcripts, and the asking member's own notes.
// Every outside service is mocked with the response shape its documentation describes.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pif-agenta-")), "agenta.db");

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

test("earnings call: free route reads the press release exhibit of the latest Item 2.02 8-K", async () => {
  setCached("sec_filings_all_MU", [
    { form: "8-K", filingDate: "2026-10-01", items: "5.02", accession: "a1", url: "https://www.sec.gov/Archives/edgar/data/723125/0001/a.htm" },
    { form: "8-K", filingDate: "2026-09-24", reportDate: "2026-08-28", items: "2.02,9.01", accession: "a2", url: "https://www.sec.gov/Archives/edgar/data/723125/0002/mu-8k.htm" },
  ], 3600, "test");
  mock({
    "/0002/index.json": { directory: { item: [{ name: "mu-8k.htm" }, { name: "ex991.htm" }] } },
    "/0002/ex991.htm": "<p>Micron reports record revenue of $11.3 billion.</p><p>Guidance: revenue of $12.5 billion.</p>",
  });
  const r = await tools.callTool("get_earnings_call", { symbol: "MU" });
  assert.equal(r.error, undefined, r.error);
  assert.match(r.data.text, /record revenue of \$11\.3 billion/);
  assert.equal(r.data.pressRelease.filingDate, "2026-09-24");
  assert.match(r.data.transcript.unavailable, /No transcript feed/);
  assert.equal(r.source_url, "https://www.sec.gov/Archives/edgar/data/723125/0002/ex991.htm");
  assert.ok(r.fullText.includes("Guidance"), "full text kept for quote checks");
});

test("earnings call: with FMP_API_KEY the newest transcript comes first, and the key never shows", async () => {
  process.env.FMP_API_KEY = "secret-key";
  mock({
    "earning-call-transcript-dates": [{ quarter: 3, fiscalYear: 2026, date: "2026-06-25" }, { quarter: 4, fiscalYear: 2026, date: "2026-09-24" }],
    "earning-call-transcript?symbol=MU&year=2026&quarter=4": [{ symbol: "MU", period: "Q4", year: 2026, date: "2026-09-24 16:30:00", content: "Sanjay Mehrotra: HBM is sold out for calendar 2027." }],
    "/0002/index.json": { directory: { item: [{ name: "ex991.htm" }] } },
    "/0002/ex991.htm": "<p>Press release text.</p>",
  });
  const r = await tools.callTool("get_earnings_call", { symbol: "MU" });
  assert.deepEqual([r.data.transcript.quarter, r.data.transcript.year], [4, 2026]);
  assert.match(r.data.text, /^\[Earnings call transcript, Q4 2026/);
  assert.match(r.data.text, /Press release text/);
  assert.ok(!JSON.stringify(r).includes("secret-key"), "API key stays out of everything the model sees");
  assert.ok(seen.some((u) => u.includes("apikey=secret-key")));
});

test("my notes: the asking member's notes and club-shared notes, never another member's private notes", async () => {
  const me = Number(db.prepare("INSERT INTO members (name, role, pinHash) VALUES ('Me', 'Analyst', '')").run().lastInsertRowid);
  const other = Number(db.prepare("INSERT INTO members (name, role, pinHash) VALUES ('Other', 'Analyst', '')").run().lastInsertRowid);
  const add = db.prepare("INSERT INTO notes (memberId, symbol, body, visibility) VALUES (?, ?, ?, ?)");
  add.run(me, "MU", "my private MU note", "private");
  add.run(other, "MU", "other's private note", "private");
  add.run(other, "MU", "other's shared note", "club");
  add.run(me, "NVDA", "NVDA thoughts 50%_off", "private");
  const r = await tools.callTool("get_my_notes", { symbol: "MU", query: "" }, { memberId: me });
  assert.deepEqual(r.data.notes.map((n) => n.body).sort(), ["my private MU note", "other's shared note"]);
  assert.equal(r.data.notes.find((n) => n.mine).author, "you");
  const q = await tools.callTool("get_my_notes", { symbol: "", query: "50%_" }, { memberId: me });
  assert.deepEqual(q.data.notes.map((n) => n.body), ["NVDA thoughts 50%_off"], "LIKE wildcards in the search are literal");
  assert.match((await tools.callTool("get_my_notes", { symbol: "", query: "" })).error, /signed-in member/, "no member, no notes");
});

test("my notes: a run passes its member to tools", async () => {
  const runs = require("../lib/agents/runs");
  const id = Number(db.prepare("INSERT INTO members (name, role, pinHash) VALUES ('Asker2', 'Analyst', '')").run().lastInsertRowid);
  db.prepare("INSERT INTO notes (memberId, symbol, body) VALUES (?, 'AMD', 'amd note')").run(id);
  const out = await runs.run({ workflow: "t", memberId: id }, (ctx) => ctx.tool("get_my_notes", { symbol: "AMD", query: "" }));
  assert.equal(out.output.data.notes[0].body, "amd note");
});
