// In-process app event bus (plan 3.4). Producers emit app events; the agent trigger matcher
// (WS2) and memory/handoff code (WS5) subscribe. Handlers run after the emitter returns
// (setImmediate), one failure never stops the others, and nothing here calls a model.
//
// Event types in use (append-only): 'filing', 'price_move', 'earnings_soon', 'insider_buy',
// 'tripwire', 'news_high', 'thirteenf', 'ips_breach', 'pitch_status', 'estimate_revision',
// 'agent_output', 'handoff', 'feed'.
//
//   bus.on("agent_output", async ({ runId, agentId, workflow, symbol, output }) => { ... })
//   bus.emit("tripwire", { symbol: "NVDA", tripwireId: 4 })
//   bus.handoff({ fromAgentId, fromRunId, topic: "thesis", kind: "handoff", symbol, payload })
const handlers = new Map(); // type -> Set(fn); '*' gets every event
const RECENT_MAX = 200;
const recentEvents = []; // last RECENT_MAX events, for the health page and replay in tests

function on(type, fn) {
  if (!handlers.has(type)) handlers.set(type, new Set());
  handlers.get(type).add(fn);
  return () => off(type, fn);
}
function off(type, fn) { handlers.get(type)?.delete(fn); }

// Fire-and-forget. Returns the number of handlers scheduled. `{ sync: true }` awaits them all
// (tests, and callers that need the trigger matcher to have run).
function emit(type, payload = {}, { sync = false } = {}) {
  const event = { type, payload, at: new Date().toISOString() };
  recentEvents.push(event);
  if (recentEvents.length > RECENT_MAX) recentEvents.shift();
  const list = [...(handlers.get(type) || []), ...(handlers.get("*") || [])];
  const runAll = () => Promise.all(list.map(async (fn) => {
    try { await fn(payload, event); } catch (err) { console.error(`[bus] ${type} handler failed:`, err?.message || err); }
  }));
  if (sync) return runAll().then(() => list.length);
  if (list.length) setImmediate(runAll);
  return list.length;
}

function recent({ type = null, limit = 50 } = {}) {
  const rows = type ? recentEvents.filter((e) => e.type === type) : recentEvents;
  return rows.slice(-limit).reverse();
}

// An agent hands work or a finding to another agent (toAgentId) or to everyone listening on a
// topic (toAgentId null). Writes agent_messages and emits 'handoff'. Returns the message id.
const HANDOFF_KINDS = ["handoff", "finding", "request", "answer"];
function handoff({ fromAgentId = null, fromRunId = null, toAgentId = null, topic = null, kind = "handoff", symbol = null, payload = {} }) {
  if (!HANDOFF_KINDS.includes(kind)) throw new Error(`handoff kind must be one of ${HANDOFF_KINDS.join(", ")}`);
  if (!toAgentId && !topic) throw new Error("handoff needs toAgentId or topic");
  const db = require("../../db");
  const info = db.prepare(`INSERT INTO agent_messages (fromAgentId, fromRunId, toAgentId, topic, kind, symbol, payload)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(fromAgentId, fromRunId, toAgentId, topic, kind, symbol, JSON.stringify(payload ?? {}));
  const id = Number(info.lastInsertRowid);
  emit("handoff", { id, fromAgentId, fromRunId, toAgentId, topic, kind, symbol, payload });
  return id;
}

// Claims an open message for a run (first claimer wins). Returns true if this run got it.
function claim(messageId, runId) {
  const db = require("../../db");
  return db.prepare("UPDATE agent_messages SET status = 'claimed', claimedByRunId = ? WHERE id = ? AND status = 'open'").run(runId, messageId).changes === 1;
}

function _reset() { handlers.clear(); recentEvents.length = 0; }

module.exports = { on, off, emit, recent, handoff, claim, HANDOFF_KINDS, _reset };
