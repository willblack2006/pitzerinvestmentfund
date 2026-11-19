// Sharing private AI runs to the team feed (WS7). Ask PIF answers and research desk runs are
// private to the member who asked. "Share to feed" sets agent_runs.shared = 1 and posts an
// ask_shared item; teammates can then read the full run and "Ask a follow-up" as their own run
// with the shared answer as context.
const { db, ensure, runsHas } = require("./store");
const activity = require("./activity");
const mentions = require("./mentions");

const SHAREABLE = ["ask_pif", "compare", "what_if", "meeting_prep", "ideas", "pitch_primer", "red_team", "filing_brief", "filing_change_brief"];
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status, expose: true });
const clip = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

const parse = (s) => { try { return JSON.parse(s || "null"); } catch { return null; } };

// The feed item that shares this run, if any.
function itemForRun(runId) {
  if (!ensure()) return null;
  return db.prepare("SELECT id FROM feed_items WHERE kind = 'ask_shared' AND runId = ? ORDER BY id DESC LIMIT 1").get(runId)?.id ?? null;
}

function isShared(run) {
  if (runsHas("shared") && run.shared) return true;
  return itemForRun(run.id) != null;
}

// Shares one of the member's own finished runs. Idempotent: sharing again returns the same item.
function share(member, runId, { note = "" } = {}) {
  if (!ensure()) throw bad("The team feed isn't set up on this server yet.", 503);
  const run = db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(Number(runId));
  if (!run || run.memberId !== member.id) throw bad("You can only share your own runs.", 404);
  if (run.status !== "done") throw bad("Only a finished run can be shared.", 409);
  if (!SHAREABLE.includes(run.workflow)) throw bad("This kind of run can't be shared from here.", 400);
  const existing = itemForRun(run.id);
  if (existing) return { itemId: existing, already: true };
  const out = parse(run.output) || {};
  const question = clip(out.question || out.title, 300);
  const answer = mentions.textOf(out);
  if (runsHas("shared")) db.prepare("UPDATE agent_runs SET shared = 1 WHERE id = ?").run(run.id);
  const itemId = activity.post({
    kind: "ask_shared", actorType: "member", actorId: member.id, runId: run.id, symbol: run.symbol || (out.symbols?.[0] ?? null),
    title: question ? `${member.name} asked: ${question}` : `${member.name} shared an AI answer`,
    body: {
      workflow: run.workflow, question, note: clip(note, 500) || undefined,
      answer: clip(answer, 1800), claims: (out.claims || []).slice(0, 6).map((c) => ({ text: clip(c.text, 200), source_url: c.source_url || null, sourced: !!c.sourced })),
      followUps: (out.followUps || []).slice(0, 3), costUsd: run.costUsd ?? null,
    },
  });
  if (itemId == null) {
    if (runsHas("shared")) db.prepare("UPDATE agent_runs SET shared = 0 WHERE id = ?").run(run.id);
    throw bad("Couldn't post to the team feed right now.", 503);
  }
  return { itemId, already: false };
}

// Takes a shared run back off the feed (the author or an admin). Comments go with it.
function unshare(member, runId) {
  if (!ensure()) throw bad("The team feed isn't set up on this server yet.", 503);
  const run = db.prepare("SELECT id, memberId FROM agent_runs WHERE id = ?").get(Number(runId));
  if (!run || (run.memberId !== member.id && !member.isAdmin)) throw bad("Run not found.", 404);
  const items = db.prepare("SELECT id FROM feed_items WHERE kind = 'ask_shared' AND runId = ?").all(run.id).map((r) => r.id);
  for (const id of items) {
    db.prepare("DELETE FROM feed_comments WHERE itemId = ?").run(id);
    db.prepare("DELETE FROM feed_reactions WHERE itemId = ?").run(id);
    db.prepare("DELETE FROM feed_pins WHERE itemId = ?").run(id);
    db.prepare("DELETE FROM feed_items WHERE id = ?").run(id);
  }
  if (runsHas("shared")) db.prepare("UPDATE agent_runs SET shared = 0 WHERE id = ?").run(run.id);
  try { require("../events").publish("feed.removed", { ids: items }, { membersOnly: true }); } catch { /* best effort */ }
  return { removed: items.length };
}

// Can `member` read this run? Their own, an admin, a fund-wide agent run, or one shared to the feed.
function canRead(member, run) {
  if (!run) return false;
  if (!run.memberId || run.memberId === member.id || member.isAdmin) return true;
  return isShared(run);
}

// A teammate continues a shared conversation as their own run (billed to them). The shared
// answer goes in as untrusted context; the new run is private until they share it too.
async function followUp(member, itemId, question, { runner } = {}) {
  if (!ensure()) throw bad("The team feed isn't set up on this server yet.", 503);
  const q = String(question || "").trim();
  if (q.length < 3) throw bad("Ask a question.");
  const item = require("./query").get(member, itemId);
  if (!item) throw bad("That feed item isn't there.", 404);
  const parent = item.runId ? db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(item.runId) : null;
  const out = parse(parent?.output) || {};
  const context = [
    mentions.itemContext(item),
    out.question ? `Original question: ${clip(out.question, 400)}` : null,
    out.answer ? `Answer the team saw:\n${clip(out.answer, 2500)}` : null,
  ].filter(Boolean).join("\n");
  const go = runner || (async () => {
    const runs = require("../agents/runs");
    const { ask } = require("../agents/workflows/ask");
    return runs.run({ workflow: "ask_pif", memberId: member.id, symbol: item.symbol || null, parentRunId: parent?.id ?? null, trigger: "manual", triggeredBy: member.id },
      (ctx) => ask({ question: q, context }, ctx));
  });
  const r = await go({ question: q, context, item, parent });
  return { runId: r.runId, output: r.output, costUsd: r.costUsd, parentRunId: parent?.id ?? null };
}

module.exports = { share, unshare, followUp, canRead, isShared, itemForRun, SHAREABLE };
