// "Start here" learning path: milestones come from what the member did, lessons point at real
// glossary terms and routes, and the new prefs validate.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { startServer } = require("./helpers");

test("Learn content: every lesson term is in the glossary and every link is a real route", async () => {
  const { LESSONS, ACTION_KEYS, learnSummary } = await import("../public/learnContent.js");
  const { GLOSSARY } = await import("../public/glossary.js");
  const app = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");
  for (const l of LESSONS) {
    for (const t of l.terms) assert.ok(GLOSSARY[t], `${l.id}: glossary has no "${t}"`);
    for (const a of l.actions) {
      const first = a.href.replace(/^#/, "").split("/").filter(Boolean)[0];
      assert.ok(a.href === "#/" || app.includes(`"/${first}`), `${l.id}: no route for ${a.href}`);
    }
  }
  assert.deepEqual(ACTION_KEYS.sort(), ["agentCreated", "agentFollowed", "feedComment", "note", "paperThesis", "paperTrade", "pitch", "vote", "watchlist"]);
  const none = learnSummary({}, []);
  assert.equal(none.count, 0);
  assert.equal(none.next.id, LESSONS[0].id);
  const all = learnSummary(Object.fromEntries(ACTION_KEYS.map((k) => [k, true])), LESSONS.map((l) => l.id));
  assert.equal(all.finished, true);
  assert.equal(all.pct, 100);
  // A lesson read but with an undone action stays "next".
  assert.equal(learnSummary({}, LESSONS.map((l) => l.id)).next.id, "company");
});

test("API: learn progress follows what the member did; prefs validate", async () => {
  const s = await startServer();
  try {
    assert.equal((await s.api("/api/learn/progress")).status, 401);
    const empty = await s.api("/api/learn/progress", { auth: true });
    assert.ok(Object.values(empty.body.done).length >= 9 && Object.values(empty.body.done).every((v) => v === false), JSON.stringify(empty.body.done));

    const note = await s.api("/api/notes", { method: "POST", auth: true, body: { symbol: "NVDA", body: "Sells the chips behind most AI training." } });
    assert.ok(note.status < 300, JSON.stringify(note.body));
    const list = await s.api("/api/watchlists", { method: "POST", auth: true, body: { name: "Mine" } });
    assert.ok(list.status < 300, JSON.stringify(list.body));
    const after = (await s.api("/api/learn/progress", { auth: true })).body.done;
    assert.equal(after.note, true);
    assert.equal(after.paperTrade, false);

    const ok = await s.api("/api/prefs", { method: "PUT", auth: true, body: { learnRead: ["fund", "fund", "Bad Id!"], learnHidden: true } });
    assert.deepEqual(ok.body.learnRead, ["fund"]);
    assert.equal(ok.body.learnHidden, true);
    assert.equal((await s.api("/api/prefs", { method: "PUT", auth: true, body: { learnHidden: "yes" } })).status, 400);
  } finally { await s.stop(); }
});

test("Learn: every lesson has a quiz whose answers exist; paper rules and first-pitch guide read cleanly", async () => {
  const { LESSONS, QUIZ, FIRST_PITCH } = await import("../public/learnContent.js");
  const { ruleExplanations } = await import("../public/paperExplain.js");
  for (const l of LESSONS) {
    assert.ok(QUIZ[l.id]?.length >= 2, `${l.id} needs a quiz`);
    for (const q of QUIZ[l.id]) {
      assert.ok(q.a >= 0 && q.a < q.o.length, `${l.id}: bad answer index`);
      assert.ok(q.why.length > 20);
    }
  }
  assert.equal(FIRST_PITCH.length, 6);
  const rules = ruleExplanations({ feeBps: 10, minHoldings: 5, maxPositionPct: 25, minPrice: 5, minMarketCap: 3e8 });
  const titles = rules.map((r) => r[0]).join("|");
  assert.match(titles, /0\.10% a trade/);
  assert.match(titles, /At least 5 holdings/);
  assert.match(titles, /25% in one stock/);
  assert.match(titles, /\$5 and \$300 million/);
});
