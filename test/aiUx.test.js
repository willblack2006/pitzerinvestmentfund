// AI user experience: the pure helpers behind Ask PIF's sources, progress and suggested
// questions (public/aiFormat.js), and the live-run endpoint the pages poll while an agent works.
const test = require("node:test");
const assert = require("node:assert/strict");
const { startServer } = require("./helpers");

const load = () => import("../public/aiFormat.js");

test("AI format: sources read as page names, not URLs", async () => {
  const { sourceLabel } = await load();
  assert.equal(sourceLabel("#/holdings"), "Holdings");
  assert.equal(sourceLabel("#/research/NVDA/ownership"), "NVDA · Ownership");
  assert.equal(sourceLabel("#/research/BRK-B"), "BRK-B · Research");
  assert.equal(sourceLabel("#/pitches/12"), "Pitch #12");
  assert.equal(sourceLabel("https://www.sec.gov/Archives/edgar/data/1045810/x.htm"), "SEC filing");
  assert.equal(sourceLabel("https://fred.stlouisfed.org/series/DGS10"), "fred.stlouisfed.org");
  assert.equal(sourceLabel("not a url"), "source");
});

test("AI format: tool calls and run steps become plain progress lines", async () => {
  const { toolLabel, progressLines } = await load();
  assert.equal(toolLabel("get_insider_activity", { symbol: "mu" }), "insider trades for MU");
  assert.equal(toolLabel("get_some_new_tool"), "some new tool");
  const lines = progressLines([
    { kind: "model", toolCalls: ["get_holdings"] },
    { kind: "tool", name: "get_holdings", ok: true },
    { kind: "tool", name: "get_risk", args: { symbol: "NVDA" }, ok: false },
    { kind: "source" },
    { kind: "model", toolCalls: [] },
  ]);
  assert.deepEqual(lines.map((l) => l.text), ["Read the fund's holdings", "Couldn't read risk statistics for NVDA", "Read the filing", "Drafted the answer"]);
  assert.equal(lines[1].bad, true);
});

test("AI format: suggested questions follow the page", async () => {
  const { suggestedQuestions, routeSymbol } = await load();
  assert.equal(routeSymbol("#/research/nvda/filings"), "NVDA");
  assert.equal(routeSymbol("#/pitches/new/MU"), "MU");
  assert.equal(routeSymbol("#/today"), null);
  assert.match(suggestedQuestions({ hash: "#/research/ORCL" })[0], /ORCL/);
  assert.ok(suggestedQuestions({ hash: "#/today" }).some((q) => /earnings/.test(q)));
  assert.ok(suggestedQuestions({ symbol: null, hash: "#/research/ORCL" }).every((q) => !/ORCL/.test(q)), "null means fund-wide");
});

test("API: runs-live shows only the member's own running run, with its steps", async () => {
  const s = await startServer();
  try {
    assert.equal((await s.api("/api/agents/runs-live")).status, 401);
    assert.deepEqual((await s.api("/api/agents/runs-live", { auth: true })).body, { run: null });
    const other = await s.createMember("Other");
    const db = require("libsql");
    const conn = new db(s.dbPath);
    const steps = JSON.stringify([{ at: new Date().toISOString(), kind: "tool", name: "get_holdings", args: {}, ok: true, source_url: "#/holdings", error: undefined }]);
    conn.prepare("INSERT INTO agent_runs (workflow, memberId, symbol, status, steps) VALUES ('ask_pif', 1, NULL, 'running', ?)").run(steps);
    conn.prepare("INSERT INTO agent_runs (workflow, memberId, symbol, status, steps) VALUES ('red_team', 1, 'NVDA', 'done', '[]')").run();
    conn.prepare("INSERT INTO agent_runs (workflow, memberId, symbol, status, steps) VALUES ('ask_pif', ?, NULL, 'running', '[]')").run(other.id);
    conn.close();
    const mine = await s.api("/api/agents/runs-live?workflow=ask_pif", { auth: true });
    assert.equal(mine.status, 200);
    assert.equal(mine.body.run.workflow, "ask_pif");
    assert.deepEqual(mine.body.run.steps.map((x) => x.name), ["get_holdings"]);
    assert.equal(mine.body.run.steps[0].source_url, undefined, "only what the progress list needs");
    assert.deepEqual((await s.api("/api/agents/runs-live?workflow=red_team", { auth: true })).body, { run: null }, "finished runs aren't live");
    assert.equal((await s.api("/api/agents/runs-live", { member: other.cookie })).status, 403, "AI access is still required");
  } finally { await s.stop(); }
});
