const { test } = require("node:test");
const assert = require("node:assert/strict");
const { tripwiresFor, review } = require("../lib/pitchReview");

const p = { id: 7, symbol: "ZZR", direction: "buy", status: "executed", createdAt: "2026-01-01 00:00:00", priceAtPitch: 100, basePrice: 140, bearPrice: 80, horizonMonths: 12, killCriteria: "Sell if margins < 20% by Dec 2026" };

test("an executed buy leaves three tripwires; sells and trims leave none", () => {
  const t = tripwiresFor(p);
  assert.deepEqual(t.map((x) => x.kind), ["custom", "price_below", "review_by"]);
  assert.equal(t[1].value, 80);
  assert.equal(t[2].dueDate, "2026-12-27");
  assert.deepEqual(tripwiresFor({ ...p, direction: "sell" }), []);
  assert.deepEqual(tripwiresFor({ ...p, killCriteria: "", bearPrice: null, horizonMonths: null }), []);
});

test("review: hit, on track, behind, missed", () => {
  assert.equal(review(p, 145, "2026-03-01").state, "hit");
  assert.equal(review(p, 112, "2026-04-01").state, "on_track"); // 30% of the way at a quarter of the time
  assert.equal(review(p, 101, "2026-09-01").state, "behind");
  assert.equal(review(p, 110, "2027-02-01").state, "missed");
  const r = review(p, 112, "2026-04-01", [{ status: "tripped", note: "Kill criteria: x" }]);
  assert.deepEqual(r.tripped, ["Kill criteria: x"]);
  assert.equal(review({ ...p, status: "draft" }, 112, "2026-04-01"), null);
});
