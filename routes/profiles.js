// Member profiles: someone's track record in the club (pitches and how they did, votes,
// paper trading, notes they shared). Signed-in members only.
const express = require("express");
const db = require("../db");
const { requireSignedIn } = require("../middleware/auth");
const { benchmarkFor } = require("../lib/prefs");
const { getSettings } = require("../lib/settings");
const benchmarks = require("../lib/benchmarks");
const { latestPrices, histories } = require("../lib/prices");
const S = require("../lib/paperSeason");

const router = express.Router();

const day = (utc) => (utc ? utc.slice(0, 10) : null);
// First close on or after a date (the price when something was decided), else null.
const closeFrom = (bars, date) => bars?.find((b) => b.date >= date)?.close ?? null;
// Sell/trim pitches are right when the stock does worse, so their result is flipped.
const sideOf = (direction) => (direction === "sell" || direction === "trim" ? -1 : 1);

router.get("/members/:id/profile", requireSignedIn, async (req, res) => {
  const m = db.prepare("SELECT * FROM members WHERE id = ?").get(req.params.id);
  if (!m || (!m.passwordHash && !req.member.isAdmin)) return res.status(404).json({ error: "Member not found." });
  const self = m.id === req.member.id;
  let bench;
  try { bench = benchmarkFor(req); } catch { bench = getSettings().benchmark; }

  const pitches = db.prepare(`SELECT id, symbol, direction, title, status, priceAtPitch, basePrice, createdAt, votingOpenedAt, decidedAt FROM pitches
    WHERE (authorId = ? OR (authorId IS NULL AND author = ?)) AND status != 'draft' ORDER BY id DESC`).all(m.id, m.name);
  const votes = db.prepare(`SELECT v.vote, v.createdAt, p.id AS pitchId, p.symbol, p.direction, p.title, p.status FROM votes v JOIN pitches p ON p.id = v.pitchId
    WHERE v.memberId = ? ORDER BY v.createdAt DESC`).all(m.id);
  const symbols = [...new Set([...pitches, ...votes].map((x) => x.symbol))];
  const [quotes, hist, benchSeries] = await Promise.all([
    symbols.length ? latestPrices(symbols) : {},
    symbols.length ? histories(symbols, "2y") : {},
    benchmarks.series(bench, "5y").catch(() => []),
  ]);
  const benchNow = benchSeries.at(-1)?.close ?? null;
  const benchSince = (date) => { const b = closeFrom(benchSeries, date); return b && benchNow ? benchNow / b - 1 : null; };

  // How each pitch's stock has done since it was pitched, against the benchmark over the same days.
  const pitchRows = pitches.map((p) => {
    const start = day(p.createdAt);
    const from = p.priceAtPitch ?? closeFrom(hist[p.symbol], start);
    const now = quotes[p.symbol]?.price ?? null;
    const ret = from && now ? now / from - 1 : null;
    const b = benchSince(start);
    return { ...p, currentPrice: now, returnSince: ret, benchSince: b, excess: ret != null && b != null ? sideOf(p.direction) * (ret - b) : null };
  });

  // Votes: a yes on a buy (or a no on a sell) is "for the stock". Measured from the vote's date.
  const voteRows = votes.map((v) => {
    const start = day(v.createdAt);
    const from = closeFrom(hist[v.symbol], start);
    const now = quotes[v.symbol]?.price ?? null;
    const ret = from && now ? now / from - 1 : null;
    const b = benchSince(start);
    return { ...v, returnSince: ret, excess: ret != null && b != null ? ret - b : null };
  });
  const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  const forStock = voteRows.filter((v) => v.excess != null && ((v.vote === "yes" && sideOf(v.direction) > 0) || (v.vote === "no" && sideOf(v.direction) < 0)));
  const againstStock = voteRows.filter((v) => v.excess != null && ((v.vote === "no" && sideOf(v.direction) > 0) || (v.vote === "yes" && sideOf(v.direction) < 0)));
  const opened = db.prepare("SELECT COUNT(*) AS c FROM pitches WHERE votingOpenedAt IS NOT NULL AND votingOpenedAt >= ?").get(m.createdAt).c;

  // Paper trading: this season, and up to 3 past seasons they traded in.
  const open = S.currentSeason();
  const seasons = [open, ...db.prepare(`SELECT s.* FROM paper_seasons s WHERE s.endedAt IS NOT NULL AND EXISTS
    (SELECT 1 FROM paper_trades t WHERE t.seasonId = s.id AND t.memberId = ? AND t.status = 'filled') ORDER BY s.id DESC LIMIT 3`).all(m.id)];
  const paper = [];
  for (const s of seasons) {
    const st = await S.standings(s, { viewerId: m.id, bench });
    const mine = st.mine;
    paper.push({
      season: { id: s.id, name: s.name, ended: !!s.endedAt },
      totalValue: mine.totalValue, returnPct: mine.returnPct,
      excessPct: st.benchmark && mine.returnPct != null ? mine.returnPct - st.benchmark.returnPct : null,
      benchmark: st.benchmark?.label || null,
      rank: mine.rank?.rank ?? null, ranked: st.leaderboard.filter((r) => r.qualified).length, why: mine.rank?.why || null,
      sharpe: mine.risk.sharpe, maxDrawdown: mine.risk.maxDrawdown,
      // Current holdings with the reason they were bought (current season only).
      positions: s.endedAt ? [] : mine.positions.map((p) => ({ symbol: p.symbol, weight: p.weight, gain: p.gain, thesis: p.thesis })),
      recent: s.endedAt ? [] : mine.recent.filter((t) => self || t.status === "filled").slice(0, 10),
    });
  }

  const notes = db.prepare("SELECT id, symbol, body, quote, pageRef, pageTitle, updatedAt FROM notes WHERE memberId = ? AND visibility = 'club' ORDER BY updatedAt DESC LIMIT 10").all(m.id);
  const noteCounts = db.prepare("SELECT SUM(visibility = 'club') AS shared, SUM(visibility = 'private') AS private FROM notes WHERE memberId = ?").get(m.id);

  res.json({
    member: { id: m.id, name: m.name, title: m.role || "", isAdmin: !!m.isAdmin, canTrade: !!m.canTrade, active: !!m.active, since: day(m.createdAt) },
    self,
    benchmark: benchmarks.shortName(bench),
    pitches: pitchRows,
    pitchSummary: { count: pitchRows.length, approved: pitchRows.filter((p) => ["approved", "executed"].includes(p.status)).length, avgExcess: avg(pitchRows.filter((p) => p.excess != null).map((p) => p.excess)) },
    votes: voteRows.slice(0, 20),
    voteSummary: { cast: votes.length, opened, forAvgExcess: avg(forStock.map((v) => v.excess)), forCount: forStock.length, againstAvgExcess: avg(againstStock.map((v) => v.excess)), againstCount: againstStock.length },
    paper,
    notes,
    noteCounts: { shared: noteCounts.shared || 0, private: self ? noteCounts.private || 0 : null },
  });
});

module.exports = router;
