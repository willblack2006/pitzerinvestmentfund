// Ask PIF conversations (WS11): threads, turns, @agent addressing, sharing with the team.
// Each turn is one ask_pif run, started in the background so the page can stream it
// (lib/agents/stream.js). Tables: lib/schema/ask.js. The agents and feed tables come from the
// platform foundation (WS1); every use of them is guarded so this works before they exist.
const db = require("../../db");
const runs = require("./runs");
const stream = require("./stream");
const { ask } = require("./workflows/ask");

const tryGet = (sql, ...a) => { try { return db.prepare(sql).get(...a); } catch { return undefined; } };
const tryAll = (sql, ...a) => { try { return db.prepare(sql).all(...a); } catch { return []; } };
const tryRun = (sql, ...a) => { try { return db.prepare(sql).run(...a); } catch { return null; } };
const parse = (s, d = null) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
// "@earnings-watch what changed?" -> { slug: "earnings-watch", rest: "what changed?" }
function parseMention(question) {
  const m = /^\s*@([a-z0-9][a-z0-9-]{0,62})\b[\s,:]*/i.exec(String(question || ""));
  return m ? { slug: m[1].toLowerCase(), rest: String(question).slice(m[0].length).trim() } : null;
}

// Team agents a member can address: team-visible ones and their own private ones, not archived.
function addressableAgents(member) {
  const rows = tryAll(`SELECT id, slug, name, description, icon, kind, workflow, ownerId, visibility, status, spec FROM agents
    WHERE status != 'archived' AND (visibility = 'team' OR ownerId = ?) ORDER BY kind = 'builtin', name`, member.id);
  return rows.map((a) => ({ id: a.id, slug: a.slug, name: a.name, description: a.description || "", icon: a.icon || "bot", kind: a.kind, status: a.status, mine: a.ownerId === member.id }));
}

// The persona Ask PIF answers as when a member writes @slug. null when there is no such agent
// (or the agents table doesn't exist yet).
function personaFor(slug, member) {
  if (!slug || !SLUG.test(slug)) return null;
  const a = tryGet("SELECT id, slug, name, description, ownerId, visibility, status, spec FROM agents WHERE slug = ?", slug);
  if (!a || a.status === "archived" || (a.visibility === "private" && a.ownerId !== member.id && !member.isAdmin)) return null;
  const spec = parse(a.spec, {});
  const instructions = (spec.steps || []).filter((s) => s.type === "ai" && s.instructions).map((s) => s.instructions).join("\n\n") || a.description || "";
  const symbols = spec.scope?.universe === "symbols" ? (spec.scope.symbols || []) : [];
  return { id: a.id, slug: a.slug, name: a.name, description: a.description || "", instructions, symbols };
}

const canSee = (t, member) => !!t && !t.archivedAt && (t.memberId === member.id || t.visibility === "team" || member.isAdmin);

function threadRow(id) { return db.prepare("SELECT * FROM ask_threads WHERE id = ?").get(Number(id)); }

function feedbackFor(runIds, memberId) {
  if (!runIds.length) return {};
  const rows = tryAll(`SELECT runId, verdict, memberId FROM agent_feedback WHERE runId IN (${runIds.map(() => "?").join(",")})`, ...runIds);
  const out = {};
  for (const r of rows) {
    const f = (out[r.runId] ||= { useful: 0, wrong: 0, not_useful: 0, mine: null });
    f[r.verdict]++;
    if (r.memberId === memberId) f.mine = r.verdict;
  }
  return out;
}

function threadView(t, member, { withTurns = false } = {}) {
  const owner = t.memberId ? db.prepare("SELECT id, name FROM members WHERE id = ?").get(t.memberId) : null;
  const count = db.prepare("SELECT COUNT(*) AS c FROM ask_messages WHERE threadId = ?").get(t.id).c;
  const base = {
    id: t.id, title: t.title, agentSlug: t.agentSlug, visibility: t.visibility, sharedAt: t.sharedAt, forkedFrom: t.forkedFrom,
    createdAt: t.createdAt, updatedAt: t.updatedAt, turns: count, mine: t.memberId === member.id, owner: owner ? { id: owner.id, name: owner.name } : null,
  };
  if (!withTurns) return base;
  const msgs = db.prepare(`SELECT m.id, m.question, m.agentSlug, m.runId, m.createdAt, m.memberId, r.status, r.output, r.error, r.costUsd
    FROM ask_messages m LEFT JOIN agent_runs r ON r.id = m.runId WHERE m.threadId = ? ORDER BY m.id`).all(t.id);
  const fb = feedbackFor(msgs.map((m) => m.runId).filter(Boolean), member.id);
  return { ...base, messages: msgs.map((m) => ({
    id: m.id, question: m.question, agentSlug: m.agentSlug, runId: m.runId, createdAt: m.createdAt,
    status: m.status || "failed", error: m.error, costUsd: m.costUsd, output: parse(m.output),
    feedback: fb[m.runId] || { useful: 0, wrong: 0, not_useful: 0, mine: null },
  })) };
}

function listThreads(member, { scope = "mine", limit = 30, q = "" } = {}) {
  const like = q ? `%${String(q).slice(0, 80)}%` : null;
  const where = scope === "team" ? "visibility = 'team'" : "memberId = @me";
  const rows = db.prepare(`SELECT * FROM ask_threads WHERE archivedAt IS NULL AND ${where} ${like ? "AND title LIKE @like" : ""} ORDER BY updatedAt DESC, id DESC LIMIT @limit`)
    .all({ me: member.id, limit: Math.min(100, Math.max(1, Number(limit) || 30)), ...(like ? { like } : {}) });
  return rows.map((t) => threadView(t, member));
}

// Earlier turns (question + answer text) for a follow-up.
function historyOf(threadId) {
  return db.prepare(`SELECT m.question, r.output FROM ask_messages m LEFT JOIN agent_runs r ON r.id = m.runId WHERE m.threadId = ? ORDER BY m.id DESC LIMIT 3`)
    .all(threadId).reverse().map((m) => ({ question: m.question, answer: parse(m.output)?.answer || "" }));
}

// Starts one Ask turn in the background. Resolves with the run id as soon as the run exists;
// the answer arrives on the run's stream (and in agent_runs).
function startTurn({ member, question, persona, history }) {
  return new Promise((resolve, reject) => {
    let id = null;
    const addressed = persona?.id ? { agentId: persona.id, trigger: "mention", triggeredBy: member.id } : {};
    runs.run({ workflow: "ask_pif", memberId: member.id, ...addressed, onCreate: (runId) => { id = runId; stream.expect(runId); resolve(runId); } },
      (ctx) => ask({ question, history, persona }, ctx))
      .catch((err) => { if (id == null) reject(err); /* else: recorded on the run and sent on its stream */ });
  });
}

const titleOf = (q) => { const t = String(q).replace(/\s+/g, " ").trim(); return t.length > 80 ? `${t.slice(0, 77)}…` : t; };

// Validates the question and the @agent. Returns { question, persona, slug } or throws a 400.
function prepare(member, rawQuestion, agentSlug) {
  let question = String(rawQuestion || "").trim().slice(0, 1000);
  let slug = agentSlug ? String(agentSlug).toLowerCase() : null;
  const m = parseMention(question);
  if (m) { slug = m.slug; question = m.rest; }
  if (question.length < 3) throw Object.assign(new Error("Ask a question."), { status: 400 });
  let persona = null;
  if (slug) {
    persona = personaFor(slug, member);
    if (!persona) throw Object.assign(new Error(`There is no team agent called @${slug}.`), { status: 400, code: "no_such_agent" });
  }
  return { question, persona, slug: persona?.slug || null };
}

async function createThread(member, { question, agentSlug = null, forkOf = null } = {}) {
  const p = prepare(member, question, agentSlug);
  let history = [];
  if (forkOf) {
    const src = threadRow(forkOf);
    if (!canSee(src, member)) throw Object.assign(new Error("No such conversation."), { status: 404 });
    history = historyOf(src.id);
  }
  const runId = await startTurn({ member, question: p.question, persona: p.persona, history });
  const tid = Number(db.prepare("INSERT INTO ask_threads (memberId, title, agentSlug, forkedFrom) VALUES (?, ?, ?, ?)").run(member.id, titleOf(p.question), p.slug, forkOf ? Number(forkOf) : null).lastInsertRowid);
  // A continued conversation keeps the earlier turns visible as the start of the new thread.
  if (forkOf) db.prepare("INSERT INTO ask_messages (threadId, memberId, question, agentSlug, runId, createdAt) SELECT ?, memberId, question, agentSlug, runId, createdAt FROM ask_messages WHERE threadId = ? ORDER BY id").run(tid, Number(forkOf));
  const mid = Number(db.prepare("INSERT INTO ask_messages (threadId, memberId, question, agentSlug, runId) VALUES (?, ?, ?, ?, ?)").run(tid, member.id, p.question, p.slug, runId).lastInsertRowid);
  return { thread: threadView(threadRow(tid), member), runId, messageId: mid };
}

async function addTurn(member, threadId, { question, agentSlug = null } = {}) {
  const t = threadRow(threadId);
  if (!canSee(t, member)) throw Object.assign(new Error("No such conversation."), { status: 404 });
  if (t.memberId !== member.id) throw Object.assign(new Error("This is a teammate's conversation. Continue it as your own instead."), { status: 403, code: "not_owner" });
  const p = prepare(member, question, agentSlug || t.agentSlug);
  const runId = await startTurn({ member, question: p.question, persona: p.persona, history: historyOf(t.id) });
  const mid = Number(db.prepare("INSERT INTO ask_messages (threadId, memberId, question, agentSlug, runId) VALUES (?, ?, ?, ?, ?)").run(t.id, member.id, p.question, p.slug, runId).lastInsertRowid);
  db.prepare("UPDATE ask_threads SET updatedAt = datetime('now') WHERE id = ?").run(t.id);
  return { thread: threadView(threadRow(t.id), member), runId, messageId: mid };
}

// Share with the team (or take back). Posts one feed item the first time (WS1/WS7 feed), and
// marks the runs shared so teammates can open them.
function share(member, threadId, on = true) {
  const t = threadRow(threadId);
  if (!canSee(t, member) || (t.memberId !== member.id && !member.isAdmin)) throw Object.assign(new Error("No such conversation."), { status: 404 });
  const runIds = db.prepare("SELECT runId FROM ask_messages WHERE threadId = ? AND runId IS NOT NULL").all(t.id).map((r) => r.runId);
  db.prepare("UPDATE ask_threads SET visibility = ?, sharedAt = CASE WHEN ? THEN COALESCE(sharedAt, datetime('now')) ELSE sharedAt END, updatedAt = updatedAt WHERE id = ?").run(on ? "team" : "private", on ? 1 : 0, t.id);
  for (const id of runIds) tryRun("UPDATE agent_runs SET shared = ? WHERE id = ?", on ? 1 : 0, id);
  let feedItemId = t.feedItemId;
  if (on && !feedItemId) {
    try {
      const feed = require("../platform/feed");
      const last = db.prepare("SELECT m.runId, r.output FROM ask_messages m LEFT JOIN agent_runs r ON r.id = m.runId WHERE m.threadId = ? ORDER BY m.id DESC LIMIT 1").get(t.id);
      const out = parse(last?.output, {});
      feedItemId = feed.post({
        kind: "ask_shared", actorType: "member", actorId: member.id, runId: last?.runId || null, symbol: null,
        title: t.title, body: { threadId: t.id, answer: String(out.answer || "").slice(0, 600), turns: runIds.length, agentSlug: t.agentSlug, link: `#/agents/ask?thread=${t.id}` },
        importance: "normal",
      });
      if (feedItemId) db.prepare("UPDATE ask_threads SET feedItemId = ? WHERE id = ?").run(feedItemId, t.id);
    } catch { /* the feed isn't there yet: the thread is still shared in the Ask tab */ }
  }
  return threadView(threadRow(t.id), member);
}

function rename(member, threadId, title) {
  const t = threadRow(threadId);
  if (!t || t.memberId !== member.id || t.archivedAt) throw Object.assign(new Error("No such conversation."), { status: 404 });
  const clean = String(title || "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!clean) throw Object.assign(new Error("A title is required."), { status: 400 });
  db.prepare("UPDATE ask_threads SET title = ? WHERE id = ?").run(clean, t.id);
  return threadView(threadRow(t.id), member);
}

function archive(member, threadId) {
  const t = threadRow(threadId);
  if (!t || (t.memberId !== member.id && !member.isAdmin) || t.archivedAt) throw Object.assign(new Error("No such conversation."), { status: 404 });
  db.prepare("UPDATE ask_threads SET archivedAt = datetime('now') WHERE id = ?").run(t.id);
}

// Can this member watch run `id`? Their own, any agent run, or a turn of a thread shared with the team.
function canWatchRun(member, run) {
  if (!run) return false;
  if (!run.memberId || run.memberId === member.id || member.isAdmin) return true;
  if (run.shared) return true;
  return !!tryGet("SELECT 1 AS ok FROM ask_messages m JOIN ask_threads t ON t.id = m.threadId WHERE m.runId = ? AND t.visibility = 'team' AND t.archivedAt IS NULL", run.id);
}

module.exports = { parseMention, addressableAgents, personaFor, listThreads, threadView, threadRow, canSee, createThread, addTurn, share, rename, archive, canWatchRun, historyOf };
