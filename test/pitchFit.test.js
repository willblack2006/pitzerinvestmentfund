const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fitCheck } = require("../lib/pitchFit");

const alloc = {
  cashPct: 8,
  settings: { maxPositionPct: 10, maxSectorPct: 30, minCashPct: 5, maxPositions: 3, minPositions: 2 },
  positions: [{ symbol: "AAA", sector: "Tech", weight: 9 }, { symbol: "BBB", sector: "Tech", weight: 18 }],
  sectors: [{ sector: "Tech", weight: 27 }],
};

test("buy that breaks position, sector and cash limits", () => {
  const f = fitCheck(alloc, { symbol: "aaa", direction: "add", sizePct: 4 });
  assert.equal(f.after.position, 13);
  assert.equal(f.after.cash, 4);
  const rules = f.issues.map((i) => i.rule);
  assert.deepEqual(rules.sort(), ["Max position size", "Max sector weight", "Minimum cash"]);
});

test("new name in a new sector within limits", () => {
  const f = fitCheck(alloc, { symbol: "CCC", direction: "buy", sizePct: 3 }, "Health");
  assert.equal(f.after.positions, 3);
  assert.equal(f.after.cash, 5);
  assert.equal(f.issues.length, 0);
});

test("sell exits the position; selling something not held is not ok", () => {
  const f = fitCheck(alloc, { symbol: "AAA", direction: "sell" });
  assert.equal(f.after.position, 0);
  assert.equal(f.after.cash, 17);
  assert.deepEqual(f.issues.map((i) => i.rule), ["Minimum holdings"]); // 2 -> 1 position, below the policy minimum
  assert.equal(fitCheck(alloc, { symbol: "ZZZ", direction: "trim", sizePct: 1 }).ok, false);
});

test("missing size asks for one", () => {
  assert.equal(fitCheck(alloc, { symbol: "CCC", direction: "buy" }).ok, false);
});
