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
  thirteenF: "New 13F filings from managers the fund follows",
  memberJoined: "Someone joins with the sign-up link (admins)",
  tripwire: "An exit tripwire on a holding trips",
  agentBrief: "Important research agent alerts: big filings, earnings on big holdings, thesis warnings (members with AI access)",
  agentDigest: "Daily research digest: everything else the agents wrote that day (members with AI access)",
  agentHealth: "An agent you own keeps failing, runs out of budget or stops firing; the fund nears its AI cap (owners and admins)",
};
const KEEP = 200; // newest notifications kept per member

const cleanLink = (l) => (/^#\/[\w\-./%=&?]*$/.test(l || "") ? l.slice(0, 300) : "");

function mutedBy(memberIds, type) {
  if (!memberIds.length) return new Set();
  const rows = db.prepare(`SELECT memberId, value FROM member_prefs WHERE key = 'notifyOff' AND memberId IN (${memberIds.map(() => "?").join(",")})`).all(...memberIds);
  return new Set(rows.filter((r) => { try { return JSON.parse(r.value).includes(type); } catch { return false; } }).map((r) => r.memberId));
}

// memberIds: array of ids, or "all" for every active member. `except` skips one id (the actor).
// `replaceToday: true` folds a burst into one notification: the member's unread notification of
// the same type from today (UTC) is replaced, so the caller sends the running summary each time
// (used for 13F filings, which arrive in bunches during filing season).
function notify(memberIds, { type, title, body = "", link = "" }, { except = null, replaceToday = false } = {}) {
  if (!TYPES[type]) throw new Error(`Unknown notification type ${type}`);
  let ids = memberIds === "all" ? db.prepare("SELECT id FROM members WHERE active = 1 AND passwordHash IS NOT NULL").all().map((r) => r.id) : [...new Set(memberIds)];
  ids = ids.filter((id) => id !== except);
  const muted = mutedBy(ids, type);
  const insert = db.prepare("INSERT INTO notifications (memberId, type, title, body, link) VALUES (?, ?, ?, ?, ?)");
  const trim = db.prepare("DELETE FROM notifications WHERE memberId = ? AND id NOT IN (SELECT id FROM notifications WHERE memberId = ? ORDER BY id DESC LIMIT ?)");
  const sent = [];
  for (const id of ids) {
    if (muted.has(id)) continue;
    let replaces = [];
    if (replaceToday) {
      replaces = db.prepare("SELECT id FROM notifications WHERE memberId = ? AND type = ? AND readAt IS NULL AND createdAt >= date('now')").all(id, type).map((r) => r.id);
      for (const r of replaces) db.prepare("DELETE FROM notifications WHERE id = ?").run(r);
    }
    const info = insert.run(id, type, String(title).slice(0, 200), String(body).slice(0, 500), cleanLink(link));
    trim.run(id, id, KEEP);
    const row = db.prepare("SELECT * FROM notifications WHERE id = ?").get(info.lastInsertRowid);
    events.publish("notify", replaces.length ? { ...row, replaces } : row, { membersOnly: true, to: [id] });
    sent.push(id);
  }
  return sent;
}

module.exports = { notify, TYPES };
