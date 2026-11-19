// Shared agent memory (plan 3.3). WS1 version: plain SQL, newest first, no ranking. WS5 owns
// this file and adds ranking, `query` matching and the <memory> prompt blocks; the signatures
// below stay.
//
//   remember({ scope, scopeKey, kind, text, sourceRunId, sourceUrl, asOf, confidence, agentId, memberId }) -> id
//   recall({ symbol, agentId, memberId, kinds, limit = 20, query }) -> [{ id, scope, kind, text, sourceUrl, asOf, createdAt, by }]
//   supersede(oldId, newFields) -> id ;  retract(id, memberId)
//   dossier(symbol) -> { facts, observations, decisions, openQuestions, predictions, lastUpdated }
const db = require("../../db");

const SCOPES = ["fund", "symbol", "agent", "member"];
const KINDS = ["fact", "observation", "decision", "preference", "open_question", "prediction"];
const MAX_TEXT = 2000;

function remember({ scope, scopeKey = null, kind, text, sourceRunId = null, sourceUrl = null, asOf = null, confidence = null, agentId = null, memberId = null, status = "active", supersedesId = null, expiresAt = null }) {
  if (!SCOPES.includes(scope)) throw new Error(`memory scope must be one of ${SCOPES.join(", ")}`);
  if (!KINDS.includes(kind)) throw new Error(`memory kind must be one of ${KINDS.join(", ")}`);
  const t = String(text || "").trim();
  if (!t) throw new Error("memory text is required");
  if (scope === "symbol" && scopeKey) scopeKey = String(scopeKey).toUpperCase();
  if (scope !== "fund" && scopeKey == null) throw new Error(`memory scope "${scope}" needs a scopeKey`);
  const info = db.prepare(`INSERT INTO agent_memory (scope, scopeKey, kind, text, sourceRunId, sourceUrl, asOf, confidence, status, supersedesId, createdByAgent, createdByMember, expiresAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(scope, scopeKey == null ? null : String(scopeKey), kind, t.slice(0, MAX_TEXT), sourceRunId, sourceUrl, asOf, confidence, status, supersedesId, agentId, memberId, expiresAt);
  return Number(info.lastInsertRowid);
}

const shape = (r) => ({
  id: r.id, scope: r.scope, scopeKey: r.scopeKey, kind: r.kind, text: r.text, sourceUrl: r.sourceUrl, sourceRunId: r.sourceRunId,
  asOf: r.asOf, confidence: r.confidence, createdAt: r.createdAt,
  by: r.createdByAgent ? { type: "agent", id: r.createdByAgent, name: r.agentName || null } : r.createdByMember ? { type: "member", id: r.createdByMember, name: r.memberName || null } : null,
});

// Active, unexpired memories relevant to a symbol, an agent and/or a member, plus fund-wide ones.
function recall({ symbol = null, agentId = null, memberId = null, kinds = null, limit = 20, query = null } = {}) {
  const scopes = ["m.scope = 'fund'"];
  const params = { now: new Date().toISOString(), limit: Math.min(Math.max(Number(limit) || 20, 1), 200) };
  if (symbol) { scopes.push("(m.scope = 'symbol' AND m.scopeKey = @symbol)"); params.symbol = String(symbol).toUpperCase(); }
  if (agentId) { scopes.push("(m.scope = 'agent' AND m.scopeKey = @agentKey)"); params.agentKey = String(agentId); }
  if (memberId) { scopes.push("(m.scope = 'member' AND m.scopeKey = @memberKey)"); params.memberKey = String(memberId); }
  const where = [`(${scopes.join(" OR ")})`, "m.status = 'active'", "(m.expiresAt IS NULL OR m.expiresAt > @now)"];
  if (Array.isArray(kinds) && kinds.length) {
    const ks = kinds.filter((k) => KINDS.includes(k));
    where.push(`m.kind IN (${ks.map((k) => `'${k}'`).join(",") || "''"})`);
  }
  if (query) { where.push("m.text LIKE @q"); params.q = `%${String(query).replace(/[%_]/g, "")}%`; }
  return db.prepare(`SELECT m.*, a.name AS agentName, mb.name AS memberName FROM agent_memory m
      LEFT JOIN agents a ON a.id = m.createdByAgent LEFT JOIN members mb ON mb.id = m.createdByMember
    WHERE ${where.join(" AND ")} ORDER BY m.id DESC LIMIT @limit`).all(params).map(shape);
}

// Replaces a memory with a corrected one; the old row stays as 'superseded' for history.
function supersede(oldId, newFields = {}) {
  const old = db.prepare("SELECT * FROM agent_memory WHERE id = ?").get(oldId);
  if (!old) throw new Error(`No memory ${oldId}`);
  const tx = db.transaction(() => {
    const id = remember({
      scope: old.scope, scopeKey: old.scopeKey, kind: old.kind, text: old.text, sourceRunId: old.sourceRunId, sourceUrl: old.sourceUrl,
      asOf: old.asOf, confidence: old.confidence, agentId: old.createdByAgent, memberId: old.createdByMember, expiresAt: old.expiresAt,
      ...newFields, supersedesId: oldId,
    });
    db.prepare("UPDATE agent_memory SET status = 'superseded' WHERE id = ?").run(oldId);
    return id;
  });
  return tx();
}

// memberId is who retracted it (WS5 records it; the WS1 table has no column for it yet).
function retract(id, memberId = null) { // eslint-disable-line no-unused-vars
  return db.prepare("UPDATE agent_memory SET status = 'retracted' WHERE id = ? AND status IN ('active','proposed')").run(id).changes === 1;
}

// Everything the fund's agents and members know about one symbol, grouped by kind.
function dossier(symbol) {
  const rows = recall({ symbol, limit: 200 }).filter((r) => r.scope === "symbol");
  const pick = (k) => rows.filter((r) => r.kind === k);
  return {
    symbol: String(symbol).toUpperCase(),
    facts: pick("fact"), observations: pick("observation"), decisions: pick("decision"),
    openQuestions: pick("open_question"), predictions: pick("prediction"),
    lastUpdated: rows.length ? rows.map((r) => r.createdAt).sort().pop() : null,
  };
}

module.exports = { remember, recall, supersede, retract, dossier, SCOPES, KINDS };
