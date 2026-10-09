// Personal notifications (the inbox). Each one goes to specific members, is stored so it's
// there next time they sign in, and is pushed live to any tab they have open. Members can turn
// off whole types in Account & preferences (pref "notifyOff").
const db = require("../db");
const events = require("./events");

const TYPES = {
  mention: "Mentions in the club chat",
  pitchVoting: "A pitch opens for voting",
  pitchResult: "Results of pitches you wrote or voted on",
  fundTrade: "Trades in the real fund",
  priceAlert: "Your price alerts",
  paperOrder: "Your paper orders filling or being cancelled",
};
const KEEP = 200; // newest notifications kept per member

const cleanLink = (l) => (/^#\/[\w\-./%=&?]*$/.test(l || "") ? l.slice(0, 300) : "");

function mutedBy(memberIds, type) {
  if (!memberIds.length) return new Set();
  const rows = db.prepare(`SELECT memberId, value FROM member_prefs WHERE key = 'notifyOff' AND memberId IN (${memberIds.map(() => "?").join(",")})`).all(...memberIds);
  return new Set(rows.filter((r) => { try { return JSON.parse(r.value).includes(type); } catch { return false; } }).map((r) => r.memberId));
}

// memberIds: array of ids, or "all" for every active member. `except` skips one id (the actor).
function notify(memberIds, { type, title, body = "", link = "" }, { except = null } = {}) {
  if (!TYPES[type]) throw new Error(`Unknown notification type ${type}`);
  let ids = memberIds === "all" ? db.prepare("SELECT id FROM members WHERE active = 1 AND passwordHash IS NOT NULL").all().map((r) => r.id) : [...new Set(memberIds)];
  ids = ids.filter((id) => id !== except);
  const muted = mutedBy(ids, type);
  const insert = db.prepare("INSERT INTO notifications (memberId, type, title, body, link) VALUES (?, ?, ?, ?, ?)");
  const trim = db.prepare("DELETE FROM notifications WHERE memberId = ? AND id NOT IN (SELECT id FROM notifications WHERE memberId = ? ORDER BY id DESC LIMIT ?)");
  const sent = [];
  for (const id of ids) {
    if (muted.has(id)) continue;
    const info = insert.run(id, type, String(title).slice(0, 200), String(body).slice(0, 500), cleanLink(link));
    trim.run(id, id, KEEP);
    const row = db.prepare("SELECT * FROM notifications WHERE id = ?").get(info.lastInsertRowid);
    events.publish("notify", row, { membersOnly: true, to: [id] });
    sent.push(id);
  }
  return sent;
}

module.exports = { notify, TYPES };
