// End-to-end API tests against a real server + throwaway database. These don't depend on
// external market data (where a route fetches prices, offline failures must degrade, not crash).
const test = require("node:test");
const assert = require("node:assert/strict");
const { startServer, PASSWORD, ADMIN_PASSWORD } = require("./helpers");

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

test("accounts: first-admin setup, sign-in, session, sign-out", async () => {
  assert.equal((await s.api("/api/auth/session")).body.setupNeeded, true, "fresh install");
  assert.equal((await s.api("/api/auth/setup", { method: "POST", body: { setupPassword: "nope", name: "X", email: "x@test.edu", password: "long-enough-1" } })).status, 401);
  await s.ensureAdmin();
  assert.equal((await s.api("/api/auth/session")).body.setupNeeded, false);
  assert.equal((await s.api("/api/auth/setup", { method: "POST", body: { setupPassword: PASSWORD, name: "Y", email: "y@test.edu", password: "long-enough-1" } })).status, 409, "setup only once");
  const ok = await s.api("/api/auth/login", { method: "POST", body: { email: "ADMIN@test.edu", password: ADMIN_PASSWORD } });
  assert.equal(ok.status, 200);
  assert.ok(ok.cookie, "session cookie set");
  assert.equal((await s.api("/api/auth/session", { member: ok.cookie })).body.member.name, "Test Admin");
  assert.equal((await s.api("/api/auth/login", { method: "POST", body: { email: "admin@test.edu", password: "wrong-password" } })).status, 401);
  assert.equal((await s.api("/api/auth/login", { method: "POST", body: {} })).status, 401);
  assert.equal((await s.api("/api/auth/session", { member: "pif_session=bogus" })).body.member, null);
  await s.api("/api/auth/logout", { method: "POST", member: ok.cookie });
  assert.equal((await s.api("/api/auth/session", { member: ok.cookie })).body.member, null, "signed out");
  assert.equal((await s.api("/api/positions", { method: "POST", auth: true, appHeader: false, body: { symbol: "X", shares: 1 } })).status, 403, "writes need the app header");
});

test("malformed JSON gets a 400 JSON error, not a crash", async () => {
  const r = await s.api("/api/auth/login", { method: "POST", body: "{not json" });
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
test("members: admin adds, invite links, roles, deactivation", async () => {
  assert.equal((await s.api("/api/members", { method: "POST", body: { name: "A", email: "a@test.edu" } })).status, 401);
  assert.equal((await s.api("/api/members", { method: "POST", auth: true, body: { name: "A", email: "not-an-email" } })).status, 400);
  const ids = {};
  for (const [name, opts] of [["Ana", {}], ["Ben", { canTrade: true }], ["Cy", {}], ["Dee", {}]]) {
    const m = await s.createMember(name, opts);
    ids[name] = m.id;
    tokens[name] = m.cookie;
  }
  assert.equal((await s.api("/api/members", { method: "POST", auth: true, body: { name: "Ana2", email: "ana@test.edu" } })).status, 409, "email taken");
  assert.equal((await s.api("/api/members", { method: "POST", member: tokens.Ana, body: { name: "Q", email: "q@test.edu" } })).status, 403, "members can't add members");
  const me = (await s.api("/api/auth/session", { member: tokens.Ben })).body.member;
  assert.deepEqual([me.name, me.canTrade, me.isAdmin], ["Ben", true, false]);
  const list = await s.api("/api/members", { member: tokens.Ana });
  assert.ok(list.body.every((m) => m.passwordHash === undefined && m.pinHash === undefined && m.email === undefined), "members don't see emails or hashes");
  assert.ok((await s.api("/api/members", { auth: true })).body.some((m) => m.email === "ana@test.edu"), "admins see emails");
  assert.equal((await s.api("/api/members")).status, 401, "visitors don't see the member list");

  // A reset link works once and signs out old sessions.
  const reset = await s.api(`/api/members/${ids.Cy}/invite`, { method: "POST", auth: true });
  assert.ok((await s.api(`/api/auth/invite/${reset.body.inviteToken}`)).body.hasPassword);
  const used = await s.api(`/api/auth/invite/${reset.body.inviteToken}`, { method: "POST", body: { password: "brand-new-pass-1" } });
  assert.equal(used.status, 200);
  assert.equal((await s.api("/api/auth/session", { member: tokens.Cy })).body.member, null, "old session ended by reset");
  tokens.Cy = used.cookie;
  assert.equal((await s.api(`/api/auth/invite/${reset.body.inviteToken}`, { method: "POST", body: { password: "another-pass-12" } })).status, 404, "single use");
  assert.equal((await s.api(`/api/auth/invite/${reset.body.inviteToken}`, { method: "POST", body: { password: "short" } })).status, 404);

  // Marking Dee as alumni revokes her session and blocks sign-in.
  await s.api(`/api/members/${ids.Dee}`, { method: "PUT", auth: true, body: { active: false } });
  assert.equal((await s.api("/api/auth/session", { member: tokens.Dee })).body.member, null);
  assert.equal((await s.api("/api/auth/login", { method: "POST", body: { email: "dee@test.edu", password: "member-password-1" } })).status, 401);
  // The club always keeps an admin.
  const admins = (await s.api("/api/members", { auth: true })).body.filter((m) => m.isAdmin);
  assert.equal((await s.api(`/api/members/${admins[0].id}`, { method: "PUT", auth: true, body: { isAdmin: false } })).status, 400);
  tokens.ids = ids;
});

test("permissions: visitors, members, portfolio managers and admins", async () => {
  const pos = { symbol: "ZZPERM", shares: 1, lastPrice: 1 };
  assert.equal((await s.api("/api/positions", { method: "POST", body: pos })).status, 401);
  assert.equal((await s.api("/api/positions", { method: "POST", member: tokens.Ana, body: pos })).status, 403, "members can't trade");
  const added = await s.api("/api/positions", { method: "POST", member: tokens.Ben, body: pos });
  assert.equal(added.status, 201, "portfolio manager can");
  assert.equal((await s.api("/api/transactions", { method: "POST", member: tokens.Ana, body: { type: "deposit", amount: 5 } })).status, 403);
  assert.equal((await s.api("/api/settings", { method: "PUT", member: tokens.Ana, body: { cash: 1 } })).status, 403);
  assert.equal((await s.api("/api/settings", { method: "PUT", member: tokens.Ben, body: { maxPositionPct: 5 } })).status, 403, "PMs don't set policy");
  assert.equal((await s.api("/api/watchlist", { method: "POST", member: tokens.Ana, body: { symbol: "ZZW" } })).status, 201, "members manage the watchlist");
  assert.equal((await s.api("/api/paper/seasons", { method: "POST", member: tokens.Ben, body: { name: "X" } })).status, 403, "seasons are admin-only");
  const log = (await s.api("/api/activity", { member: tokens.Ana })).body;
  assert.ok(log.some((a) => a.action === "position.add" && a.memberName === "Ben" && a.detail.symbol === "ZZPERM"), "fund changes are logged with who did them");
  await s.api(`/api/positions/${added.body.id}`, { method: "DELETE", member: tokens.Ben });
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
  assert.equal((await s.api(`/api/pitches/${id}`, { method: "PUT", member: tokens.Cy, body: { thesis: "hijack" } })).status, 403, "only the author or an admin edits");
  assert.equal((await s.api(`/api/pitches/${id}/vote`, { method: "POST", member: tokens.Ana, body: { vote: "maybe" } })).status, 400);
  await s.api(`/api/pitches/${id}/vote`, { method: "POST", member: tokens.Ana, body: { vote: "yes" } });
  await s.api(`/api/pitches/${id}/vote`, { method: "POST", member: tokens.Ana, body: { vote: "no" } }); // changing a vote doesn't double count
  let t = (await s.api(`/api/pitches/${id}`)).body.tally;
  assert.equal(t.total, 1);
  assert.equal(t.counts.no, 1);
  assert.equal((await s.api(`/api/pitches/${id}/status`, { method: "POST", member: tokens.Ana, body: { action: "close" } })).status, 403, "members can't close a vote");
  assert.equal((await s.api(`/api/pitches/${id}/status`, { method: "POST", member: tokens.Ben, body: { action: "close" } })).status, 400, "quorum");

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
  assert.equal((await s.api(`/api/pitches/${id}/status`, { method: "POST", member: tokens.Ana, body: { action: "executed" } })).status, 403, "only a portfolio manager executes");
  assert.equal((await s.api(`/api/pitches/${id}/status`, { method: "POST", member: tokens.Ben, body: { action: "executed" } })).body.status, "executed");
  assert.equal((await s.api(`/api/pitches/${id}/status`, { method: "POST", member: tokens.Ana, body: { action: "open" } })).status, 409);

  // Authorship comes from the account (a typed "author" is ignored); admins can delete others' drafts.
  const e = await s.api("/api/pitches", { method: "POST", member: tokens.Cy, body: { symbol: "ZZE", author: "Prof X" } });
  assert.equal(e.body.author, "Cy");
  assert.equal((await s.api(`/api/pitches/${e.body.id}`, { method: "DELETE", member: tokens.Ana })).status, 403);
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

test("preferences: per-member, validated, returned with the session", async () => {
  assert.equal((await s.api("/api/prefs")).status, 401, "visitors keep prefs in their browser");
  const saved = await s.api("/api/prefs", { method: "PUT", member: tokens.Ben, body: { benchmark: "qqq", theme: "dark", myTickers: ["cost", "COST", "nvda", "$$$"], todayHidden: ["movers", "bogus"] } });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body, { benchmark: "QQQ", theme: "dark", myTickers: ["COST", "NVDA"], todayHidden: ["movers"] });
  assert.equal((await s.api("/api/prefs", { method: "PUT", member: tokens.Ben, body: { theme: "neon" } })).status, 400);
  assert.equal((await s.api("/api/prefs", { method: "PUT", member: tokens.Ben, body: { favoriteColor: "red" } })).status, 400, "unknown keys rejected");
  assert.equal((await s.api("/api/prefs", { method: "PUT", member: tokens.Ben, body: { myTickers: Array.from({ length: 51 }, (_, i) => `T${i}`) } })).status, 400);
  assert.deepEqual((await s.api("/api/prefs", { member: tokens.Cy })).body, {}, "prefs are per member");
  assert.equal((await s.api("/api/auth/session", { member: tokens.Ben })).body.prefs.benchmark, "QQQ");
  const cleared = await s.api("/api/prefs", { method: "PUT", member: tokens.Ben, body: { benchmark: null } });
  assert.equal(cleared.body.benchmark, undefined, "null clears back to the fund's benchmark");
});

test("notes: private by default, sharing, search, author-only edits", async () => {
  assert.equal((await s.api("/api/notes")).status, 401);
  assert.equal((await s.api("/api/notes", { method: "POST", member: tokens.Ana, body: { body: "   " } })).status, 400, "empty note");
  assert.equal((await s.api("/api/notes", { method: "POST", member: tokens.Ana, body: { symbol: "bad ticker!", body: "x" } })).status, 400);
  const priv = await s.api("/api/notes", { method: "POST", member: tokens.Ana, body: { symbol: "$cost", body: "Margins <b>held</b> up", tags: "#Margins, earnings", pageRef: "javascript:alert(1)" } });
  assert.equal(priv.status, 201);
  assert.deepEqual([priv.body.symbol, priv.body.visibility, priv.body.pageRef, priv.body.tags.join(",")], ["COST", "private", "", "margins,earnings"], "ticker cleaned, private, unsafe link dropped");
  const shared = await s.api("/api/notes", { method: "POST", member: tokens.Ana, body: { symbol: "COST", quote: "Comparable sales increased 10%", body: "Worth discussing", visibility: "club", pageRef: "#/research/COST/filings" } });
  assert.equal(shared.status, 201);
  // Ben sees only the shared one; Ana sees both.
  const benView = (await s.api("/api/notes?symbol=COST", { member: tokens.Ben })).body;
  assert.deepEqual(benView.map((n) => n.id), [shared.body.id]);
  assert.equal(benView[0].authorName, "Ana");
  assert.equal(benView[0].mine, false);
  assert.equal((await s.api("/api/notes?symbol=COST", { member: tokens.Ana })).body.length, 2);
  assert.deepEqual((await s.api("/api/notes/symbols", { member: tokens.Ben })).body.COST, { mine: 0, total: 1 });
  // Search and tag filters.
  assert.equal((await s.api("/api/notes?q=margins", { member: tokens.Ana })).body.length, 1);
  assert.equal((await s.api("/api/notes?tag=earnings", { member: tokens.Ana })).body.length, 1);
  assert.equal((await s.api("/api/notes?q=margins", { member: tokens.Ben })).body.length, 0, "others' private notes never match");
  // Only the author edits; admins can remove a shared note; private notes are invisible to others.
  assert.equal((await s.api(`/api/notes/${shared.body.id}`, { method: "PUT", member: tokens.Ben, body: { body: "hijack" } })).status, 403);
  assert.equal((await s.api(`/api/notes/${priv.body.id}`, { method: "DELETE", member: tokens.Ben })).status, 404);
  const pinned = await s.api(`/api/notes/${priv.body.id}`, { method: "PUT", member: tokens.Ana, body: { pinned: true } });
  assert.equal(pinned.body.pinned, true);
  assert.equal(pinned.body.body, "Margins <b>held</b> up", "partial edit keeps other fields");
  assert.equal((await s.api(`/api/notes/${shared.body.id}`, { method: "DELETE", member: tokens.Ben })).status, 403);
  assert.equal((await s.api(`/api/notes/${shared.body.id}`, { method: "DELETE", auth: true })).status, 204, "admin moderation");
});

test("sign out everywhere ends every session", async () => {
  const second = (await s.api("/api/auth/login", { method: "POST", body: { email: "ana@test.edu", password: "member-password-1" } })).cookie;
  await s.api("/api/auth/logout-all", { method: "POST", member: tokens.Ana });
  assert.equal((await s.api("/api/auth/session", { member: tokens.Ana })).body.member, null);
  assert.equal((await s.api("/api/auth/session", { member: second })).body.member, null);
  tokens.Ana = (await s.api("/api/auth/login", { method: "POST", body: { email: "ana@test.edu", password: "member-password-1" } })).cookie;
});

test("chat: members only, mentions, replies, reactions, edits, deletes, images, unread", async () => {
  assert.equal((await s.api("/api/chat/messages")).status, 401, "visitors can't read the chat");
  assert.equal((await s.api("/api/chat/messages", { method: "POST", body: { body: "hi" } })).status, 401);
  assert.equal((await s.api("/api/chat/messages", { method: "POST", member: tokens.Ana, body: { body: "  " } })).status, 400, "empty message");
  assert.equal((await s.api("/api/chat/messages", { method: "POST", member: tokens.Ana, body: { body: "x".repeat(2001) } })).status, 400);
  assert.equal((await s.api("/api/chat/messages", { method: "POST", member: tokens.Ana, body: { body: "hi", attachment: { kind: "quote", quote: "" } } })).status, 400);

  // Live: a member's stream gets the message; a visitor's stream doesn't.
  const listen = async (cookie) => {
    const ctrl = new AbortController();
    const res = await fetch(`${s.base}/api/events`, { headers: cookie ? { Cookie: cookie } : {}, signal: ctrl.signal });
    const reader = res.body.getReader();
    let text = "";
    (async () => { try { for (;;) { const { value, done } = await reader.read(); if (done) break; text += new TextDecoder().decode(value); } } catch { /* aborted */ } })();
    return { text: () => text, stop: () => ctrl.abort() };
  };
  const benStream = await listen(tokens.Ben), visitorStream = await listen(null);
  await new Promise((r) => setTimeout(r, 150));

  const first = await s.api("/api/chat/messages", { method: "POST", member: tokens.Ana, body: { body: "Look at this @ben and @Nobody, $COST <b>", attachment: { kind: "quote", quote: "Comparable sales rose", pageRef: "javascript:alert(1)", symbol: "cost" } } });
  assert.equal(first.status, 201);
  const benId = (await s.api("/api/auth/session", { member: tokens.Ben })).body.member.id;
  assert.deepEqual(first.body.mentions, [benId], "mentions match members by first name");
  assert.equal(first.body.attachment.pageRef, "", "unsafe links dropped");
  assert.equal(first.body.attachment.symbol, "COST");
  assert.equal(first.body.canEdit, true);
  await new Promise((r) => setTimeout(r, 150));
  assert.match(benStream.text(), /event: chat\.message/);
  assert.match(benStream.text(), /event: chat\.mention/);
  assert.doesNotMatch(visitorStream.text(), /chat\./, "visitors never receive chat events");
  benStream.stop(); visitorStream.stop();

  // Unread and mentions for Ben, then reading clears them.
  let unread = (await s.api("/api/chat/unread", { member: tokens.Ben })).body;
  assert.deepEqual([unread.unread, unread.mentions], [1, 1]);
  assert.equal((await s.api("/api/chat/unread", { member: tokens.Ana })).body.unread, 0, "your own messages aren't unread");
  assert.equal((await s.api("/api/chat/read", { method: "POST", member: tokens.Ben, body: { lastReadId: first.body.id } })).status, 204);
  unread = (await s.api("/api/chat/unread", { member: tokens.Ben })).body;
  assert.deepEqual([unread.unread, unread.mentions], [0, 0]);

  // Replies and reactions.
  const reply = await s.api("/api/chat/messages", { method: "POST", member: tokens.Ben, body: { body: "Agreed", replyTo: first.body.id } });
  assert.equal(reply.body.reply.authorName, "Ana");
  assert.equal((await s.api("/api/chat/messages", { method: "POST", member: tokens.Ben, body: { body: "x", replyTo: 999999 } })).status, 400);
  assert.equal((await s.api(`/api/chat/messages/${first.body.id}/react`, { method: "POST", member: tokens.Ben, body: { emoji: "💩" } })).status, 400);
  const reacted = await s.api(`/api/chat/messages/${first.body.id}/react`, { method: "POST", member: tokens.Ben, body: { emoji: "👍" } });
  assert.deepEqual(reacted.body.reactions, [{ emoji: "👍", count: 1, mine: true }]);
  assert.deepEqual((await s.api(`/api/chat/messages/${first.body.id}`, { member: tokens.Ana })).body.reactions, [{ emoji: "👍", count: 1, mine: false }]);
  const unreacted = await s.api(`/api/chat/messages/${first.body.id}/react`, { method: "POST", member: tokens.Ben, body: { emoji: "👍" } });
  assert.deepEqual(unreacted.body.reactions, [], "reacting again removes it");

  // Only the author edits; the author or an admin deletes.
  assert.equal((await s.api(`/api/chat/messages/${first.body.id}`, { method: "PUT", member: tokens.Ben, body: { body: "hijack" } })).status, 403);
  const edited = await s.api(`/api/chat/messages/${first.body.id}`, { method: "PUT", member: tokens.Ana, body: { body: "Edited" } });
  assert.equal(edited.body.body, "Edited");
  assert.ok(edited.body.editedAt);
  assert.equal((await s.api(`/api/chat/messages/${reply.body.id}`, { method: "DELETE", member: tokens.Ana })).status, 403);
  assert.equal((await s.api(`/api/chat/messages/${reply.body.id}`, { method: "DELETE", auth: true })).status, 204, "admin moderation");
  const gone = (await s.api(`/api/chat/messages/${reply.body.id}`, { member: tokens.Ana })).body;
  assert.deepEqual([gone.deleted, gone.body], [true, ""]);

  // Images: real image bytes only, members only, and only your own upload can be attached.
  const upload = (cookie, bytes, type = "image/png") => fetch(`${s.base}/api/chat/images`, { method: "POST", headers: { "Content-Type": type, "x-pif-app": "1", ...(cookie ? { Cookie: cookie } : {}) }, body: bytes });
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
  assert.equal((await upload(null, png)).status, 401);
  assert.equal((await upload(tokens.Ana, Buffer.from("<svg onload=alert(1)>............"))).status, 400, "declared type isn't trusted");
  assert.equal((await upload(tokens.Ana, Buffer.alloc(700 * 1024, 0xff))).status, 413, "too large");
  const img = await (await upload(tokens.Ana, png)).json();
  assert.ok(img.id);
  assert.equal((await s.api("/api/chat/messages", { method: "POST", member: tokens.Ben, body: { body: "mine now", imageId: img.id } })).status, 400);
  const snap = await s.api("/api/chat/messages", { method: "POST", member: tokens.Ana, body: { imageId: img.id, attachment: { kind: "snapshot", pageRef: "#/performance", pageTitle: "Performance" } } });
  assert.equal(snap.status, 201);
  assert.equal((await fetch(`${s.base}${snap.body.image}`)).status, 401, "images are members only");
  const got = await fetch(`${s.base}${snap.body.image}`, { headers: { Cookie: tokens.Ben } });
  assert.equal(got.headers.get("content-type"), "image/png");

  // Paging and the rate limit.
  const page = (await s.api("/api/chat/messages?limit=2", { member: tokens.Ben })).body;
  assert.equal(page.messages.length, 2);
  assert.equal(page.hasMore, true);
  assert.ok(page.messages[0].id < page.messages[1].id, "oldest first");
  const older = (await s.api(`/api/chat/messages?limit=50&before=${page.messages[0].id}`, { member: tokens.Ben })).body;
  assert.ok(older.messages.every((m) => m.id < page.messages[0].id));
  const statuses = [];
  for (let i = 0; i < 11; i++) statuses.push((await s.api("/api/chat/messages", { method: "POST", member: tokens.Cy, body: { body: `m${i}` } })).status);
  assert.deepEqual([statuses.slice(0, 10).every((c) => c === 201), statuses[10]], [true, 429]);
});

test("Today 'For you': signed in only, your mentions and notes", async () => {
  assert.equal((await s.api("/api/today/foryou")).status, 401);
  await s.api("/api/chat/messages", { method: "POST", member: tokens.Ana, body: { body: "@Cy see the deck" } });
  await s.api("/api/notes", { method: "POST", member: tokens.Cy, body: { body: "Cy's private note" } });
  const f = await s.api("/api/today/foryou", { member: tokens.Cy });
  assert.equal(f.status, 200);
  assert.deepEqual(f.body.tickers, [], "no followed tickers yet");
  assert.equal(f.body.chat.mentions[0].by, "Ana");
  assert.ok(f.body.chat.unread >= 1);
  assert.equal(f.body.notes[0].body, "Cy's private note");
  assert.ok(Array.isArray(f.body.toVote));
  assert.ok(!(await s.api("/api/today/foryou", { member: tokens.Ben })).body.notes.some((n) => n.body === "Cy's private note"), "notes are yours only");
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

test("password guessing is rate limited per account", async () => {
  let last;
  for (let i = 0; i < 12; i++) last = await s.api("/api/auth/login", { method: "POST", body: { email: "cy@test.edu", password: `guess-${i}-xxxx` } });
  assert.equal(last.status, 429);
  // Even the right password is refused while locked out.
  assert.equal((await s.api("/api/auth/login", { method: "POST", body: { email: "cy@test.edu", password: "brand-new-pass-1" } })).status, 429);
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

test("paper trading: seasons, member-only trades, validation without live prices", async () => {
  const token = tokens.Ben;

  const board = await s.api("/api/paper");
  assert.equal(board.status, 200);
  assert.ok(board.body.season.id && board.body.isOpen);
  assert.equal(board.body.mine, null, "anonymous visitors have no portfolio");
  assert.deepEqual(board.body.leaderboard, []);

  const mine = (await s.api("/api/paper", { member: token })).body.mine;
  assert.equal(mine.cash, board.body.season.startingCash);
  assert.equal(mine.positions.length, 0);

  assert.equal((await s.api("/api/paper/trades", { method: "POST", body: { symbol: "AAPL", type: "buy", shares: 1 } })).status, 401);
  assert.equal((await s.api("/api/paper/trades", { method: "POST", member: token, body: { symbol: "!!", type: "buy", shares: 1 } })).status, 400);
  assert.equal((await s.api("/api/paper/trades", { method: "POST", member: token, body: { symbol: "!!", type: "short", shares: 1 } })).status, 400);

  assert.equal((await s.api("/api/paper/seasons", { method: "POST", body: { name: "Spring 2027" } })).status, 401);
  assert.equal((await s.api("/api/paper/seasons", { method: "POST", auth: true, body: { startingCash: -5 } })).status, 400);
  const next = await s.api("/api/paper/seasons", { method: "POST", auth: true, body: { name: "Spring 2027", startingCash: 50000 } });
  assert.equal(next.status, 201);
  const seasons = (await s.api("/api/paper/seasons")).body;
  assert.equal(seasons[0].name, "Spring 2027");
  assert.ok(seasons[1].endedAt, "the previous season is closed, not deleted");
  assert.equal((await s.api(`/api/paper?season=${seasons[1].id}`)).body.isOpen, false);
});

test("inbox: pitch votes, fund trades, mentions, muting, read state, privacy", async () => {
  assert.equal((await s.api("/api/notifications")).status, 401);
  const inbox = async (who) => (await s.api("/api/notifications?limit=100", { member: tokens[who] })).body;
  // The pitches test opened a vote on Ana's pitch: everyone but Ana heard about it.
  assert.ok((await inbox("Ben")).items.some((n) => n.type === "pitchVoting" && n.link.startsWith("#/pitches/")));
  assert.ok(!(await inbox("Ana")).items.some((n) => n.type === "pitchVoting"), "the author isn't told about their own pitch");
  // Ana mentioned Cy in the chat test.
  assert.ok((await inbox("Cy")).items.some((n) => n.type === "mention" && n.link === "#/chat"));
  // Ben mutes fund trades; a portfolio manager's buy reaches Cy only.
  await s.api("/api/prefs", { method: "PUT", member: tokens.Ben, body: { notifyOff: ["fundTrade", "bogus"] } });
  assert.deepEqual((await s.api("/api/prefs", { member: tokens.Ben })).body.notifyOff, ["fundTrade"]);
  await s.api("/api/transactions", { method: "POST", auth: true, body: { type: "buy", symbol: "ZZN", shares: 2, price: 10 } });
  const cy = await inbox("Cy");
  const trade = cy.items.find((n) => n.type === "fundTrade" && /bought 2 ZZN at \$10\.00/.test(n.title));
  assert.ok(trade, JSON.stringify(cy.items.map((n) => n.title)));
  assert.ok(!(await inbox("Ben")).items.some((n) => n.type === "fundTrade" && /ZZN/.test(n.title)), "muted");
  // Read state is per member; nobody can touch someone else's.
  const before = cy.unread;
  assert.equal((await s.api("/api/notifications/read", { method: "POST", member: tokens.Cy, body: { id: trade.id } })).body.unread, before - 1);
  await s.api("/api/notifications/read", { method: "POST", member: tokens.Ben, body: { id: trade.id } });
  assert.equal((await s.api(`/api/notifications/${trade.id}`, { method: "DELETE", member: tokens.Ben })).status, 404);
  assert.equal((await s.api("/api/notifications/read", { method: "POST", member: tokens.Cy, body: {} })).status, 400);
  assert.equal((await s.api("/api/notifications/read", { method: "POST", member: tokens.Cy, body: { all: true } })).body.unread, 0);
  assert.equal((await s.api(`/api/notifications/${trade.id}`, { method: "DELETE", member: tokens.Cy })).status, 204);
});

test("personal price alerts: private, validated, re-armable", async () => {
  assert.equal((await s.api("/api/my-alerts")).status, 401);
  assert.equal((await s.api("/api/my-alerts", { method: "POST", member: tokens.Ana, body: { symbol: "COST", kind: "sideways", value: 1 } })).status, 400);
  assert.equal((await s.api("/api/my-alerts", { method: "POST", member: tokens.Ana, body: { symbol: "COST", kind: "above", value: -1 } })).status, 400);
  const a = await s.api("/api/my-alerts", { method: "POST", member: tokens.Ana, body: { symbol: "$cost", kind: "move", value: 4, note: "earnings week" } });
  assert.equal(a.status, 201);
  assert.deepEqual([a.body.symbol, a.body.kind, a.body.value, a.body.active], ["COST", "move", 4, 1]);
  assert.equal((await s.api("/api/my-alerts", { member: tokens.Ben })).body.length, 0, "only the owner sees them");
  assert.equal((await s.api(`/api/my-alerts/${a.body.id}`, { method: "DELETE", member: tokens.Ben })).status, 404);
  const off = await s.api(`/api/my-alerts/${a.body.id}`, { method: "PUT", member: tokens.Ana, body: { active: false } });
  assert.equal(off.body.active, 0);
  assert.equal((await s.api(`/api/my-alerts/${a.body.id}`, { method: "PUT", member: tokens.Ana, body: { value: 99 } })).status, 400, "moves are capped");
  assert.equal((await s.api("/api/my-alerts?symbol=COST", { member: tokens.Ana })).body.length, 1);
  assert.equal((await s.api(`/api/my-alerts/${a.body.id}`, { method: "DELETE", member: tokens.Ana })).status, 204);
});

test("profiles: members only, track record, private counts only for yourself", async () => {
  const ana = (await s.api("/api/auth/session", { member: tokens.Ana })).body.member;
  assert.equal((await s.api(`/api/members/${ana.id}/profile`)).status, 401);
  assert.equal((await s.api("/api/members/99999/profile", { member: tokens.Ben })).status, 404);
  const seen = (await s.api(`/api/members/${ana.id}/profile`, { member: tokens.Ben })).body;
  assert.equal(seen.member.name, "Ana");
  assert.equal(seen.self, false);
  assert.ok(seen.pitches.some((p) => p.symbol === "ZZP"), "her pitches");
  assert.equal(seen.noteCounts.private, null, "others don't see how many private notes you have");
  assert.ok(Array.isArray(seen.paper) && seen.paper.length >= 1);
  const own = (await s.api(`/api/members/${ana.id}/profile`, { member: tokens.Ana })).body;
  assert.equal(own.self, true);
  assert.equal(typeof own.noteCounts.private, "number");
  assert.ok(own.voteSummary.cast >= 1);
});

test("paper trading: a reason is required; seasons carry their own rules", async () => {
  // Without a reason the order is refused (or, offline, there's no price): either way a 400.
  assert.equal((await s.api("/api/paper/trades", { method: "POST", member: tokens.Ben, body: { symbol: "AAPL", type: "buy", shares: 1 } })).status, 400);
  assert.equal((await s.api("/api/paper/trades/999999", { method: "DELETE", member: tokens.Ben })).status, 404);
  assert.equal((await s.api("/api/paper/seasons", { method: "POST", auth: true, body: { maxPositionPct: 0 } })).status, 400);
  assert.equal((await s.api("/api/paper/seasons", { method: "POST", auth: true, body: { feeBps: 9999 } })).status, 400);
  const made = await s.api("/api/paper/seasons", { method: "POST", auth: true, body: { name: "Rules test", feeBps: 5, minHoldings: 3, maxPositionPct: 30, minPrice: 2, minMarketCap: 1e8 } });
  assert.equal(made.status, 201);
  const r = (await s.api("/api/paper", { member: tokens.Ben })).body;
  assert.deepEqual(r.rules, { feeBps: 5, minHoldings: 3, maxPositionPct: 30, minPrice: 2, minMarketCap: 1e8 });
  assert.deepEqual(Object.keys(r.horizons), ["weeks", "months", "year"]);
  assert.equal(r.mine.risk.sharpe, null);
  assert.deepEqual(r.mine.pending, []);
});

test("watchlists: holdings default, fund list, Following, private and shared lists", async () => {
  // Visitors see the two fund lists only.
  const pub = (await s.api("/api/watchlists")).body;
  assert.deepEqual(pub.map((l) => l.key), ["holdings", "fund"]);
  assert.ok(pub[0].count > 0, "holdings fill themselves");
  assert.equal((await s.api("/api/watchlists/holdings")).body.items.length, pub[0].count);
  assert.equal((await s.api("/api/watchlists/following")).status, 401);
  assert.equal((await s.api("/api/watchlists/holdings/items", { method: "POST", member: tokens.Ana, body: { symbol: "AAPL" } })).status, 403);

  // Ana makes a private list and a shared one.
  assert.equal((await s.api("/api/watchlists", { method: "POST", member: tokens.Ana, body: { name: "  " } })).status, 400);
  const priv = (await s.api("/api/watchlists", { method: "POST", member: tokens.Ana, body: { name: "Ana's ideas" } })).body;
  const club = (await s.api("/api/watchlists", { method: "POST", member: tokens.Ana, body: { name: "Consumer names", visibility: "club" } })).body;
  assert.deepEqual([priv.visibility, club.visibility, club.canManage], ["private", "club", true]);
  assert.equal((await s.api(`/api/watchlists/${priv.id}/items`, { method: "POST", member: tokens.Ana, body: { symbol: "$cost", note: "membership" } })).status, 201);
  assert.equal((await s.api(`/api/watchlists/${priv.id}/items`, { method: "POST", member: tokens.Ana, body: { symbol: "COST" } })).status, 409);
  assert.equal((await s.api(`/api/watchlists/${priv.id}/items`, { method: "POST", member: tokens.Ana, body: { symbol: "not a ticker" } })).status, 400);

  // Ben sees the shared list (not the private one), can add to it, but can't rename or delete it.
  const benLists = (await s.api("/api/watchlists?symbol=WMT", { member: tokens.Ben })).body;
  assert.ok(benLists.some((l) => l.id === club.id) && !benLists.some((l) => l.id === priv.id));
  assert.equal((await s.api(`/api/watchlists/${priv.id}`, { member: tokens.Ben })).status, 404);
  assert.equal((await s.api(`/api/watchlists/${priv.id}/items`, { method: "POST", member: tokens.Ben, body: { symbol: "WMT" } })).status, 404);
  assert.equal((await s.api(`/api/watchlists/${club.id}/items`, { method: "POST", member: tokens.Ben, body: { symbol: "WMT" } })).status, 201);
  const shared = (await s.api(`/api/watchlists/${club.id}`, { member: tokens.Ana })).body;
  assert.deepEqual(shared.items.map((i) => [i.symbol, i.addedBy]), [["WMT", "Ben"]]);
  assert.equal((await s.api("/api/watchlists?symbol=WMT", { member: tokens.Ana })).body.find((l) => l.id === club.id).has, true);
  assert.equal((await s.api(`/api/watchlists/${club.id}`, { method: "PUT", member: tokens.Ben, body: { name: "Mine now" } })).status, 403);
  assert.equal((await s.api(`/api/watchlists/${club.id}`, { method: "DELETE", member: tokens.Ben })).status, 403);
  assert.equal((await s.api(`/api/watchlists/${club.id}/items/WMT`, { method: "DELETE", member: tokens.Ana })).status, 204, "anyone can tidy a shared list");
  // An admin can rename a shared list but not make it private.
  assert.equal((await s.api(`/api/watchlists/${club.id}`, { method: "PUT", auth: true, body: { visibility: "private" } })).status, 403);
  assert.equal((await s.api(`/api/watchlists/${club.id}`, { method: "PUT", auth: true, body: { name: "Consumer staples" } })).body.name, "Consumer staples");
  // Ana turns her private list into a shared one; now Ben sees it.
  await s.api(`/api/watchlists/${priv.id}`, { method: "PUT", member: tokens.Ana, body: { visibility: "club" } });
  assert.equal((await s.api(`/api/watchlists/${priv.id}`, { member: tokens.Ben })).body.items[0].symbol, "COST");
  assert.equal((await s.api(`/api/watchlists/${priv.id}`, { method: "DELETE", member: tokens.Ana })).status, 204);

  // Following is the same list as the Follow button (the myTickers preference).
  assert.equal((await s.api("/api/watchlists/following/items", { method: "POST", member: tokens.Cy, body: { symbol: "nvda" } })).status, 201);
  assert.deepEqual((await s.api("/api/prefs", { member: tokens.Cy })).body.myTickers, ["NVDA"]);
  assert.equal((await s.api("/api/watchlists/following/items/NVDA", { method: "DELETE", member: tokens.Cy })).status, 204);
  // The fund watchlist through the new routes.
  assert.equal((await s.api("/api/watchlists/fund/items", { method: "POST", member: tokens.Cy, body: { symbol: "ZZLW" } })).status, 201);
  assert.ok((await s.api("/api/watchlist")).body.some((w) => w.symbol === "ZZLW"));
  assert.equal((await s.api("/api/watchlists/fund/items/ZZLW", { method: "DELETE", member: tokens.Cy })).status, 204);
});

test("club sign-up link: admin makes it, anyone with it joins as an Analyst, turning it off stops it", async () => {
  assert.equal((await s.api("/api/auth/join-link", { method: "POST", member: tokens.Ana, body: {} })).status, 403, "admins only");
  assert.equal((await s.api("/api/auth/join/nope")).status, 404);
  const made = await s.api("/api/auth/join-link", { method: "POST", auth: true, body: { days: 7 } });
  assert.equal(made.status, 201);
  const token = made.body.link.token;
  assert.equal((await s.api(`/api/auth/join/${token}`)).status, 200);
  const bad = (body) => s.api(`/api/auth/join/${token}`, { method: "POST", body });
  assert.equal((await bad({ name: "Dee Dee", email: "nope", password: "long-enough-pw" })).status, 400);
  assert.equal((await bad({ name: "Dee Dee", email: "dee@test.edu", password: "short" })).status, 400);
  assert.equal((await bad({ name: "Dee Dee", email: "ana@test.edu", password: "long-enough-pw" })).status, 409, "email already has an account");
  assert.equal((await bad({ name: "ana", email: "other@test.edu", password: "long-enough-pw" })).status, 409, "name taken (any case)");
  const joined = await bad({ name: "  Quinn   Quill ", email: "Quinn@Test.edu", password: "long-enough-pw" });
  assert.equal(joined.status, 201, joined.text);
  assert.deepEqual([joined.body.member.name, joined.body.member.title, joined.body.member.isAdmin, joined.body.member.canTrade], ["Quinn Quill", "Analyst", false, false]);
  assert.ok(joined.cookie, "signed in right away");
  assert.equal((await s.api("/api/paper/seasons", { method: "POST", member: joined.cookie, body: {} })).status, 403, "no admin rights");
  assert.equal((await s.api("/api/positions", { method: "POST", member: joined.cookie, body: { symbol: "X", shares: 1 } })).status, 403, "no trading");
  assert.equal((await s.api("/api/chat/messages", { member: joined.cookie })).status, 200, "member features work");
  assert.equal((await s.api("/api/auth/session", { member: joined.cookie })).body.member.email, "quinn@test.edu");
  assert.equal((await s.api("/api/auth/join-link", { auth: true })).body.link.uses, 1);
  // Admins hear about it.
  assert.ok((await s.api("/api/notifications", { auth: true })).body.items.some((n) => n.type === "memberJoined" && /Quinn Quill/.test(n.title)));
  // A new link kills the old one; turning off kills everything.
  const next = (await s.api("/api/auth/join-link", { method: "POST", auth: true, body: {} })).body.link.token;
  assert.equal((await s.api(`/api/auth/join/${token}`)).status, 404);
  assert.equal((await s.api(`/api/auth/join/${next}`)).status, 200);
  assert.equal((await s.api("/api/auth/join-link", { method: "DELETE", auth: true })).status, 204);
  assert.equal((await s.api(`/api/auth/join/${next}`, { method: "POST", body: { name: "Late Larry", email: "l@test.edu", password: "long-enough-pw" } })).status, 404);
  assert.equal((await s.api("/api/auth/join-link", { auth: true })).body.link, null);
});

test("server log has no unexpected errors (after the newest features)", () => {
  assert.ok(!/TypeError|ReferenceError|SqliteError/.test(s.log()), s.log());
});

test("first-admin setup takes over an old PIN-era member with the same name", async () => {
  // Boot once so the schema exists, then add the kind of row the old PIN system left behind.
  const first = await startServer();
  await first.stop({ keep: true });
  const Database = require("libsql");
  const raw = new Database(first.dbPath);
  raw.prepare("INSERT INTO members (name, role, pinHash) VALUES ('Old Member', 'analyst', 'salt:hash')").run();
  raw.close();
  const t = await startServer({ dir: first.dir });
  try {
    const r = await t.api("/api/auth/setup", { method: "POST", body: { setupPassword: PASSWORD, name: "Old Member", email: "old@test.edu", password: ADMIN_PASSWORD } });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.body.member.isAdmin, true);
    assert.ok(r.cookie, "signed in");
    const again = await t.api("/api/auth/setup", { method: "POST", body: { setupPassword: PASSWORD, name: "Someone", email: "x@test.edu", password: ADMIN_PASSWORD } });
    assert.equal(again.status, 409);
  } finally { await t.stop(); }
});
