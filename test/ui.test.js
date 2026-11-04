// Pure helpers behind the shared popover and pick list (public/ui/). No DOM needed.
const test = require("node:test");
const assert = require("node:assert/strict");

const load = async () => ({
  P: await import("../public/ui/popover.js"),
  L: await import("../public/ui/pickList.js"),
});

const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
const VIEW = { width: 1000, height: 800 };

test("popover: opens below the anchor, aligned to its start", async () => {
  const { P } = await load();
  const pos = P.computePosition(rect(100, 100, 80, 30), { width: 300, height: 200 }, VIEW);
  assert.equal(pos.side, "bottom");
  assert.equal(pos.left, 100);
  assert.equal(pos.top, 136); // anchor bottom 130 + 6px gap
});

test("popover: flips above when there is no room below", async () => {
  const { P } = await load();
  const pos = P.computePosition(rect(100, 700, 80, 30), { width: 300, height: 300 }, VIEW);
  assert.equal(pos.side, "top");
  assert.equal(pos.top, 700 - 6 - 300);
});

test("popover: stays below when neither side fits but below has more room, and caps height", async () => {
  const { P } = await load();
  const pos = P.computePosition(rect(100, 200, 80, 30), { width: 300, height: 900 }, VIEW);
  assert.equal(pos.side, "bottom");
  assert.equal(pos.maxHeight, 800 - 230 - 6 - 8);
});

test("popover: clamps inside the viewport with an 8px margin", async () => {
  const { P } = await load();
  const right = P.computePosition(rect(900, 100, 80, 30), { width: 300, height: 100 }, VIEW);
  assert.equal(right.left, 1000 - 8 - 300);
  const left = P.computePosition(rect(2, 100, 80, 30), { width: 300, height: 100 }, VIEW, "bottom-end");
  assert.equal(left.left, 8);
  const wide = P.computePosition(rect(50, 100, 80, 30), { width: 1200, height: 100 }, VIEW);
  assert.equal(wide.left, 8);
});

test("popover: bottom-end aligns right edges", async () => {
  const { P } = await load();
  const pos = P.computePosition(rect(500, 100, 80, 30), { width: 300, height: 100 }, VIEW, "bottom-end");
  assert.equal(pos.left, 580 - 300);
});

const ITEMS = [
  { id: "sma", label: "Simple moving average", description: "Average close", group: "Trend", keywords: ["ma"] },
  { id: "rsi", label: "RSI", description: "Relative strength gauge", group: "Momentum" },
  { id: "bb", label: "Bollinger Bands", description: "Volatility bands around a moving average", group: "Volatility" },
  { id: "x", label: "Loose item", description: "" },
  { id: "ema", label: "Exponential moving average", description: "Weighted average", group: "Trend" },
];

test("pickList: filter matches every word, case-insensitive, across label/description/keywords", async () => {
  const { L } = await load();
  assert.deepEqual(L.filterItems(ITEMS, "moving AVERAGE").map((i) => i.id), ["sma", "bb", "ema"]);
  assert.deepEqual(L.filterItems(ITEMS, "moving bands").map((i) => i.id), ["bb"]);
  assert.deepEqual(L.filterItems(ITEMS, "ma close").map((i) => i.id), ["sma"]); // keyword + description
  assert.deepEqual(L.filterItems(ITEMS, "zzz"), []);
  assert.equal(L.filterItems(ITEMS, "   ").length, ITEMS.length);
});

test("pickList: groups follow the given order, extras after, ungrouped last", async () => {
  const { L } = await load();
  const out = L.groupItems(ITEMS, ["Volatility", "Trend"]);
  assert.deepEqual(out.map((g) => g.id), ["Volatility", "Trend", "Momentum", ""]);
  assert.deepEqual(out[1].items.map((i) => i.id), ["sma", "ema"]);
  const labelled = L.groupItems(ITEMS, [{ id: "Trend", label: "Trend lines" }]);
  assert.equal(labelled[0].label, "Trend lines");
  // Empty groups are dropped.
  assert.deepEqual(L.groupItems([ITEMS[1]], ["Trend", "Momentum"]).map((g) => g.id), ["Momentum"]);
});

test("pickList: recent list keeps newest first, dedupes, caps, skips missing ids", async () => {
  const { L } = await load();
  let ids = [];
  for (const id of ["sma", "rsi", "bb", "rsi"]) ids = L.pushRecent(ids, id);
  assert.deepEqual(ids, ["rsi", "bb", "sma"]);
  assert.deepEqual(L.pushRecent(["a", "b", "c"], "d", 3), ["d", "a", "b"]);
  assert.deepEqual(L.recentItems(ITEMS, ["gone", "bb", "sma"]).map((i) => i.id), ["bb", "sma"]);
});

test("pickList: a name match ranks above a description match", async () => {
  const { rankItems, filterItems } = await import("../public/ui/pickList.js");
  const items = [
    { id: "p", label: "Momentum: RSI 14 + MACD", group: "Presets", keywords: ["rsi", "macd"] },
    { id: "macd", label: "MACD", description: "Trend and momentum", group: "Momentum" },
    { id: "rsi", label: "RSI", description: "Momentum from 0 to 100", group: "Momentum" },
  ];
  assert.equal(rankItems(filterItems(items, "rsi"), "rsi")[0].id, "rsi");
  assert.equal(rankItems(filterItems(items, "mom"), "mom")[0].id, "p", "word-start in the name beats description");
});
