const express = require("express");
const db = require("../db");
const { requireSignedIn, optionalMember } = require("../middleware/auth");
const { getSettings } = require("../lib/settings");
const { latestPrices } = require("../lib/prices");
const { notify } = require("../lib/notify");
const { fitCheck } = require("../lib/pitchFit");
const portfolio = require("../lib/portfolio");
const yahoo = require("../lib/sources/yahoo");
const { readiness } = require("../lib/pitchReadiness");

const router = express.Router();

// Writing a pitch needs an identity: a signed-in member (preferred), or the shared editor
// password with an explicit author name.
// Pitch rights: any signed-in member can write one; its author (or an admin) edits, opens,
// withdraws or deletes it; a portfolio manager or admin closes the vote; only a portfolio
// manager marks it executed (that's a real trade).
const isAuthor = (req, p) => (p.authorId != null ? p.authorId === req.member.id : p.author === req.member.name);
const isAuthorOrAdmin = (req, p) => req.member.isAdmin || isAuthor(req, p);
// The author's member id (older pitches only stored a name).
const authorIdOf = (p) => p.authorId ?? db.prepare("SELECT id FROM members WHERE name = ?").get(p.author)?.id ?? null;
const pitchLabel = (p) => `${p.direction[0].toUpperCase()}${p.direction.slice(1)} ${p.symbol}${p.title ? `: ${p.title}` : ""}`;

const FIELDS = ["symbol", "direction", "title", "thesis", "variantView", "killCriteria", "catalysts", "risks", "valuation", "bullCase", "baseCase", "bearCase", "bullPrice", "basePrice", "bearPrice", "sizePct", "confidencePct", "horizonMonths", "preMortem", "bearChecklist"];
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

// Blind voting: while a vote is open, nobody sees the yes/no split or anyone's comment until
// they have voted themselves (so early votes don't anchor later ones). Closed pitches show all.
function viewTally(pitchId, status, member) {
  const t = tally(pitchId);
  const voted = !!member && t.votes.some((v) => v.memberId === member.id);
  if (status !== "voting" || voted) return { ...t, blind: false };
  return {
    votes: [], counts: null, total: t.total, yesPct: null, quorum: t.quorum, thresholdPct: t.thresholdPct,
    quorumMet: t.quorumMet, passing: null, blind: true,
  };
}

router.get("/pitches", optionalMember, (req, res) => {
  const rows = db.prepare("SELECT * FROM pitches ORDER BY CASE status WHEN 'voting' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, updatedAt DESC").all();
  res.json(rows.map((p) => {
    const t = viewTally(p.id, p.status, req.member);
    return { ...p, voteCounts: t.counts, voteTotal: t.total, passing: t.passing, blind: t.blind };
  }));
});

router.get("/pitches/:id", optionalMember, async (req, res) => {
  const p = db.prepare("SELECT * FROM pitches WHERE id = ?").get(req.params.id);
  if (!p) return res.status(404).json({ error: "Pitch not found." });
  const prices = await latestPrices([p.symbol]);
  res.json({ ...p, readiness: readiness(p), tally: viewTally(p.id, p.status, req.member), currentPrice: prices[p.symbol]?.price ?? null });
});

// What this trade would do to position, sector and cash weights and the policy limits.
router.get("/pitches/:id/fit", async (req, res) => {
  const p = db.prepare("SELECT * FROM pitches WHERE id = ?").get(req.params.id);
  if (!p) return res.status(404).json({ error: "Pitch not found." });
  try {
    const alloc = await portfolio.allocation();
    const sector = await yahoo.getSector(p.symbol).then((x) => x.sector || "").catch(() => "");
    res.json(fitCheck(alloc, p, sector));
  } catch (e) { res.status(502).json({ error: "Couldn't load the fund's weights right now." }); }
});

router.post("/pitches", requireSignedIn, async (req, res) => {
  let data;
  try { data = clean(req.body || {}); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  if (!data.symbol) return res.status(400).json({ error: "A ticker is required." });
  const prices = await latestPrices([data.symbol]);
  const row = { direction: "buy", title: "", thesis: "", variantView: "", killCriteria: "", catalysts: "", risks: "", valuation: "", bullCase: "", baseCase: "", bearCase: "", bullPrice: null, basePrice: null, bearPrice: null, sizePct: null, confidencePct: null, horizonMonths: null, preMortem: "", bearChecklist: "[]", ...data };
  const info = db.prepare(`
    INSERT INTO pitches (symbol, direction, title, author, authorId, thesis, variantView, killCriteria, catalysts, risks, valuation, bullCase, baseCase, bearCase, bullPrice, basePrice, bearPrice, sizePct, confidencePct, horizonMonths, preMortem, bearChecklist, priceAtPitch)
    VALUES (@symbol, @direction, @title, @author, @authorId, @thesis, @variantView, @killCriteria, @catalysts, @risks, @valuation, @bullCase, @baseCase, @bearCase, @bullPrice, @basePrice, @bearPrice, @sizePct, @confidencePct, @horizonMonths, @preMortem, @bearChecklist, @priceAtPitch)
  `).run({ ...row, author: req.member.name, authorId: req.member.id, priceAtPitch: prices[data.symbol]?.price ?? null });
  res.status(201).json(db.prepare("SELECT * FROM pitches WHERE id = ?").get(info.lastInsertRowid));
});

router.put("/pitches/:id", requireSignedIn, (req, res) => {
  const p = db.prepare("SELECT * FROM pitches WHERE id = ?").get(req.params.id);
  if (!p) return res.status(404).json({ error: "Pitch not found." });
  if (!isAuthorOrAdmin(req, p)) return res.status(403).json({ error: "Only the pitch's author or an admin can edit it." });
  if (!["draft", "voting"].includes(p.status)) return res.status(409).json({ error: "Decided pitches can't be edited." });
  let data;
  try { data = clean(req.body || {}); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  const merged = { ...p, ...data };
  db.prepare(`
    UPDATE pitches SET symbol=@symbol, direction=@direction, title=@title, thesis=@thesis, variantView=@variantView, killCriteria=@killCriteria, catalysts=@catalysts, risks=@risks,
      valuation=@valuation, bullCase=@bullCase, baseCase=@baseCase, bearCase=@bearCase, bullPrice=@bullPrice, basePrice=@basePrice,
      bearPrice=@bearPrice, sizePct=@sizePct, confidencePct=@confidencePct, horizonMonths=@horizonMonths, preMortem=@preMortem,
      bearChecklist=@bearChecklist, updatedAt=datetime('now') WHERE id=@id
  `).run(merged);
  res.json(db.prepare("SELECT * FROM pitches WHERE id = ?").get(p.id));
});

// Lifecycle: draft -> voting -> (approved | rejected) -> executed; draft/voting -> withdrawn.
router.post("/pitches/:id/status", requireSignedIn, (req, res) => {
  const p = db.prepare("SELECT * FROM pitches WHERE id = ?").get(req.params.id);
  if (!p) return res.status(404).json({ error: "Pitch not found." });
  const action = req.body?.action;
  const allowed = action === "close" ? req.member.isAdmin || req.member.canTrade
    : action === "executed" ? req.member.canTrade
    : isAuthorOrAdmin(req, p);
  if (!allowed) {
    const who = action === "close" ? "a portfolio manager or admin" : action === "executed" ? "a portfolio manager" : "the pitch's author or an admin";
    return res.status(403).json({ error: `Only ${who} can do that.` });
  }
  let status;
  if (action === "open" && p.status === "draft") {
    const r = readiness(p);
    if (!r.ready) return res.status(400).json({ error: `Before the vote can open, add: ${r.missing.join("; ")}.`, missing: r.missing });
    status = "voting";
    db.prepare("UPDATE pitches SET status='voting', votingOpenedAt=datetime('now'), updatedAt=datetime('now') WHERE id=?").run(p.id);
  } else if (action === "close" && p.status === "voting") {
    const t = tally(p.id);
    if (!t.quorumMet) return res.status(400).json({ error: `Quorum not met: ${t.total} of ${t.quorum} required votes cast.` });
    status = t.passing ? "approved" : "rejected";
    const note = String(req.body?.note || "").trim().slice(0, 1000);
    db.prepare("UPDATE pitches SET status=?, decisionNote=?, decidedAt=datetime('now'), updatedAt=datetime('now') WHERE id=?").run(status, note, p.id);
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
  const link = `#/pitches/${p.id}`;
  if (status === "voting") {
    // Research agents: the red team reads the pitch when it opens for a vote.
    const agents = require("../lib/agents");
    agents.recordEvent({ dedupeKey: `pitch:${p.id}:voting:${new Date().toISOString().slice(0, 16)}`, symbol: p.symbol, type: "PITCH_SUBMITTED", title: `Pitch #${p.id} ${p.symbol} opened for a vote`, payload: { pitchId: p.id } });
    agents.kick();
    notify("all", { type: "pitchVoting", title: `Vote open: ${pitchLabel(p)}`, body: `Pitched by ${p.author}.`, link }, { except: authorIdOf(p) });
  } else if (["approved", "rejected", "executed"].includes(status)) {
    const voters = db.prepare("SELECT memberId FROM votes WHERE pitchId = ?").all(p.id).map((v) => v.memberId);
    const what = status === "executed" ? "was carried out in the real fund" : `was ${status}`;
    notify([authorIdOf(p), ...voters].filter((id) => id != null), { type: "pitchResult", title: `${pitchLabel(p)} ${what}`, body: status === "executed" ? "" : `${tally(p.id).counts.yes} yes, ${tally(p.id).counts.no} no.${action === "close" && req.body?.note ? ` ${String(req.body.note).trim().slice(0, 200)}` : ""}`, link }, { except: req.member.id });
  }
  res.json({ ...db.prepare("SELECT * FROM pitches WHERE id = ?").get(p.id), tally: viewTally(p.id, status, req.member) });
});

router.post("/pitches/:id/vote", requireSignedIn, (req, res) => {
  const p = db.prepare("SELECT * FROM pitches WHERE id = ?").get(req.params.id);
  if (!p) return res.status(404).json({ error: "Pitch not found." });
  if (p.status !== "voting") return res.status(409).json({ error: "Voting isn't open on this pitch." });
  const { vote, comment = "" } = req.body || {};
  if (!["yes", "no", "abstain"].includes(vote)) return res.status(400).json({ error: "Vote must be yes, no or abstain." });
  if (vote === "no" && String(comment).trim().length < 5) return res.status(400).json({ error: "Say why you're voting no, in a few words, so the author can answer it." });
  db.prepare(`
    INSERT INTO votes (pitchId, memberId, vote, comment) VALUES (?, ?, ?, ?)
    ON CONFLICT(pitchId, memberId) DO UPDATE SET vote = excluded.vote, comment = excluded.comment, createdAt = datetime('now')
  `).run(p.id, req.member.id, vote, String(comment).slice(0, 1000));
  res.json(viewTally(p.id, p.status, req.member));
});

router.delete("/pitches/:id", requireSignedIn, (req, res) => {
  const p = db.prepare("SELECT * FROM pitches WHERE id = ?").get(req.params.id);
  if (!p) return res.status(404).json({ error: "Pitch not found." });
  if (!isAuthorOrAdmin(req, p)) return res.status(403).json({ error: "Only the pitch's author or an admin can delete it." });
  if (p.status !== "draft") return res.status(409).json({ error: "Only drafts can be deleted; withdraw it instead." });
  db.prepare("DELETE FROM pitches WHERE id = ?").run(p.id);
  res.status(204).end();
});

module.exports = router;
