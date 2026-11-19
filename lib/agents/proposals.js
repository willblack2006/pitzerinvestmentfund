// Approval queue (research report 8.2: "route every write to an approval queue"). Agents never
// change the app directly: they file a proposal, and a member approves or rejects it. Each kind
// registers the function that applies it on approval.
const db = require("../../db");

const handlers = {}; // kind -> { label, apply(payload, member), canDecide?(member, proposal) }
function registerKind(kind, handler) { handlers[kind] = handler; }

function propose({ runId = null, kind, symbol = null, title, payload = {} }) {
  if (!handlers[kind]) throw new Error(`Unknown proposal kind ${kind}`);
  const info = db.prepare("INSERT INTO agent_proposals (runId, kind, symbol, title, payload) VALUES (?, ?, ?, ?, ?)").run(runId, kind, symbol, String(title).slice(0, 300), JSON.stringify(payload));
  return Number(info.lastInsertRowid);
}

const view = (p) => ({ ...p, payload: JSON.parse(p.payload || "{}"), kindLabel: handlers[p.kind]?.label || p.kind });

function list({ status = "pending", limit = 100 } = {}) {
  return db.prepare("SELECT * FROM agent_proposals WHERE status = ? ORDER BY id DESC LIMIT ?").all(status, limit).map(view);
}

async function decide(id, member, approve) {
  const p = db.prepare("SELECT * FROM agent_proposals WHERE id = ?").get(id);
  if (!p) throw Object.assign(new Error("No such proposal."), { status: 404, expose: true });
  if (p.status !== "pending") throw Object.assign(new Error("This proposal was already decided."), { status: 409, expose: true });
  const h = handlers[p.kind];
  const proposal = view(p);
  if (h?.canDecide && !h.canDecide(member, proposal)) throw Object.assign(new Error(h.denyMessage || "You can't decide this proposal."), { status: 403, expose: true });
  if (approve && h) await h.apply(proposal.payload, member, proposal);
  db.prepare("UPDATE agent_proposals SET status = ?, decidedBy = ?, decidedAt = datetime('now') WHERE id = ?").run(approve ? "approved" : "rejected", member.id, id);
  return view(db.prepare("SELECT * FROM agent_proposals WHERE id = ?").get(id));
}

module.exports = { registerKind, propose, list, decide, handlers };
