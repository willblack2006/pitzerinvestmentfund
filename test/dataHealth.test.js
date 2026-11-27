// Data health API (rebuild plan 1.1): admins only, lists every collector.
const test = require("node:test");
const assert = require("node:assert");
const { startServer } = require("./helpers");

test("data health: admins see collectors; members don't; unknown collector is 404", async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const r = await s.api("/api/admin/data-health", { auth: true });
  assert.equal(r.status, 200);
  assert.ok(r.body.collectors.some((c) => c.name === "finra-short-volume"));
  assert.equal(typeof r.body.warehouse.bytes, "number");
  const m = await s.createMember("Dana");
  assert.equal((await s.api("/api/admin/data-health", { member: m.cookie })).status, 403);
  assert.equal((await s.api("/api/admin/data-health/nope/run", { method: "POST", auth: true })).status, 404);
});
