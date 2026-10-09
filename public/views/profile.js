import { esc, api, can, currentMember, pageHead, loading, lockedHint, errorBox, fmtUSD, fmtPct, signed } from "../shared.js";
import { noteCard } from "../notes.js";

export const title = "Profile";

const pct = (v) => (Number.isFinite(v) ? signed(v * 100, fmtPct(v * 100)) : "—");
const plainPct = (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : "—");
const STATUS = { voting: "Voting", approved: "Approved", rejected: "Rejected", executed: "Executed", withdrawn: "Withdrawn" };
const DIR = { buy: "Buy", add: "Add", trim: "Trim", sell: "Sell" };

function summaryStats(d) {
  const p = d.paper[0];
  const v = d.voteSummary;
  return `<section class="summary" aria-label="Summary">
    <div class="stat"><div class="label">Pitches</div><div class="value">${d.pitchSummary.count}</div><div class="sub">${d.pitchSummary.approved} approved${d.pitchSummary.avgExcess != null ? ` · avg ${pct(d.pitchSummary.avgExcess)} vs ${esc(d.benchmark)}` : ""}</div></div>
    <div class="stat"><div class="label">Votes cast</div><div class="value">${v.cast}</div><div class="sub">${v.opened ? `on ${Math.min(100, Math.round((v.cast / v.opened) * 100))}% of pitches put to a vote` : "No votes held yet"}</div></div>
    <div class="stat"><div class="label">Paper trading</div><div class="value">${p ? pct(p.returnPct) : "—"}</div><div class="sub">${p ? (p.rank ? `#${p.rank} of ${p.ranked} · ${esc(p.season.name)}` : esc(p.why || p.season.name)) : ""}</div></div>
    <div class="stat"><div class="label">Shared notes</div><div class="value">${d.noteCounts.shared}</div><div class="sub">${d.self ? `${d.noteCounts.private} private (only you see those)` : "Notes shared with the club"}</div></div>
  </section>`;
}

function pitchesPanel(d) {
  return `<section class="panel span-full" aria-labelledby="pp-h">
    <h3 id="pp-h">Pitches</h3>
    ${d.pitches.length ? `<div class="table-scroll"><table class="mini-table">
      <caption class="sr-only">Pitches and how each stock has done since it was pitched</caption>
      <thead><tr><th scope="col">Pitch</th><th scope="col">Status</th><th scope="col">Pitched</th><th scope="col" class="num">Price then</th><th scope="col" class="num">Now</th><th scope="col" class="num">Since</th><th scope="col" class="num">Call vs ${esc(d.benchmark)}</th></tr></thead>
      <tbody>${d.pitches.map((p) => `<tr>
        <th scope="row"><a href="#/pitches/${p.id}">${esc(DIR[p.direction] || p.direction)} ${esc(p.symbol)}</a>${p.title ? `<div class="muted small cell-note">${esc(p.title)}</div>` : ""}</th>
        <td><span class="status-pill status-${esc(p.status)}">${esc(STATUS[p.status] || p.status)}</span></td>
        <td>${esc(p.createdAt.slice(0, 10))}</td>
        <td class="num">${p.priceAtPitch ? fmtUSD(p.priceAtPitch) : "—"}</td><td class="num">${p.currentPrice ? fmtUSD(p.currentPrice) : "—"}</td>
        <td class="num">${pct(p.returnSince)}</td><td class="num">${pct(p.excess)}</td></tr>`).join("")}</tbody>
    </table></div>
    <p class="muted small">"Call vs ${esc(d.benchmark)}" is the stock's return since the pitch minus ${esc(d.benchmark)}'s over the same days, flipped for sell and trim pitches (those are right when the stock lags).</p>`
    : `<p class="muted small">No pitches yet${d.self ? `. <a href="#/pitches/new">Start one</a>.` : "."}</p>`}
  </section>`;
}

function votesPanel(d) {
  const v = d.voteSummary;
  return `<section class="panel" aria-labelledby="pv-h">
    <h3 id="pv-h">Voting record</h3>
    ${v.forCount || v.againstCount ? `<p class="small">Stocks ${d.self ? "you" : "they"} voted for: ${v.forCount ? `${pct(v.forAvgExcess)} vs ${esc(d.benchmark)} on average (${v.forCount})` : "none yet"}.<br>
      Stocks ${d.self ? "you" : "they"} voted against: ${v.againstCount ? `${pct(v.againstAvgExcess)} vs ${esc(d.benchmark)} on average (${v.againstCount})` : "none yet"}.</p>
      <p class="muted small">Good judgment shows up as the first number above the second, over many votes. Measured from the day of each vote.</p>` : ""}
    ${d.votes.length ? `<ul class="link-list small">${d.votes.map((x) => `<li><strong>${esc(x.vote)}</strong> on <a href="#/pitches/${x.pitchId}">${esc(DIR[x.direction] || x.direction)} ${esc(x.symbol)}</a> <span class="muted">${esc(x.createdAt.slice(0, 10))} · since then ${pct(x.returnSince)}</span></li>`).join("")}</ul>` : `<p class="muted small">No votes yet.</p>`}
  </section>`;
}

function paperPanel(d) {
  const cur = d.paper[0];
  const reason = (t) => (t?.reason ? `“${esc(t.reason)}”` : `<span class="muted">—</span>`);
  return `<section class="panel" aria-labelledby="ppt-h">
    <h3 id="ppt-h">Paper trading</h3>
    ${d.paper.length ? `<div class="table-scroll"><table class="mini-table"><caption class="sr-only">Paper trading by season</caption>
      <thead><tr><th scope="col">Season</th><th scope="col" class="num">Return</th><th scope="col" class="num">Vs benchmark</th><th scope="col" class="num">Rank</th><th scope="col" class="num">Sharpe</th><th scope="col" class="num">Biggest drop</th></tr></thead>
      <tbody>${d.paper.map((p) => `<tr><th scope="row">${esc(p.season.name)}${p.season.ended ? "" : ' <span class="muted small">(now)</span>'}</th><td class="num">${pct(p.returnPct)}</td><td class="num">${pct(p.excessPct)}</td>
        <td class="num">${p.rank ? `${p.rank} of ${p.ranked}` : `<span class="muted" title="${esc(p.why || "")}">—</span>`}</td><td class="num">${Number.isFinite(p.sharpe) ? p.sharpe.toFixed(2) : "—"}</td><td class="num">${plainPct(p.maxDrawdown)}</td></tr>`).join("")}</tbody></table></div>` : ""}
    ${cur?.positions.length ? `<p class="pf-sub">Holding now, and why</p><ul class="link-list small">${cur.positions.map((p) => `<li><a class="symbol-cell" href="#/research/${encodeURIComponent(p.symbol)}">${esc(p.symbol)}</a> <span class="muted">${plainPct(p.weight)}</span> ${reason(p.thesis)}</li>`).join("")}</ul>` : `<p class="muted small">No paper positions this season.</p>`}
    <p><a class="small" href="#/paper">Paper trading →</a></p>
  </section>`;
}

export async function mount(container, params) {
  if (!can("member")) {
    container.innerHTML = pageHead("Profile") + `<div class="toolbar">${lockedHint("Sign in to see members' profiles.")}</div>`;
    return;
  }
  const id = params.id === "me" ? currentMember().id : Number(params.id);
  container.innerHTML = pageHead("Profile") + loading("Loading the track record…");
  let d;
  try { d = await api(`/api/members/${id}/profile`); } catch (err) { container.innerHTML = pageHead("Profile") + errorBox(err.message, false); return; }
  if (!container.isConnected) return;
  const m = d.member;
  const roles = [m.title, m.isAdmin ? "Admin" : "", m.canTrade ? "Portfolio manager" : "", m.active ? "" : "Alumni"].filter(Boolean).join(" · ");
  container.innerHTML = `
    <div class="page-head profile-head">
      <span class="profile-avatar" aria-hidden="true">${esc(m.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase())}</span>
      <div><h2 tabindex="-1">${esc(m.name)}${d.self ? ' <span class="muted small">(you)</span>' : ""}</h2>
      <p class="muted small">${esc(roles)}${m.since ? ` · member since ${esc(m.since)}` : ""}</p></div>
    </div>
    ${summaryStats(d)}
    <div class="tab-grid">
      ${pitchesPanel(d)}
      ${votesPanel(d)}
      ${paperPanel(d)}
      <section class="panel span-full" aria-labelledby="pn-h">
        <h3 id="pn-h">Notes shared with the club</h3>
        ${d.notes.length ? `<div class="notes-list">${d.notes.map((n) => noteCard({ ...n, authorName: m.name, mine: false, visibility: "club", tags: [] })).join("")}</div>` : `<p class="muted small">None yet.</p>`}
      </section>
    </div>`;
}
