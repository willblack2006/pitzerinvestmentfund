const express = require("express");
const db = require("../db");
const { requireMember, memberFromRequest, safeEqual, EDIT_PASSWORD } = require("../middleware/auth");
const { getSettings } = require("../lib/settings");
const { latestPrices } = require("../lib/prices");

const router = express.Router();

// Writing a pitch needs an identity: a signed-in member (preferred), or the shared editor
// password with an explicit author name.
function requireAuthor(req, res, next) {
  req.member = memberFromRequest(req);
  if (req.member) { req.authorName = req.member.name; return next(); }
  if (safeEqual(req.get("x-edit-password") || "", EDIT_PASSWORD)) {
    req.authorName = String(req.body?.author || "").trim() || "Fund editor";
    return next();
  }
  res.status(401).json({ error: "Sign in as a member (or unlock editing) to write pitches.", code: "member_required" });
}

const FIELDS = ["symbol", "direction", "title", "thesis", "catalysts", "risks", "valuation", "bullCase", "baseCase", "bearCase", "bullPrice", "basePrice", "bearPrice", "sizePct", "confidencePct", "horizonMonths", "preMortem", "bearChecklist"];
const NUM = new Set(["bullPrice", "basePrice", "bearPrice", "sizePct", "confidencePct", "horizonMonths"]);

function clean(body) {
  const out = {};
  for (const f of FIELDS) {
    if (body[f] === undefined) continue;
    if (NUM.has(f)) {
      const v = body[f] === "" || body[f] === null ? null : Number(body[f]);
      if (v !== null && (!Number.isFinite(v) || v < 0)) throw Object.assign(new Error(`${f} must be a positive number.`), { status: 400 });
      if (f === "confidencePct" && v !== null && v > 100) throw Object.assign(new Error("Confidence must be 0-100."), { status: 400 });
      out[f] = v;
    } else out[f] = String(body[f]);
  }
  if (out.symbol !== undefined) {
    out.symbol = out.symbol.toUpperCase().trim();
    if (!/^[A-Z0-9.\-]{1,10}$/.test(out.symbol)) throw Object.assign(new Error("Enter a valid ticker."), { status: 400 });
  }
  if (out.direction !== undefined && !["buy", "add", "trim", "sell"].includes(out.direction)) {
    throw Object.assign(new Error("Direction must be buy, add, trim or sell."), { status: 400 });
  }
  return out;
}

function tally(pitchId) {
  const votes = db.prepare(`
    SELECT v.vote, v.comment, v.createdAt, m.name, m.id AS memberId FROM votes v JOIN members m ON m.id = v.memberId
    WHERE v.pitchId = ? ORDER BY v.createdAt
  `).all(pitchId);
  const t = { yes: 0, no: 0, abstain: 0 };
  votes.forEach((v) => t[v.vote]++);
  const s = getSettings();
  const decisive = t.yes + t.no;
  const yesPct = decisive ? (t.yes / decisive) * 100 : 0;
  const quorumMet = votes.length >= s.voteQuorum;
  return {
    votes,
    counts: t,
    total: votes.length,
    yesPct,
    quorum: s.voteQuorum,
    thresholdPct: s.voteThresholdPct,
    quorumMet,
    // Passing requires quorum AND strictly more than the threshold share of yes/no votes.
    passing: quorumMet && yesPct > s.voteThresholdPct,
  };
}

router.get("/pitches", (req, res) => {
  const rows = db.prepare("SELECT * FROM pitches ORDER BY CASE status WHEN 'voting' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, updatedAt DESC").all();
  res.json(rows.map((p) => {
    const t = tally(p.id);
    return { ...p, voteCounts: t.counts, voteTotal: t.total, passing: t.passing };
  }));
});

router.get("/pitches/:id", async (req, res) => {
  const p = db.prepare("SELECT * FROM pitches WHERE id = ?").get(req.params.id);
  if (!p) return res.status(404).json({ error: "Pitch not found." });
  const prices = await latestPrices([p.symbol]);
  res.json({ ...p, tally: tally(p.id), currentPrice: prices[p.symbol]?.price ?? null });
});

router.post("/pitches", requireAuthor, async (req, res) => {
  let data;
  try { data = clean(req.body || {}); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  if (!data.symbol) return res.status(400).json({ error: "A ticker is required." });
  const prices = await latestPrices([data.symbol]);
  const row = { direction: "buy", title: "", thesis: "", catalysts: "", risks: "", valuation: "", bullCase: "", baseCase: "", bearCase: "", bullPrice: null, basePrice: null, bearPrice: null, sizePct: null, confidencePct: null, horizonMonths: null, preMortem: "", bearChecklist: "[]", ...data };
  const info = db.prepare(`
    INSERT INTO pitches (symbol, direction, title, author, thesis, catalysts, risks, valuation, bullCase, baseCase, bearCase, bullPrice, basePrice, bearPrice, sizePct, confidencePct, horizonMonths, preMortem, bearChecklist, priceAtPitch)
    VALUES (@symbol, @direction, @title, @author, @thesis, @catalysts, @risks, @valuation, @bullCase, @baseCase, @bearCase, @bullPrice, @basePrice, @bearPrice, @sizePct, @confidencePct, @horizonMonths, @preMortem, @bearChecklist, @priceAtPitch)
  `).run({ ...row, author: req.authorName, priceAtPitch: prices[data.symbol]?.price ?? null });
  res.status(201).json(db.prepare("SELECT * FROM pitches WHERE id = ?").get(info.lastInsertRowid));
});

router.put("/pitches/:id", requireAuthor, (req, res) => {
  const p = db.prepare("SELECT * FROM pitches WHERE id = ?").get(req.params.id);
  if (!p) return res.status(404).json({ error: "Pitch not found." });
  if (!["draft", "voting"].includes(p.status)) return res.status(409).json({ error: "Decided pitches can't be edited." });
  let data;
  try { data = clean(req.body || {}); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  const merged = { ...p, ...data };
  db.prepare(`
    UPDATE pitches SET symbol=@symbol, direction=@direction, title=@title, thesis=@thesis, catalysts=@catalysts, risks=@risks,
      valuation=@valuation, bullCase=@bullCase, baseCase=@baseCase, bearCase=@bearCase, bullPrice=@bullPrice, basePrice=@basePrice,
      bearPrice=@bearPrice, sizePct=@sizePct, confidencePct=@confidencePct, horizonMonths=@horizonMonths, preMortem=@preMortem,
      bearChecklist=@bearChecklist, updatedAt=datetime('now') WHERE id=@id
  `).run(merged);
  res.json(db.prepare("SELECT * FROM pitches WHERE id = ?").get(p.id));
});

// Lifecycle: draft -> voting -> (approved | rejected) -> executed; draft/voting -> withdrawn.
router.post("/pitches/:id/status", requireAuthor, (req, res) => {
  const p = db.prepare("SELECT * FROM pitches WHERE id = ?").get(req.params.id);
  if (!p) return res.status(404).json({ error: "Pitch not found." });
  const action = req.body?.action;
  let status;
  if (action === "open" && p.status === "draft") {
    if (!p.thesis.trim() || p.basePrice === null) return res.status(400).json({ error: "Add a thesis and a base-case price target before opening the vote." });
    if (!p.preMortem?.trim()) return res.status(400).json({ error: "Add a pre-mortem (\"it's a year later and this lost 40% — why?\") before opening the vote." });
    status = "voting";
    db.prepare("UPDATE pitches SET status='voting', votingOpenedAt=datetime('now'), updatedAt=datetime('now') WHERE id=?").run(p.id);
  } else if (action === "close" && p.status === "voting") {
    const t = tally(p.id);
    if (!t.quorumMet) return res.status(400).json({ error: `Quorum not met: ${t.total} of ${t.quorum} required votes cast.` });
    status = t.passing ? "approved" : "rejected";
    db.prepare("UPDATE pitches SET status=?, decidedAt=datetime('now'), updatedAt=datetime('now') WHERE id=?").run(status, p.id);
  } else if (action === "executed" && p.status === "approved") {
    status = "executed";
    db.prepare("UPDATE pitches SET status='executed', updatedAt=datetime('now') WHERE id=?").run(p.id);
  } else if (action === "withdraw" && ["draft", "voting"].includes(p.status)) {
    status = "withdrawn";
    db.prepare("UPDATE pitches SET status='withdrawn', decidedAt=datetime('now'), updatedAt=datetime('now') WHERE id=?").run(p.id);
  } else if (action === "reopen" && ["voting", "withdrawn"].includes(p.status)) {
    status = "draft";
    db.prepare("UPDATE pitches SET status='draft', decidedAt=NULL, updatedAt=datetime('now') WHERE id=?").run(p.id);
  } else {
    return res.status(409).json({ error: `Can't ${action} a pitch that is ${p.status}.` });
  }
  res.json({ ...db.prepare("SELECT * FROM pitches WHERE id = ?").get(p.id), tally: tally(p.id) });
});

router.post("/pitches/:id/vote", requireMember, (req, res) => {
  const p = db.prepare("SELECT * FROM pitches WHERE id = ?").get(req.params.id);
  if (!p) return res.status(404).json({ error: "Pitch not found." });
  if (p.status !== "voting") return res.status(409).json({ error: "Voting isn't open on this pitch." });
  const { vote, comment = "" } = req.body || {};
  if (!["yes", "no", "abstain"].includes(vote)) return res.status(400).json({ error: "Vote must be yes, no or abstain." });
  db.prepare(`
    INSERT INTO votes (pitchId, memberId, vote, comment) VALUES (?, ?, ?, ?)
    ON CONFLICT(pitchId, memberId) DO UPDATE SET vote = excluded.vote, comment = excluded.comment, createdAt = datetime('now')
  `).run(p.id, req.member.id, vote, String(comment).slice(0, 1000));
  res.json(tally(p.id));
});

router.delete("/pitches/:id", requireAuthor, (req, res) => {
  const p = db.prepare("SELECT * FROM pitches WHERE id = ?").get(req.params.id);
  if (!p) return res.status(404).json({ error: "Pitch not found." });
  if (p.status !== "draft") return res.status(409).json({ error: "Only drafts can be deleted; withdraw it instead." });
  db.prepare("DELETE FROM pitches WHERE id = ?").run(p.id);
  res.status(204).end();
});

module.exports = router;
