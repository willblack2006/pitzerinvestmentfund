// Who is looking at what (WS7): "Ana and Ben are viewing" on an agent profile or a feed thread.
// In memory only (Render runs one instance); a page sends a heartbeat every 30s while open and
// an entry drops after 70s without one. Changes go out live as feed.presence.
const events = require("../events");

const TTL_MS = 70e3;
const TARGET = /^(agent|item|feed):[\w.-]{1,64}$/;
const viewers = new Map(); // target -> Map(memberId -> { name, at })

const valid = (t) => TARGET.test(String(t || ""));

function list(target, now = Date.now()) {
  const m = viewers.get(target);
  if (!m) return [];
  for (const [id, v] of m) if (now - v.at > TTL_MS) m.delete(id);
  if (!m.size) viewers.delete(target);
  return [...(viewers.get(target)?.entries() || [])].map(([id, v]) => ({ id, name: v.name }));
}

function announce(target) {
  events.publish("feed.presence", { target, viewers: list(target) }, { membersOnly: true });
}

// Heartbeat (leave = false) or leaving (leave = true). Returns the current viewers.
function beat(member, target, { leave = false, now = Date.now() } = {}) {
  if (!valid(target)) return [];
  const before = list(target, now).map((v) => v.id).sort().join(",");
  if (leave) viewers.get(target)?.delete(member.id);
  else {
    if (!viewers.has(target)) viewers.set(target, new Map());
    viewers.get(target).set(member.id, { name: member.name, at: now });
  }
  const after = list(target, now);
  if (after.map((v) => v.id).sort().join(",") !== before) announce(target);
  return after;
}

// Drops expired entries everywhere and announces the targets that changed (called every 30s).
function sweep(now = Date.now()) {
  for (const target of [...viewers.keys()]) {
    const n = viewers.get(target).size;
    if (list(target, now).length !== n) announce(target);
  }
}
const timer = setInterval(sweep, 30e3);
timer.unref?.();

module.exports = { beat, list, sweep, valid, TTL_MS, _viewers: viewers };
