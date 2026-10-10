// Watchlists: the fund's holdings (automatic), the fund's watchlist (the "watchlist" table),
// your Following list (the myTickers preference), and lists members make: private to them, or
// shared with the club. Any member can add to or remove from a shared list; only its creator or
// an admin can rename it, change who sees it, or delete it.
const express = require("express");
const db = require("../db");
const { requireSignedIn, optionalMember } = require("../middleware/auth");
const { getPrefs, setPrefs } = require("../lib/prefs");

const router = express.Router();
const TICKER = /^[A-Z0-9.\-^=]{1,12}$/;
const MAX_LISTS = 50, MAX_ITEMS = 200;
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const cleanSymbol = (s) => String(s || "").toUpperCase().replace(/^\$/, "").trim();
const nameOf = (id) => (id ? db.prepare("SELECT name FROM members WHERE id = ?").get(id)?.name || null : null);

// What the viewer may do with a custom list.
function rights(list, me) {
  if (!me) return { view: false, edit: false, manage: false };
  const owner = list.ownerId === me.id;
  const view = owner || list.visibility === "club";
  return { view, edit: view, manage: owner || (!!me.isAdmin && list.visibility === "club") };
}

function customList(id) { return db.prepare("SELECT * FROM watchlists WHERE id = ?").get(id); }

function summary(list, me, symbol = null) {
  const r = rights(list, me);
  return {
    key: String(list.id), kind: "custom", id: list.id, name: list.name, description: list.description, visibility: list.visibility,
    owner: nameOf(list.ownerId), mine: list.ownerId === me?.id,
    count: db.prepare("SELECT COUNT(*) AS c FROM watchlist_items WHERE listId = ?").get(list.id).c,
    canEdit: r.edit, canManage: r.manage,
    has: symbol ? !!db.prepare("SELECT 1 FROM watchlist_items WHERE listId = ? AND symbol = ?").get(list.id, symbol) : undefined,
    updatedAt: list.updatedAt,
  };
}

// All lists the viewer can see. ?symbol=X adds `has` to each (for "Add to list" menus).
router.get("/watchlists", optionalMember, (req, res) => {
  const me = req.member;
  const symbol = req.query.symbol ? cleanSymbol(req.query.symbol) : null;
  const holdings = db.prepare("SELECT symbol FROM positions").all().map((r) => r.symbol);
  const fund = db.prepare("SELECT symbol FROM watchlist").all().map((r) => r.symbol);
  const out = [
    { key: "holdings", kind: "holdings", name: "Fund holdings", description: "What the fund owns now. Updates itself.", visibility: "club", count: holdings.length, canEdit: false, canManage: false, has: symbol ? holdings.includes(symbol) : undefined },
    { key: "fund", kind: "fund", name: "Fund watchlist", description: "Companies the fund is tracking but doesn't own. The analysis pages use this list.", visibility: "club", count: fund.length, canEdit: !!me, canManage: false, has: symbol ? fund.includes(symbol) : undefined },
  ];
  if (me) {
    const following = getPrefs(me.id).myTickers || [];
    out.push({ key: "following", kind: "following", name: "Following", description: "Tickers you follow. They show up in For you on Today.", visibility: "private", mine: true, count: following.length, canEdit: true, canManage: false, has: symbol ? following.includes(symbol) : undefined });
    const lists = db.prepare("SELECT * FROM watchlists WHERE ownerId = ? OR visibility = 'club' ORDER BY (ownerId = ?) DESC, lower(name)").all(me.id, me.id);
    out.push(...lists.map((l) => summary(l, me, symbol)));
  }
  res.json(out);
});

// One list's tickers.
router.get("/watchlists/:key", optionalMember, (req, res) => {
  const me = req.member;
  const key = req.params.key;
  if (key === "holdings") {
    const items = db.prepare("SELECT symbol, shares FROM positions ORDER BY symbol").all().map((p) => ({ symbol: p.symbol, note: `${+Number(p.shares).toFixed(4)} shares`, addedBy: null, addedAt: null }));
    return res.json({ list: { key, kind: "holdings", name: "Fund holdings", canEdit: false, canManage: false }, items });
  }
  if (key === "fund") {
    const items = db.prepare("SELECT * FROM watchlist ORDER BY addedAt DESC").all().map((w) => ({ id: w.id, symbol: w.symbol, note: w.note || w.sourcedFrom || "", addedBy: null, addedAt: w.addedAt }));
    return res.json({ list: { key, kind: "fund", name: "Fund watchlist", canEdit: !!me, canManage: false }, items });
  }
  if (!me) return res.status(401).json({ error: "Sign in to see members' lists.", code: "signin_required" });
  if (key === "following") {
    const items = (getPrefs(me.id).myTickers || []).map((s) => ({ symbol: s, note: "", addedBy: null, addedAt: null }));
    return res.json({ list: { key, kind: "following", name: "Following", visibility: "private", mine: true, canEdit: true, canManage: false }, items });
  }
  const list = customList(key);
  if (!list || !rights(list, me).view) return bad(res, "List not found.", 404);
  const items = db.prepare("SELECT * FROM watchlist_items WHERE listId = ? ORDER BY addedAt DESC, id DESC").all(list.id)
    .map((i) => ({ symbol: i.symbol, note: i.note, addedBy: nameOf(i.addedBy), addedAt: i.addedAt }));
  res.json({ list: summary(list, me), items });
});

function cleanMeta(body, partial) {
  const out = {};
  if (!partial || body.name !== undefined) {
    out.name = String(body.name || "").trim().slice(0, 60);
    if (!out.name) throw new Error("Give the list a name.");
  }
  if (body.description !== undefined) out.description = String(body.description).trim().slice(0, 300);
  if (!partial || body.visibility !== undefined) {
    out.visibility = body.visibility === "club" ? "club" : body.visibility === undefined || body.visibility === "private" ? "private" : null;
    if (!out.visibility) throw new Error("A list is private or shared with the club.");
  }
  return out;
}

router.post("/watchlists", requireSignedIn, (req, res) => {
  let m;
  try { m = cleanMeta(req.body || {}, false); } catch (e) { return bad(res, e.message); }
  if (db.prepare("SELECT COUNT(*) AS c FROM watchlists WHERE ownerId = ?").get(req.member.id).c >= MAX_LISTS) return bad(res, `You can have up to ${MAX_LISTS} lists.`);
  const info = db.prepare("INSERT INTO watchlists (ownerId, name, description, visibility) VALUES (?, ?, ?, ?)").run(req.member.id, m.name, m.description || "", m.visibility);
  res.status(201).json(summary(customList(info.lastInsertRowid), req.member));
});

router.put("/watchlists/:id", requireSignedIn, (req, res) => {
  const list = customList(req.params.id);
  if (!list || !rights(list, req.member).view) return bad(res, "List not found.", 404);
  if (!rights(list, req.member).manage) return bad(res, "Only the list's creator (or an admin) can change it.", 403);
  let m;
  try { m = cleanMeta(req.body || {}, true); } catch (e) { return bad(res, e.message); }
  // Admins can moderate a shared list but can't make someone else's list private to its owner.
  if (m.visibility && list.ownerId !== req.member.id && m.visibility !== list.visibility) return bad(res, "Only the list's creator can change who sees it.", 403);
  const next = { ...list, ...m };
  db.prepare("UPDATE watchlists SET name = ?, description = ?, visibility = ?, updatedAt = datetime('now') WHERE id = ?").run(next.name, next.description, next.visibility, list.id);
  res.json(summary(customList(list.id), req.member));
});

router.delete("/watchlists/:id", requireSignedIn, (req, res) => {
  const list = customList(req.params.id);
  if (!list || !rights(list, req.member).view) return bad(res, "List not found.", 404);
  if (!rights(list, req.member).manage) return bad(res, "Only the list's creator (or an admin) can delete it.", 403);
  db.prepare("DELETE FROM watchlists WHERE id = ?").run(list.id);
  res.status(204).end();
});

// Add a ticker. Works for "following", "fund" and custom lists you can edit.
router.post("/watchlists/:key/items", requireSignedIn, (req, res) => {
  const symbol = cleanSymbol(req.body?.symbol);
  if (!TICKER.test(symbol)) return bad(res, "Enter a ticker like AAPL or BRK-B.");
  const note = String(req.body?.note || "").trim().slice(0, 200);
  const key = req.params.key;
  if (key === "holdings") return bad(res, "Fund holdings update themselves when the fund buys or sells.", 403);
  if (key === "following") {
    const cur = getPrefs(req.member.id).myTickers || [];
    if (cur.includes(symbol)) return bad(res, `You already follow ${symbol}.`, 409);
    try { setPrefs(req.member.id, { myTickers: [...cur, symbol] }); } catch (e) { return bad(res, e.message); }
    return res.status(201).json({ symbol });
  }
  if (key === "fund") {
    try {
      db.prepare("INSERT INTO watchlist (symbol, note, sourcedFrom, addedAt) VALUES (?, ?, ?, datetime('now'))").run(symbol, note, String(req.body?.sourcedFrom || "").slice(0, 100));
    } catch (e) {
      if (String(e).includes("UNIQUE")) return bad(res, `${symbol} is already on the fund watchlist.`, 409);
      throw e;
    }
    return res.status(201).json({ symbol });
  }
  const list = customList(key);
  if (!list || !rights(list, req.member).view) return bad(res, "List not found.", 404);
  if (db.prepare("SELECT COUNT(*) AS c FROM watchlist_items WHERE listId = ?").get(list.id).c >= MAX_ITEMS) return bad(res, `A list holds up to ${MAX_ITEMS} tickers.`);
  try {
    db.prepare("INSERT INTO watchlist_items (listId, symbol, note, addedBy) VALUES (?, ?, ?, ?)").run(list.id, symbol, note, req.member.id);
  } catch (e) {
    if (String(e).includes("UNIQUE")) return bad(res, `${symbol} is already on ${list.name}.`, 409);
    throw e;
  }
  db.prepare("UPDATE watchlists SET updatedAt = datetime('now') WHERE id = ?").run(list.id);
  res.status(201).json({ symbol });
});

router.delete("/watchlists/:key/items/:symbol", requireSignedIn, (req, res) => {
  const symbol = cleanSymbol(req.params.symbol);
  const key = req.params.key;
  if (key === "holdings") return bad(res, "Fund holdings update themselves when the fund buys or sells.", 403);
  if (key === "following") {
    const cur = getPrefs(req.member.id).myTickers || [];
    if (!cur.includes(symbol)) return bad(res, "Not on the list.", 404);
    setPrefs(req.member.id, { myTickers: cur.filter((s) => s !== symbol) });
    return res.status(204).end();
  }
  if (key === "fund") {
    const info = db.prepare("DELETE FROM watchlist WHERE symbol = ?").run(symbol);
    return info.changes ? res.status(204).end() : bad(res, "Not on the list.", 404);
  }
  const list = customList(key);
  if (!list || !rights(list, req.member).view) return bad(res, "List not found.", 404);
  const info = db.prepare("DELETE FROM watchlist_items WHERE listId = ? AND symbol = ?").run(list.id, symbol);
  if (!info.changes) return bad(res, "Not on the list.", 404);
  db.prepare("UPDATE watchlists SET updatedAt = datetime('now') WHERE id = ?").run(list.id);
  res.status(204).end();
});

module.exports = router;
