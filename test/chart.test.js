// Pure helpers behind the Research price chart's indicator picker (public/priceTerminal.js).
const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../public/priceTerminal.js");

test("chart: indicator labels use the short name and params", async () => {
  const C = await load();
  assert.equal(C.indicatorLabel({ id: "sma", params: { n: 50 } }), "SMA 50");
  assert.equal(C.indicatorLabel({ id: "macd", params: {} }), "MACD 12, 26, 9");
  assert.equal(C.indicatorLabel({ id: "vol", params: {} }), "Volume");
});

test("chart: a new SMA takes the next common length not on the chart", async () => {
  const C = await load();
  assert.deepEqual(C.defaultParamsFor("sma", []), { n: 50 });
  assert.deepEqual(C.defaultParamsFor("sma", [{ id: "sma", params: { n: 50 } }]), { n: 200 });
  assert.deepEqual(C.defaultParamsFor("sma", [{ id: "sma", params: { n: 50 } }, { id: "sma", params: { n: 200 } }]), { n: 20 });
  assert.deepEqual(C.defaultParamsFor("rsi", [{ id: "rsi", params: { n: 14 } }]), { n: 14 });
  assert.deepEqual(C.defaultParamsFor("bb", []), { n: 20, k: 2 });
});

test("chart: adding skips exact duplicates and drops the oldest past the max", async () => {
  const C = await load();
  const start = [{ id: "sma", params: { n: 50 } }];
  const r = C.addIndicators(start, [{ id: "sma", params: { n: 50 } }, { id: "sma", params: { n: 200 } }]);
  assert.deepEqual(r.added, ["SMA 200"]);
  assert.equal(r.list.length, 2);
  assert.equal(start.length, 1, "does not change the input");
  const full = Array.from({ length: 8 }, (_, i) => ({ id: "ema", params: { n: 10 + i } }));
  const r2 = C.addIndicators(full, [{ id: "rsi", params: { n: 14 } }]);
  assert.equal(r2.list.length, 8);
  assert.deepEqual(r2.dropped, ["EMA 10"]);
  assert.equal(C.countOf(r2.list, "rsi"), 1);
});

test("chart: presets add both parts", async () => {
  const C = await load();
  const trend = C.PRESETS.find((p) => p.id === "preset-trend");
  const r = C.addIndicators([], trend.parts);
  assert.deepEqual(r.added, ["SMA 50", "SMA 200"]);
});

test("chart: settings form values are range-checked", async () => {
  const C = await load();
  assert.deepEqual(C.readParams("sma", { n: "100" }), { params: { n: 100 } });
  assert.match(C.readParams("sma", { n: "1" }).error, /from 2 to 400/);
  assert.match(C.readParams("sma", { n: "" }).error, /needs a number/);
  assert.match(C.readParams("macd", { fast: "30", slow: "26", signal: "9" }).error, /Fast must be shorter/);
  assert.deepEqual(C.readParams("bb", { n: "20", k: "2.5" }), { params: { n: 20, k: 2.5 } });
});
