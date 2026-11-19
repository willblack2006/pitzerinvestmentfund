// Agent output goes only to members with AI access (admins always have it).
const db = require("../../db");
const { notify } = require("../notify");

function aiMemberIds() {
  return db.prepare("SELECT id FROM members WHERE active = 1 AND passwordHash IS NOT NULL AND (canUseAi = 1 OR isAdmin = 1)").all().map((r) => r.id);
}

function notifyAiMembers(n, opts) {
  const ids = aiMemberIds();
  return ids.length ? notify(ids, n, opts) : [];
}

module.exports = { aiMemberIds, notifyAiMembers };
