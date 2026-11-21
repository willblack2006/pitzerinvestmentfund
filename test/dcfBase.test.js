// lib/dcf.js starting-FCF choice: mirrors the Valuation tab's "Starting free cash flow" select.
const test = require("node:test");
const assert = require("node:assert/strict");
const { workbench, startingFcf } = require("../lib/dcf");

const dcf = { fcf: 100, fcfAvg3: 80, fcfTtm: 130, fcfTtmEnd: "2026-07-31", fiscalYearEnd: "2026-01-31", shares: 10, cash: 0, debt: 0 };

test("trailing 12 months is used when asked and newer than the fiscal year", () => {
  assert.deepEqual(startingFcf(dcf, "ttm"), { fcf: 130, basis: "trailing 12 months to 2026-07-31" });
  const w = workbench(dcf, { g: 0.05, gT: 0.025, r: 0.09, base: "ttm" });
  assert.equal(w.assumptions.startingFcf, 130);
  assert.match(w.assumptions.startingFcfBasis, /trailing 12 months/);
});

test("falls back to the last fiscal year when TTM is missing or the same period", () => {
  assert.equal(startingFcf({ ...dcf, fcfTtm: null }, "ttm").fcf, 100);
  assert.equal(startingFcf({ ...dcf, fcfTtmEnd: dcf.fiscalYearEnd }, "ttm").fcf, 100);
  assert.equal(startingFcf(dcf, "avg3").basis, "3-year average");
  assert.equal(startingFcf(dcf, "last").basis, "last fiscal year");
});

test("same FCF in two bases still reports the chosen basis", () => {
  // Before, the basis label was inferred by comparing values, so an avg3 equal to the last year read "last fiscal year".
  assert.equal(workbench({ ...dcf, fcfAvg3: 100 }, { g: 0.05, gT: 0.025, r: 0.09, base: "avg3" }).assumptions.startingFcfBasis, "3-year average");
});
