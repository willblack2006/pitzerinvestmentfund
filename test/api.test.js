// End-to-end API tests against a real server + throwaway database. These don't depend on
// external market data (where a route fetches prices, offline failures must degrade, not crash).
const test = require("node:test");
const assert = require("node:assert/strict");
const { startServer, PASSWORD } = require("./helpers");

let s;
test.before(async () => { s = await startServer(); });
test.after(async () => { await s?.stop(); });

test("static app and SPA shell are served", async () => {
  const r = await fetch(s.base + "/");
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /<main id="view"/);
  for (const f of ["/app.js", "/style.css", "/views/research.js", "/views/research/valuation.js", "/charts.js"]) {
    assert.equal((await fetch(s.base + f)).status, 200, f);
  }
});

test("login: right and wrong password", async () => {
  assert.equal((await s.api("/api/login", { method: "POST", body: { password: PASSWORD } })).status, 200);
  assert.equal((await s.api("/api/login", { method: "POST", body: { password: "nope" } })).status, 401);
  assert.equal((await s.api("/api/login", { method: "POST", body: {} })).status, 401);
});

test("malformed JSON gets a 400 JSON error, not a crash", async () => {
  const r = await s.api("/api/login", { method: "POST", body: "{not json" });
  assert.equal(r.status, 400);
  assert.ok(r.body?.error);
  assert.equal((await s.api("/api/positions")).status, 200, "server still up");
});

test("unknown API route returns 404", async () => {
  const r = await s.api("/api/does-not-exist");
  assert.equal(r.status, 404);
});

test("positions: seeded, writes require auth, validation", async () => {
  const list = await s.api("/api/positions");
  assert.equal(list.status, 200);
  assert.ok(list.body.length >= 30, "seed data present");

  assert.equal((await s.api("/api/positions", { method: "POST", body: { symbol: "TST", shares: 1 } })).status, 401);
  assert.equal((await s.api("/api/positions", { method: "POST", auth: true, body: { symbol: "TST", shares: 0 } })).status, 400);
  assert.equal((await s.api("/api/positions", { method: "POST", auth: true, body: { symbol: "TST", shares: -5 } })).status, 400);
  assert.equal((await s.api("/api/positions", { method: "POST", auth: true, body: { symbol: "TST" } })).status, 400);

  const created = await s.api("/api/positions", { method: "POST", auth: true, body: { symbol: "tst", shares: 10, avgCost: 5, totalCost: 50, lastPrice: 6, marketValue: 60 } });
  assert.equal(created.status, 201);
  assert.equal(created.body.symbol, "TST");
  assert.equal((await s.api("/api/positions", { method: "POST", auth: true, body: { symbol: "TST", shares: 1 } })).status, 409);

  const upd = await s.api(`/api/positions/${created.body.id}`, { method: "PUT", auth: true, body: { shares: 12, notes: "<b>x</b>" } });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.shares, 12);
  assert.equal(upd.body.notes, "<b>x</b>", "stored verbatim; escaping is the UI's job");
  assert.equal((await s.api(`/api/positions/${created.body.id}`, { method: "PUT", auth: true, body: { shares: 0 } })).status, 400);
  assert.equal((await s.api(`/api/positions/999999`, { method: "PUT", auth: true, body: { shares: 1 } })).status, 404);
  assert.equal((await s.api(`/api/positions/${created.body.id}`, { method: "DELETE", auth: true })).status, 204);
  assert.equal((await s.api(`/api/positions/${created.body.id}`, { method: "DELETE", auth: true })).status, 404);
});

test("watchlist: add, duplicate, remove", async () => {
  assert.equal((await s.api("/api/watchlist", { method: "POST", body: { symbol: "NVDA" } })).status, 401);
  const a = await s.api("/api/watchlist", { method: "POST", auth: true, body: { symbol: "nvda", sourcedFrom: "test" } });
  assert.equal(a.status, 201);
  assert.equal((await s.api("/api/watchlist", { method: "POST", auth: true, body: { symbol: "NVDA" } })).status, 409);
  assert.equal((await s.api("/api/watchlist", { method: "POST", auth: true, body: {} })).status, 400);
  assert.equal((await s.api(`/api/watchlist/${a.body.id}`, { method: "DELETE", auth: true })).status, 204);
});

test("settings: validation and benchmark normalization", async () => {
  const g = await s.api("/api/settings");
  assert.equal(g.body.maxPositionPct, null, "new installs start with no policy limits");
  assert.equal(g.body.benchmark, "SPY");
  assert.equal(g.body.benchmarkLabel, "S&P 500");
  assert.equal((await s.api("/api/settings", { method: "PUT", body: { maxPositionPct: 5 } })).status, 401);
  assert.equal((await s.api("/api/settings", { method: "PUT", auth: true, body: { maxPositionPct: -1 } })).status, 400);
  assert.equal((await s.api("/api/settings", { method: "PUT", auth: true, body: { maxPositionPct: "abc" } })).status, 400);
  assert.equal((await s.api("/api/settings", { method: "PUT", auth: true, body: { benchmark: "SPY:bad" } })).status, 400);
  const ok = await s.api("/api/settings", { method: "PUT", auth: true, body: { benchmark: "spy:60, agg:40", maxPositionPct: 12 } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.benchmark, "SPY:60,AGG:40");
  assert.equal(ok.body.maxPositionPct, 12);
  // Unknown keys are ignored rather than stored.
  await s.api("/api/settings", { method: "PUT", auth: true, body: { evil: 1 } });
  assert.equal((await s.api("/api/settings")).body.evil, undefined);
  await s.api("/api/settings", { method: "PUT", auth: true, body: { benchmark: "SPY", maxPositionPct: 10 } });
  const cat = await s.api("/api/benchmarks");
  assert.ok(cat.body.presets.length >= 8);
});

test("transactions: ledger updates holdings and cash, deletes reverse exactly", async () => {
  const cash0 = (await s.api("/api/settings")).body.cash;
  const dep = await s.api("/api/transactions", { method: "POST", auth: true, body: { type: "deposit", amount: 10000, date: "2026-01-02" } });
  assert.equal(dep.status, 201);
  const buy = await s.api("/api/transactions", { method: "POST", auth: true, body: { type: "buy", symbol: "zzq", shares: 10, price: 100, amount: 5, date: "2026-01-03" } });
  assert.equal(buy.status, 201);
  let pos = (await s.api("/api/positions")).body.find((p) => p.symbol === "ZZQ");
  assert.equal(pos.shares, 10);
  assert.equal(pos.avgCost, 100);
  assert.equal((await s.api("/api/settings")).body.cash, cash0 + 10000 - 1005);

  const buy2 = await s.api("/api/transactions", { method: "POST", auth: true, body: { type: "buy", symbol: "ZZQ", shares: 10, price: 200 } });
  pos = (await s.api("/api/positions")).body.find((p) => p.symbol === "ZZQ");
  assert.equal(pos.shares, 20);
  assert.equal(pos.avgCost, 150, "average cost blends");

  const sell = await s.api("/api/transactions", { method: "POST", auth: true, body: { type: "sell", symbol: "ZZQ", shares: 5, price: 180 } });
  assert.equal(sell.status, 201);
  assert.equal(sell.body.costBasis, 750);
  assert.equal(sell.body.realizedGain, 150);
  pos = (await s.api("/api/positions")).body.find((p) => p.symbol === "ZZQ");
  assert.equal(pos.shares, 15);
  assert.equal(pos.avgCost, 150, "avg cost unchanged by a sell");

  assert.equal((await s.api("/api/transactions", { method: "POST", auth: true, body: { type: "sell", symbol: "ZZQ", shares: 99, price: 1 } })).status, 400, "can't oversell");
  assert.equal((await s.api("/api/transactions", { method: "POST", auth: true, body: { type: "sell", symbol: "NOPE", shares: 1, price: 1 } })).status, 400);
  assert.equal((await s.api("/api/transactions", { method: "POST", auth: true, body: { type: "teleport", amount: 1 } })).status, 400);
  assert.equal((await s.api("/api/transactions", { method: "POST", auth: true, body: { type: "buy", symbol: "ZZQ", shares: -1, price: 1 } })).status, 400);
  assert.equal((await s.api("/api/transactions", { method: "POST", auth: true, body: { type: "deposit", amount: 0 } })).status, 400);

  const div = await s.api("/api/transactions", { method: "POST", auth: true, body: { type: "dividend", symbol: "ZZQ", amount: 12.5 } });
  assert.equal(div.status, 201);
  assert.equal((await s.api("/api/positions")).body.find((p) => p.symbol === "ZZQ").divIncome, 12.5);

  // Reverse everything, newest first, and land exactly where we started.
  for (const t of [div, sell, buy2, buy, dep]) {
    assert.equal((await s.api(`/api/transactions/${t.body.id}`, { method: "DELETE", auth: true })).status, 204);
  }
  assert.equal((await s.api("/api/positions")).body.find((p) => p.symbol === "ZZQ"), undefined);
  assert.equal((await s.api("/api/settings")).body.cash, cash0);
  assert.equal((await s.api("/api/transactions/123456", { method: "DELETE", auth: true })).status, 404);
});

test("transactions: selling a whole position removes it; deleting that sell restores it", async () => {
  const buy = await s.api("/api/transactions", { method: "POST", auth: true, body: { type: "buy", symbol: "ZZW", shares: 3, price: 10 } });
  const sell = await s.api("/api/transactions", { method: "POST", auth: true, body: { type: "sell", symbol: "ZZW", shares: 3, price: 12 } });
  assert.equal((await s.api("/api/positions")).body.find((p) => p.symbol === "ZZW"), undefined);
  await s.api(`/api/transactions/${sell.body.id}`, { method: "DELETE", auth: true });
  const pos = (await s.api("/api/positions")).body.find((p) => p.symbol === "ZZW");
  assert.equal(pos.shares, 3);
  assert.equal(pos.avgCost, 10);
  await s.api(`/api/transactions/${buy.body.id}`, { method: "DELETE", auth: true });
});

let tokens = {};
test("members: admin-only creation, PIN login, sessions, deactivation", async () => {
  assert.equal((await s.api("/api/members", { method: "POST", body: { name: "A", pin: "1234" } })).status, 401);
  assert.equal((await s.api("/api/members", { method: "POST", auth: true, body: { name: "A", pin: "12" } })).status, 400);
  assert.equal((await s.api("/api/members", { method: "POST", auth: true, body: { name: "A", pin: "1234", role: "king" } })).status, 400);
  const ids = {};
  for (const [name, pin] of [["Ana", "1111"], ["Ben", "2222"], ["Cy", "3333"], ["Dee", "4444"]]) {
    const r = await s.api("/api/members", { method: "POST", auth: true, body: { name, pin } });
    assert.equal(r.status, 201);
    assert.equal(r.body.pinHash, undefined, "hash never returned");
    ids[name] = r.body.id;
  }
  assert.equal((await s.api("/api/members", { method: "POST", auth: true, body: { name: "Ana", pin: "9999" } })).status, 409);
  assert.equal((await s.api("/api/members/login", { method: "POST", body: { memberId: ids.Ana, pin: "0000" } })).status, 401);
  for (const [name, pin] of [["Ana", "1111"], ["Ben", "2222"], ["Cy", "3333"], ["Dee", "4444"]]) {
    const r = await s.api("/api/members/login", { method: "POST", body: { memberId: ids[name], pin } });
    assert.equal(r.status, 200);
    tokens[name] = r.body.token;
  }
  assert.equal((await s.api("/api/members/me", { member: tokens.Ana })).body.member.name, "Ana");
  assert.equal((await s.api("/api/members/me", { member: "bogus" })).body.member, null);
  const list = await s.api("/api/members");
  assert.ok(list.body.every((m) => m.pinHash === undefined));

  // Marking Dee as alumni revokes her session.
  await s.api(`/api/members/${ids.Dee}`, { method: "PUT", auth: true, body: { active: false } });
  assert.equal((await s.api("/api/members/me", { member: tokens.Dee })).body.member, null);
  assert.equal((await s.api("/api/members/login", { method: "POST", body: { memberId: ids.Dee, pin: "4444" } })).status, 401);
  tokens.ids = ids;
});

test("pitches: lifecycle, quorum, threshold, permissions", async () => {
  assert.equal((await s.api("/api/pitches", { method: "POST", body: { symbol: "ZZP" } })).status, 401);
  const p = await s.api("/api/pitches", { method: "POST", member: tokens.Ana, body: { symbol: "zzp", direction: "buy", title: "t" } });
  assert.equal(p.status, 201);
  assert.equal(p.body.author, "Ana");
  assert.equal(p.body.status, "draft");
  const id = p.body.id;
  assert.equal((await s.api("/api/pitches", { method: "POST", member: tokens.Ana, body: { symbol: "ZZP", direction: "short" } })).status, 400);
  assert.equal((await s.api("/api/pitches", { method: "POST", member: tokens.Ana, body: { symbol: "ZZP", basePrice: -3 } })).status, 400);

  // Can't open without thesis + base price; can't vote on a draft.
  assert.equal((await s.api(`/api/pitches/${id}/status`, { method: "POST", member: tokens.Ana, body: { action: "open" } })).status, 400);
  assert.equal((await s.api(`/api/pitches/${id}/vote`, { method: "POST", member: tokens.Ben, body: { vote: "yes" } })).status, 409);
  await s.api(`/api/pitches/${id}`, { method: "PUT", member: tokens.Ana, body: { thesis: "x", basePrice: 50, bullPrice: 70, bearPrice: 30 } });
  assert.equal((await s.api(`/api/pitches/${id}/status`, { method: "POST", member: tokens.Ana, body: { action: "open" } })).status, 400, "needs a pre-mortem too");
  await s.api(`/api/pitches/${id}`, { method: "PUT", member: tokens.Ana, body: { preMortem: "Thesis broke because of X." } });
  assert.equal((await s.api(`/api/pitches/${id}/status`, { method: "POST", member: tokens.Ana, body: { action: "open" } })).body.status, "voting");

  assert.equal((await s.api(`/api/pitches/${id}/vote`, { method: "POST", body: { vote: "yes" } })).status, 401, "anonymous can't vote");
  assert.equal((await s.api(`/api/pitches/${id}/vote`, { method: "POST", auth: true, body: { vote: "yes" } })).status, 401, "editor password alone can't vote");
  assert.equal((await s.api(`/api/pitches/${id}/vote`, { method: "POST", member: tokens.Ana, body: { vote: "maybe" } })).status, 400);
  await s.api(`/api/pitches/${id}/vote`, { method: "POST", member: tokens.Ana, body: { vote: "yes" } });
  await s.api(`/api/pitches/${id}/vote`, { method: "POST", member: tokens.Ana, body: { vote: "no" } }); // changing a vote doesn't double count
  let t = (await s.api(`/api/pitches/${id}`)).body.tally;
  assert.equal(t.total, 1);
  assert.equal(t.counts.no, 1);
  assert.equal((await s.api(`/api/pitches/${id}/status`, { method: "POST", member: tokens.Ana, body: { action: "close" } })).status, 400, "quorum");

  await s.api(`/api/pitches/${id}/vote`, { method: "POST", member: tokens.Ben, body: { vote: "yes" } });
  await s.api(`/api/pitches/${id}/vote`, { method: "POST", member: tokens.Cy, body: { vote: "yes", comment: "<i>c</i>" } });
  t = (await s.api(`/api/pitches/${id}`)).body.tally;
  assert.equal(t.passing, true, "2 yes / 1 no > 50%");
  assert.equal((await s.api(`/api/pitches/${id}`, { method: "DELETE", member: tokens.Ana })).status, 409, "only drafts deletable");

  // A 2/3 threshold makes the same vote fail.
  await s.api("/api/settings", { method: "PUT", auth: true, body: { voteThresholdPct: 66.7 } });
  assert.equal((await s.api(`/api/pitches/${id}`)).body.tally.passing, false);
  await s.api("/api/settings", { method: "PUT", auth: true, body: { voteThresholdPct: 50 } });

  const closed = await s.api(`/api/pitches/${id}/status`, { method: "POST", member: tokens.Ben, body: { action: "close" } });
  assert.equal(closed.body.status, "approved");
  assert.equal((await s.api(`/api/pitches/${id}`, { method: "PUT", member: tokens.Ana, body: { thesis: "y" } })).status, 409, "decided pitches frozen");
  assert.equal((await s.api(`/api/pitches/${id}/vote`, { method: "POST", member: tokens.Ben, body: { vote: "no" } })).status, 409);
  assert.equal((await s.api(`/api/pitches/${id}/status`, { method: "POST", member: tokens.Ana, body: { action: "executed" } })).body.status, "executed");
  assert.equal((await s.api(`/api/pitches/${id}/status`, { method: "POST", member: tokens.Ana, body: { action: "open" } })).status, 409);

  // Editor password with explicit author also works for authorship.
  const e = await s.api("/api/pitches", { method: "POST", auth: true, body: { symbol: "ZZE", author: "Prof X" } });
  assert.equal(e.body.author, "Prof X");
  assert.equal((await s.api(`/api/pitches/${e.body.id}`, { method: "DELETE", auth: true })).status, 204);

  const list = await s.api("/api/pitches");
  assert.ok(list.body.some((x) => x.id === id && x.status === "executed"));
  assert.equal((await s.api("/api/pitches/99999")).status, 404);
});

test("thesis: target price and price-at-thesis lock-in", async () => {
  assert.equal((await s.api("/api/research/ZZT/thesis", { method: "PUT", body: { thesis: "x" } })).status, 401);
  assert.equal((await s.api("/api/research/ZZT/thesis", { method: "PUT", auth: true, body: { thesis: "x", targetPrice: -1 } })).status, 400);
  const a = await s.api("/api/research/zzt/thesis", { method: "PUT", auth: true, body: { author: "A", thesis: "</textarea><script>", targetPrice: 20, priceAtThesis: 10 } });
  assert.equal(a.status, 200);
  assert.equal(a.body.priceAtThesis, 10);
  const b = await s.api("/api/research/ZZT/thesis", { method: "PUT", auth: true, body: { author: "A", thesis: "y", targetPrice: 25, priceAtThesis: 99 } });
  assert.equal(b.body.targetPrice, 25);
  assert.equal(b.body.priceAtThesis, 10, "original price kept for grading");
});

test("price alerts: validation and CRUD", async () => {
  assert.equal((await s.api("/api/price-alerts", { method: "POST", auth: true, body: { symbol: "X", direction: "sideways", price: 1 } })).status, 400);
  assert.equal((await s.api("/api/price-alerts", { method: "POST", auth: true, body: { symbol: "X", direction: "above", price: 0 } })).status, 400);
  const a = await s.api("/api/price-alerts", { method: "POST", auth: true, body: { symbol: "x", direction: "above", price: 5, note: "n" } });
  assert.equal(a.status, 201);
  assert.equal(a.body.symbol, "X");
  assert.ok((await s.api("/api/price-alerts")).body.some((x) => x.id === a.body.id));
  assert.equal((await s.api(`/api/price-alerts/${a.body.id}`, { method: "DELETE", auth: true })).status, 204);
  assert.equal((await s.api(`/api/price-alerts/${a.body.id}`, { method: "DELETE", auth: true })).status, 404);
});

test("member logout ends the session", async () => {
  await s.api("/api/members/logout", { method: "POST", member: tokens.Cy });
  assert.equal((await s.api("/api/members/me", { member: tokens.Cy })).body.member, null);
});

test("server log has no unexpected errors", () => {
  assert.ok(!/TypeError|ReferenceError|SqliteError/.test(s.log()), s.log());
});

test("security headers and JSON 404s", async () => {
  const r = await fetch(s.base + "/api/settings");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  assert.equal(r.headers.get("x-powered-by"), null);
  const nf = await s.api("/api/nope/nope");
  assert.equal(nf.status, 404);
  assert.ok(nf.body?.error);
});

test("PIN guessing is rate limited per member", async () => {
  const id = tokens.ids.Ben;
  let last;
  for (let i = 0; i < 12; i++) last = await s.api("/api/members/login", { method: "POST", body: { memberId: id, pin: String(1000 + i) } });
  assert.equal(last.status, 429);
  // Even the right PIN is refused while locked out.
  assert.equal((await s.api("/api/members/login", { method: "POST", body: { memberId: id, pin: "2222" } })).status, 429);
});

test("edit-password guessing is rate limited", async () => {
  let last;
  for (let i = 0; i < 12; i++) last = await s.api("/api/login", { method: "POST", body: { password: `guess${i}` } });
  assert.equal(last.status, 429);
});

test("policy limits can be left unset; unset limits produce no breaches", async () => {
  const set = await s.api("/api/settings", { method: "PUT", auth: true, body: { maxPositionPct: 1 } });
  assert.equal(set.body.maxPositionPct, 1);
  const cleared = await s.api("/api/settings", { method: "PUT", auth: true, body: { maxPositionPct: null, maxSectorPct: "" } });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.maxPositionPct, null);
  assert.equal(cleared.body.maxSectorPct, null);
  assert.equal((await s.api("/api/settings", { method: "PUT", auth: true, body: { cash: null } })).status, 400, "cash isn't optional");
});
