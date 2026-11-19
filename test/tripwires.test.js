const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pif-tw-")), "test.db");
const { evaluate, describe } = require("../lib/tripwires");

const t = (o) => ({ status: "active", ...o });

test("price tripwires trip at the line, not before", () => {
  assert.match(evaluate(t({ kind: "price_below", value: 50 }), 50, "2026-01-01"), /at or below/);
  assert.equal(evaluate(t({ kind: "price_below", value: 50 }), 50.01, "2026-01-01"), null);
  assert.match(evaluate(t({ kind: "price_above", value: 90 }), 91, "2026-01-01"), /at or above/);
  assert.equal(evaluate(t({ kind: "price_above", value: 90 }), undefined, "2026-01-01"), null, "no price, no trip");
});

test("review date trips on the day, tripped ones stay quiet, custom never auto-trips", () => {
  assert.equal(evaluate(t({ kind: "review_by", dueDate: "2026-03-01" }), 10, "2026-02-28"), null);
  assert.match(evaluate(t({ kind: "review_by", dueDate: "2026-03-01" }), 10, "2026-03-01"), /review date/);
  assert.equal(evaluate({ status: "tripped", kind: "price_below", value: 50 }, 1, "2026-01-01"), null);
  assert.equal(evaluate(t({ kind: "custom", note: "x" }), 1, "2030-01-01"), null);
  assert.equal(describe({ kind: "price_below", value: 50 }), "falls below $50");
});
