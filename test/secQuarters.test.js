// Quarterly and trailing-twelve-month numbers built from SEC company facts: fiscal Q4 from
// the 10-K, single quarters from year-to-date cash-flow totals, and FCF that doesn't
// pretend a missing capex figure is zero.
const test = require("node:test");
const assert = require("node:assert/strict");
require("./helpers");
const sec = require("../lib/sources/sec");
const F = require("../lib/fundamentals");

const f = (start, end, val, form, filed) => ({ start, end, val, form, filed: filed || end });
const facts = (tag, units) => ({ "us-gaap": { [tag]: { units: { USD: units } } } });

// Fiscal year 2025 (calendar). Income statement: three discrete quarters plus the year.
const income = facts("Revenues", [
  f("2025-01-01", "2025-03-31", 100, "10-Q"), f("2025-04-01", "2025-06-30", 110, "10-Q"), f("2025-07-01", "2025-09-30", 120, "10-Q"),
  f("2025-01-01", "2025-06-30", 210, "10-Q"), f("2025-01-01", "2025-09-30", 330, "10-Q"), // year-to-date copies are ignored
  f("2025-01-01", "2025-12-31", 470, "10-K"),
]);
// Cash flow: only year-to-date totals, as in a real 10-Q.
const cash = facts("NetCashProvidedByUsedInOperatingActivities", [
  f("2025-01-01", "2025-03-31", 20, "10-Q"), f("2025-01-01", "2025-06-30", 50, "10-Q"), f("2025-01-01", "2025-09-30", 90, "10-Q"),
  f("2025-01-01", "2025-12-31", 140, "10-K"),
]);

test("sec: fiscal Q4 is the year minus the first three quarters", () => {
  const q = sec._pick(income, ["Revenues"]).filter((p) => p.form === "10-Q");
  assert.deepEqual(q.map((p) => [p.end, p.val]), [["2025-03-31", 100], ["2025-06-30", 110], ["2025-09-30", 120], ["2025-12-31", 140]]);
  assert.equal(q.at(-1).derived, true);
});

test("sec: year-to-date cash-flow totals are differenced into single quarters", () => {
  const q = sec._pick(cash, ["NetCashProvidedByUsedInOperatingActivities"], { cumulative: true }).filter((p) => p.form === "10-Q");
  assert.deepEqual(q.map((p) => [p.end, p.val]), [["2025-03-31", 20], ["2025-06-30", 30], ["2025-09-30", 40], ["2025-12-31", 50]]);
});

test("sec: no Q4 is guessed when a quarter is missing", () => {
  const partial = facts("Revenues", [f("2025-01-01", "2025-03-31", 100, "10-Q"), f("2025-07-01", "2025-09-30", 120, "10-Q"), f("2025-01-01", "2025-12-31", 470, "10-K")]);
  const q = sec._pick(partial, ["Revenues"]).filter((p) => p.form === "10-Q");
  assert.equal(q.length, 2);
});

const fy = (end, val) => ({ end, val, form: "10-K" });
const qs = (arr) => arr.map(([end, val]) => ({ end, val, form: "10-Q" }));
const base = {
  companyName: "T", revenue: [fy("2025-12-31", 470), ...qs([["2025-03-31", 100], ["2025-06-30", 110], ["2025-09-30", 120], ["2025-12-31", 140]])],
  operatingCashFlow: [fy("2025-12-31", 140), ...qs([["2025-03-31", 20], ["2025-06-30", 30], ["2025-09-30", 40], ["2025-12-31", 50]])],
  capex: [fy("2025-12-31", 40), ...qs([["2025-03-31", 10], ["2025-06-30", 10], ["2025-09-30", 10], ["2025-12-31", 10]])],
  stockComp: [fy("2025-12-31", 12), ...qs([["2025-03-31", 3], ["2025-06-30", 3], ["2025-09-30", 3], ["2025-12-31", 3]])],
};

test("fundamentals: trailing twelve months sums the last four quarters", () => {
  const a = F.analyze(base);
  assert.equal(a.ttm.revenue, 470);
  assert.equal(a.ttm.fcf, 100);
  assert.equal(a.ttm.fcfAfterSbc, 88);
  assert.equal(a.ttm.end, "2025-12-31");
});

test("fundamentals: no TTM when the quarters are not four in a row", () => {
  const gap = { ...base, revenue: base.revenue.filter((p) => p.end !== "2025-06-30") };
  assert.equal(F.analyze(gap).ttm, null);
});

test("fundamentals: missing capex leaves free cash flow unknown instead of equal to operating cash flow", () => {
  const a = F.analyze({ ...base, capex: [] });
  assert.equal(a.annual.at(-1).fcf, null);
  assert.equal(a.ttm.fcf, null);
  assert.equal(F.analyze(base).annual.at(-1).fcf, 100);
});
