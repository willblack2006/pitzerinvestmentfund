// Human activity on the team feed (WS7): one-line hooks in the modules where things happen
// (pitches, trades, tripwires, shared notes, agents created/edited). Every hook is
// fire-and-forget: a feed problem never breaks the action that triggered it.
const { db, platform } = require("./store");

// feed.post from WS1 (lib/platform/feed.js). Returns the new item id, or null.
function post(fields) {
  try {
    const feed = platform("feed");
    if (!feed || typeof feed.post !== "function") return null;
    return feed.post({ importance: "normal", ...fields });
  } catch (err) {
    console.error(`[feed] post ${fields.kind} failed:`, err.message);
    return null;
  }
}

const safe = (fn) => (...args) => { try { return fn(...args); } catch (err) { console.error("[feed] activity hook failed:", err.message); return null; } };
const pitchLabel = (p) => `${String(p.direction || "buy").replace(/^./, (c) => c.toUpperCase())} ${p.symbol}${p.title ? `: ${p.title}` : ""}`;
const clip = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

const pitchOpened = safe((p, member) => post({
  kind: "pitch_opened", actorType: "member", actorId: member?.id ?? null, symbol: p.symbol, pitchId: p.id,
  title: `${pitchLabel(p)} is open for a vote`,
  body: { summary: clip(p.thesis || p.summary, 400), direction: p.direction, basePrice: p.basePrice ?? null, link: `#/pitches/${p.id}` },
}));

// status: approved | rejected | executed | withdrawn
const pitchDecided = safe((p, status, member, counts = null) => post({
  kind: "vote_closed", actorType: "member", actorId: member?.id ?? null, symbol: p.symbol, pitchId: p.id,
  importance: status === "approved" || status === "executed" ? "high" : "normal",
  title: status === "executed" ? `${pitchLabel(p)} was carried out in the real fund` : `${pitchLabel(p)} was ${status}`,
  body: { status, counts, summary: clip(p.decisionNote, 300) || undefined, link: `#/pitches/${p.id}` },
}));

// From lib/events.js fundChanged on transaction.buy / transaction.sell.
const tradeExecuted = safe((action, detail, member) => {
  const side = action === "transaction.buy" ? "bought" : "sold";
  const n = Number(detail.shares).toLocaleString("en-US", { maximumFractionDigits: 4 });
  const price = Number.isFinite(detail.price) ? ` at $${Number(detail.price).toFixed(2)}` : "";
  return post({
    kind: "trade_executed", actorType: "member", actorId: member?.id ?? null, symbol: detail.symbol, importance: "high",
    title: `The fund ${side} ${n} ${detail.symbol}${price}`,
    body: { side, shares: detail.shares, price: detail.price ?? null, link: `#/research/${encodeURIComponent(detail.symbol)}` },
  });
});

const tripwireTripped = safe((t, detail, describe) => post({
  kind: "tripwire_tripped", actorType: "system", actorId: null, symbol: t.symbol, pitchId: t.pitchId ?? null, importance: "high",
  title: `${t.symbol} tripwire: ${describe}`,
  body: { summary: clip(`${detail}${t.note ? ` Why we set it: ${t.note}` : ""}`, 500), link: `#/research/${encodeURIComponent(t.symbol)}/thesis` },
}));

// A note shared with the club (on create, or when it is switched from private to club).
const noteShared = safe((note, member) => post({
  kind: "note_shared", actorType: "member", actorId: member?.id ?? note.memberId, symbol: note.symbol || null,
  title: `${member?.name || "A member"} shared a note${note.symbol ? ` on ${note.symbol}` : ""}`,
  body: { text: clip(note.body, 600), quote: clip(note.quote, 300) || undefined, pageTitle: note.pageTitle || undefined, link: note.pageRef || "#/notes" },
}));

// For WS2/WS3 (agent CRUD): call after an agent is created or its spec changes.
const agentCreated = safe((agent, member) => post({
  kind: "agent_created", actorType: "member", actorId: member?.id ?? agent.ownerId ?? null, agentId: agent.id,
  title: `${member?.name || "A member"} created the agent ${agent.name}`,
  body: { summary: clip(agent.description, 300), slug: agent.slug, link: `#/agents/a/${encodeURIComponent(agent.slug)}` },
}));
const agentEdited = safe((agent, member, note = "") => post({
  kind: "agent_edited", actorType: "member", actorId: member?.id ?? null, agentId: agent.id, importance: "low",
  title: `${member?.name || "A member"} updated ${agent.name} (v${agent.version || 1})`,
  body: { summary: clip(note, 300) || undefined, slug: agent.slug, link: `#/agents/a/${encodeURIComponent(agent.slug)}` },
}));

module.exports = { post, pitchOpened, pitchDecided, tradeExecuted, tripwireTripped, noteShared, agentCreated, agentEdited, db };
