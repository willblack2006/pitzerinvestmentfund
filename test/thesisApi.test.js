// Thesis API end to end on a throwaway server: pillars, member overrides with evidence, catalysts,
// scenario marks, the timeline and the board.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startServer } = require("./helpers");

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.stop(); });

test("thesis API: pillars, override, catalysts, scenario, timeline, board", async () => {
  const anon = await srv.api("/api/theses");
  assert.equal(anon.status, 401);
  const bad = await srv.api("/api/theses/NVDA/pillars", { method: "POST", auth: true, body: { text: "Revenue grows", kpi: { metric: "nope", op: ">", value: 1 } } });
  assert.equal(bad.status, 400);
  const p = await srv.api("/api/theses/nvda/pillars", { method: "POST", auth: true, body: { text: "Revenue keeps growing 20%+ a year", kpi: { metric: "fundamentals.revenueGrowthYoY", op: ">=", value: 0.2 } } });
  assert.equal(p.status, 201); assert.equal(p.body.symbol, "NVDA");
  const noEvidence = await srv.api(`/api/theses/pillars/${p.body.id}/status`, { method: "POST", auth: true, body: { status: "weakened", note: "meh" } });
  assert.equal(noEvidence.status, 400);
  const ov = await srv.api(`/api/theses/pillars/${p.body.id}/status`, { method: "POST", auth: true, body: { status: "weakened", note: "Guidance cut on the Q3 call." } });
  assert.equal(ov.status, 200); assert.equal(ov.body.pillar.status, "weakened");
  const cat = await srv.api("/api/theses/NVDA/catalysts", { method: "POST", auth: true, body: { text: "Blackwell ramp", dueDate: "2027-02-15" } });
  assert.equal(cat.status, 201);
  assert.equal((await srv.api(`/api/theses/catalysts/${cat.body.id}`, { method: "POST", auth: true, body: { status: "hit" } })).body.status, "hit");
  assert.equal((await srv.api("/api/theses/NVDA/scenario", { method: "POST", auth: true, body: { bullProb: 30, baseProb: 50, bearProb: 20 } })).status, 201);
  await srv.api("/api/research/NVDA/thesis", { method: "PUT", auth: true, body: { author: "Test", thesis: "First thesis text" } });
  const t = await srv.api("/api/theses/NVDA", { auth: true });
  assert.equal(t.status, 200);
  assert.equal(t.body.pillars.length, 1);
  assert.equal(t.body.checks[0].method, "member");
  assert.equal(t.body.marks[0].bullProb, 0.3);
  assert.equal(t.body.versions[0].text, "First thesis text");
  assert.equal(t.body.catalysts[0].state, "hit");
  const b = await srv.api("/api/theses", { auth: true });
  assert.ok(b.body.rows.some((r) => r.symbol === "NVDA" && r.status === "weakened"));
  const m = await srv.api("/api/theses/metrics", { auth: true });
  assert.ok(m.body.metrics.some((x) => x.name === "fundamentals.grossMargin"));
  const feed = await srv.api("/api/theses/NVDA", { auth: true });
  assert.equal(feed.status, 200);
});
