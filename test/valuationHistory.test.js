const test = require("node:test");
const assert = require("node:assert/strict");
const { ttmEpsSeries, peHistory } = require("../lib/valuationHistory");

const q = (end, val) => ({ end, val, form: "10-Q" });
const eps = [q("2023-03-31", 1), q("2023-06-30", 1), q("2023-09-30", 1), q("2023-12-31", 1), q("2024-03-31", 2), q("2024-06-30", 2), q("2024-09-30", 2), q("2024-12-31", 2)];

test("pe history: TTM EPS needs four quarters in a row", () => {
  assert.deepEqual(ttmEpsSeries(eps).map((s) => [s.end, s.eps]), [["2023-12-31", 4], ["2024-03-31", 5], ["2024-06-30", 6], ["2024-09-30", 7], ["2024-12-31", 8]]);
  assert.deepEqual(ttmEpsSeries([eps[0], eps[1], eps[3], eps[4]]), []);
});

test("pe history: uses only EPS that was public at the time, and ranks today against the past", () => {
  const bars = [];
  for (let d = new Date("2024-01-15"); d <= new Date("2025-03-01"); d = new Date(d.getTime() + 7 * 864e5)) bars.push({ date: d.toISOString().slice(0, 10), close: 80 });
  const h = peHistory(eps, bars);
  // 2024-02-05 is 36 days after 2023-12-31, before the lag: that quarter isn't known yet.
  assert.equal(h.points.find((p) => p.date === "2024-01-15"), undefined);
  const early = h.points.find((p) => p.date >= "2024-02-12");
  assert.equal(early.eps, 4);
  assert.equal(h.points.at(-1).eps, 8);
  assert.equal(h.summary.current, 10);
  assert.ok(h.summary.percentile < 0.5, "10x is cheaper than the 20x it traded at before");
  assert.equal(h.summary.min, 10);
});

test("pe history: negative earnings leave gaps instead of fake multiples", () => {
  const loss = eps.map((p) => ({ ...p, val: -1 }));
  const bars = Array.from({ length: 60 }, (_, i) => ({ date: new Date(Date.UTC(2024, 3, 1) + i * 7 * 864e5).toISOString().slice(0, 10), close: 50 }));
  const h = peHistory(loss, bars);
  assert.equal(h.summary, null);
  assert.ok(h.points.every((p) => p.pe === null));
});
