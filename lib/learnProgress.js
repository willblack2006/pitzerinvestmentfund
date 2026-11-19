// What a member has actually done in the app, for the "Start here" learning path. Nothing is
// self-reported: each milestone is read from the member's own rows, so the checklist can't
// drift from what they did. Read-only; no notifications.
const db = require("../db");

const has = (sql, ...args) => !!db.prepare(sql).get(...args);

function learnProgress(memberId) {
  return {
    watchlist: has("SELECT 1 FROM watchlist_items WHERE addedBy = ? LIMIT 1", memberId)
      || has("SELECT 1 FROM member_prefs WHERE memberId = ? AND key = 'myTickers' AND value NOT IN ('[]','') LIMIT 1", memberId)
      || has("SELECT 1 FROM watchlists w JOIN watchlist_items i ON i.listId = w.id WHERE w.ownerId = ? LIMIT 1", memberId),
    note: has("SELECT 1 FROM notes WHERE memberId = ? AND length(trim(body)) > 0 LIMIT 1", memberId),
    paperTrade: has("SELECT 1 FROM paper_trades WHERE memberId = ? AND status IN ('filled','pending') LIMIT 1", memberId),
    // A buy with a reason and at least a target or a stop: a call that can be proven wrong.
    paperThesis: has(`SELECT 1 FROM paper_trades WHERE memberId = ? AND type = 'buy' AND status IN ('filled','pending')
      AND length(trim(reason)) >= 20 AND (targetPrice IS NOT NULL OR stopPrice IS NOT NULL) LIMIT 1`, memberId),
    pitch: has("SELECT 1 FROM pitches WHERE authorId = ? LIMIT 1", memberId),
    vote: has("SELECT 1 FROM votes WHERE memberId = ? LIMIT 1", memberId),
  };
}

module.exports = { learnProgress };
