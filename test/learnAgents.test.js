// "Set up your first agent" lesson: its three milestones come from the agent platform tables
// (lib/schema/platform.js). Before those tables exist the milestones read false instead of
// crashing; once they exist, each one turns true from the member's own rows.
require("./tmpdb");
const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../db");
const { learnProgress } = require("../lib/learnProgress");

const tableExists = (n) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(n);

test("agent milestones are false (not an error) for a member with no agent activity", () => {
  const p = learnProgress(999999);
  assert.equal(p.agentCreated, false);
  assert.equal(p.agentFollowed, false);
  assert.equal(p.feedComment, false);
});

test("agent milestones follow the member's own agent rows", { skip: !tableExists("agents") && "agent platform tables not on this branch yet" }, () => {
  const add = (name) => Number(db.prepare("INSERT INTO members (name, pinHash) VALUES (?, 'x')").run(name).lastInsertRowid);
  const ana = add("LearnAna"), ben = add("LearnBen");
  const agent = (slug, ownerId) => Number(db.prepare("INSERT INTO agents (slug, name, kind, workflow, ownerId) VALUES (?, ?, 'custom', 'engine', ?)").run(slug, slug, ownerId).lastInsertRowid);
  const own = agent("learn-ana-own", ana);
  const bens = agent("learn-ben-own", ben);
  assert.equal(learnProgress(ana).agentCreated, true);
  // Following your own agent doesn't count: the step is about using a teammate's.
  db.prepare("INSERT INTO agent_follows (agentId, memberId) VALUES (?, ?)").run(own, ana);
  assert.equal(learnProgress(ana).agentFollowed, false);
  db.prepare("INSERT INTO agent_follows (agentId, memberId) VALUES (?, ?)").run(bens, ana);
  assert.equal(learnProgress(ana).agentFollowed, true);
  const item = Number(db.prepare("INSERT INTO feed_items (kind, actorType, title) VALUES ('agent_brief', 'agent', 'x')").run().lastInsertRowid);
  db.prepare("INSERT INTO feed_comments (itemId, memberId, text) VALUES (?, ?, ?)").run(item, ana, "Good catch on the margin line.");
  assert.equal(learnProgress(ana).feedComment, true);
  assert.equal(learnProgress(ben).feedComment, false);
});
