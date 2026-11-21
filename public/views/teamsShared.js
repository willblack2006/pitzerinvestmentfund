// Agent teams (WS6): rendering shared by the Agents → Teams tab, the team run page and the pitch
// page's committee panel. Everything from the model or members is escaped.
import { esc, api, icon, fmtUSD } from "../shared.js";
import { sourceLink, localTime, aiErrorHtml } from "../ai.js";

const money = (v) => (v == null ? "—" : v > 0 && v < 0.01 ? `$${v.toFixed(4)}` : fmtUSD(v));
const pct = (v) => (v == null ? "—" : `${Math.round(v * 100)}%`);
export const TEAM_LABEL = { committee: "Investment committee", deep_research: "Deep research", portfolio_review: "Weekly portfolio review" };
const ROLE_LABEL = { bull: "Bull", bear: "Bear", risk: "Risk & policy", valuation: "Valuation" };
const ROLE_ICON = { bull: "▲", bear: "▼", risk: "◆", valuation: "≈" };
const STANCE = { for: ["For", "is-pos"], against: ["Against", "is-neg"], mixed: ["Mixed", "is-mid"] };
const LEAN = {
  yes: ["Leans yes", "is-pos"], no: ["Leans no", "is-neg"], abstain: ["Leans abstain", "is-mid"],
  intact: ["Thesis intact", "is-pos"], watch: ["Thesis on watch", "is-mid"], weakened: ["Thesis weakened", "is-neg"], broken: ["Thesis broken", "is-neg"],
};
const STATUS = { running: ["Working", "is-run"], done: ["Done", "is-pos"], failed: ["Failed", "is-neg"], refused: ["Stopped", "is-mid"] };
const TRIGGER = { manual: "Started by", event: "Started automatically when the pitch opened for a vote", schedule: "Weekly schedule", handoff: "Handed off by another agent" };

export const statusChip = (s) => { const [l, c] = STATUS[s] || [s, ""]; return `<span class="team-chip ${c}">${s === "running" ? `<span class="agent-pulse" aria-hidden="true"></span>` : ""}${esc(l)}</span>`; };
const stanceChip = (s) => { const [l, c] = STANCE[s] || [s || "—", ""]; return `<span class="team-chip ${c}">${esc(l)}</span>`; };
const confMeter = (v, label = "Confidence") => v == null ? "" : `<span class="team-conf" title="${label} ${pct(v)}"><span class="team-conf-bar" role="meter" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(v * 100)}"><span style="width:${Math.round(v * 100)}%"></span></span><span class="small">${pct(v)}</span></span>`;
const srcs = (u, sourced) => u ? `${sourceLink(u)}${sourced === false ? ` <span class="badge badge-warn" title="The agent cites this but never read it in this run">not read</span>` : ""}` : "";
const list = (items, cls = "") => items?.length ? `<ul class="small ${cls}">${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : "";
const unbacked = (nums) => nums?.length ? `<p class="notice small">Check these numbers, no source backs them: ${nums.map(esc).join(", ")}</p>` : "";

// Header: what, status, cost against budget, who/what started it.
export function runHeader(tree, { link = false } = {}) {
  const used = tree.budgetUsd ? Math.min(100, (tree.costUsd / tree.budgetUsd) * 100) : 0;
  const who = tree.trigger === "manual" ? `${TRIGGER.manual} ${esc(tree.startedByName || "a member")}` : esc(TRIGGER[tree.trigger] || tree.trigger);
  return `<header class="team-head">
    <div class="team-head-main">
      <p class="muted small">${esc(TEAM_LABEL[tree.team] || tree.team)} · ${localTime(tree.createdAt)} · ${who}</p>
      <h3>${link ? `<a href="#/agents/teams/${tree.runId}">${esc(tree.title)}</a>` : esc(tree.title)}</h3>
    </div>
    <div class="team-head-side">${statusChip(tree.status)}
      <span class="team-cost small" title="Whole team, including every worker">${money(tree.costUsd)} of ${money(tree.budgetUsd)}</span>
      <span class="team-conf-bar team-budget" role="meter" aria-label="Team budget used" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${used.toFixed(0)}"><span style="width:${used.toFixed(1)}%"></span></span>
    </div>
  </header>
  ${tree.status === "running" ? `<p class="team-phase small" role="status" aria-live="polite"><span class="agent-pulse" aria-hidden="true"></span>${esc(tree.phase || "Working")}…</p>` : ""}
  ${tree.status !== "running" && tree.status !== "done" && tree.error ? `<p class="error small" role="alert">${esc(tree.error)}</p>` : ""}`;
}

// The run tree: every worker with its state, calls and cost, linked to its full trace.
export function workersHtml(tree) {
  if (!tree.workers?.length) return "";
  const rounds = [...new Set(tree.workers.map((w) => w.round))];
  const roundName = (r) => tree.team === "committee" ? (r === 1 ? "Round 1: memos" : "Round 2: rebuttals") : tree.team === "deep_research" ? "Analysts" : "Holdings";
  return `<details class="team-tree"${tree.status === "running" ? " open" : ""}><summary>How the team worked: ${tree.workers.length} agent run${tree.workers.length === 1 ? "" : "s"}${tree.synthesisCostUsd ? ` + synthesis (${money(tree.synthesisCostUsd)})` : ""}</summary>
    ${rounds.map((r) => `<p class="pf-sub">${esc(roundName(r))}</p><ol class="team-workers">${tree.workers.filter((w) => w.round === r).map((w) => `<li>
      <span class="team-dot is-${esc(w.status)}" aria-hidden="true"></span>
      <a href="#/agents/runs/${w.runId}">${esc(ROLE_LABEL[w.role] || w.label || w.role)}</a>
      <span class="muted small">${w.status === "running" ? esc(w.lastStep || "Starting") : `${w.modelCalls} model · ${w.toolCalls} tool calls · ${money(w.costUsd)}`}</span>
      ${w.status === "failed" || w.status === "refused" ? `<span class="small team-err">${esc(w.error || w.status)}</span>` : ""}
    </li>`).join("")}</ol>`).join("")}
  </details>`;
}

// ---- Committee ----

function memoCard(m, reb) {
  if (!m.ok) return `<article class="team-memo is-missing"><h4><span aria-hidden="true">${ROLE_ICON[m.role] || ""}</span> ${esc(ROLE_LABEL[m.role] || m.label)}</h4><p class="small muted">This memo didn't finish: ${esc(m.error || "unknown error")}</p></article>`;
  const moved = reb && reb.stance && reb.stance !== m.stance;
  return `<article class="team-memo role-${esc(m.role)}">
    <header><h4><span aria-hidden="true">${ROLE_ICON[m.role] || ""}</span> ${esc(ROLE_LABEL[m.role] || m.label)}</h4>${stanceChip(m.stance)}${confMeter(m.confidence)}</header>
    <p class="team-memo-head">${esc(m.headline)}</p>
    <details><summary class="small">Full memo</summary><div class="team-prose small">${String(m.memo || "").split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join("")}</div></details>
    <ul class="team-points">${(m.points || []).map((p) => `<li><p>${esc(p.text)}</p><p class="muted small">${esc(p.evidence)} ${srcs(p.source_url, p.sourced)}</p></li>`).join("")}</ul>
    ${m.keyQuestion ? `<p class="small"><strong>Would change my mind:</strong> ${esc(m.keyQuestion)}</p>` : ""}
    ${unbacked(m.unbackedNumbers)}
    ${reb?.ok ? `<section class="team-rebuttal" aria-label="${esc(ROLE_LABEL[m.role])} rebuttal">
      <p class="pf-sub">Rebuttal ${moved ? `<span class="team-moved">moved to ${stanceChip(reb.stance)}</span>` : ""} ${confMeter(reb.confidence, "Confidence after rebuttal")}</p>
      <ul class="small">${(reb.responses || []).map((r) => `<li><span class="team-to">→ ${esc(ROLE_LABEL[r.to] || r.to)}</span> on “${esc(r.point)}”: ${esc(r.reply)} ${srcs(r.source_url, r.sourced)}</li>`).join("")}</ul>
      ${reb.concede ? `<p class="small"><strong>Concedes:</strong> ${esc(reb.concede)}</p>` : ""}
    </section>` : reb && !reb.ok ? `<p class="small muted">Rebuttal didn't finish: ${esc(reb.error || "")}</p>` : ""}
  </article>`;
}

export function synthesisHtml(s, subjectType) {
  if (!s) return "";
  const [leanLabel, leanCls] = LEAN[s.lean] || [s.lean, ""];
  return `<section class="team-synth" aria-label="PM synthesis">
    <div class="team-synth-top">
      <div><p class="pf-sub">PM synthesis</p><p class="team-synth-head">${esc(s.headline)}</p></div>
      <div class="team-lean ${leanCls}"><span class="team-lean-label">${esc(leanLabel)}</span>${confMeter(s.confidence)}</div>
    </div>
    <p>${esc(s.summary)}</p>
    ${s.disagreements?.length ? `<div class="table-scroll"><table class="mini-table team-disagree"><caption class="sr-only">Where the committee disagrees</caption>
      <thead><tr><th scope="col" class="left">Disagreement</th><th scope="col" class="left">Views</th><th scope="col" class="left">What would settle it</th></tr></thead>
      <tbody>${s.disagreements.map((d) => `<tr><th scope="row" class="left">${esc(d.topic)}</th><td class="left small">${(d.positions || []).map((p) => `<div><strong>${esc(ROLE_LABEL[p.role] || p.role)}:</strong> ${esc(p.view)}</div>`).join("")}</td><td class="left small">${esc(d.whatWouldSettleIt)}</td></tr>`).join("")}</tbody></table></div>` : ""}
    <div class="team-cols">
      ${s.agreements?.length ? `<div><p class="pf-sub">Everyone agrees</p>${list(s.agreements)}</div>` : ""}
      ${s.changeMind?.length ? `<div><p class="pf-sub">Would flip the lean</p>${list(s.changeMind)}</div>` : ""}
      ${s.questions?.length ? `<div><p class="pf-sub">${subjectType === "pitch" ? "Questions for the author" : "Questions for the fund"}</p>${list(s.questions)}</div>` : ""}
      ${s.watchItems?.length ? `<div><p class="pf-sub">Watch</p>${list(s.watchItems)}</div>` : ""}
    </div>
    ${s.rationale ? `<details><summary class="small">Why this lean</summary><p class="small">${esc(s.rationale)}</p></details>` : ""}
  </section>`;
}

export function committeeHtml(o) {
  const reb = Object.fromEntries((o.rebuttals || []).map((r) => [r.role, r]));
  return `${synthesisHtml(o.synthesis, o.subject?.type)}
    <h4 class="team-sub">The debate</h4>
    <div class="team-debate">${(o.memos || []).map((m) => memoCard(m, reb[m.role])).join("")}</div>`;
}

// While a committee is still running, show memos as they land.
function liveCommittee(tree) {
  const memos = tree.workers.filter((w) => w.round === 1).map((w) => ({ role: w.role, label: w.label, ok: w.status === "done", error: w.status === "running" ? null : w.error, ...(w.output || {}), _running: w.status === "running" }));
  const reb = Object.fromEntries(tree.workers.filter((w) => w.round === 2 && w.status === "done").map((w) => [w.role, { ok: true, ...(w.output || {}) }]));
  if (!memos.length) return "";
  return `<div class="team-debate">${memos.map((m) => m._running ? `<article class="team-memo is-pending"><h4><span aria-hidden="true">${ROLE_ICON[m.role] || ""}</span> ${esc(ROLE_LABEL[m.role] || m.label)}</h4><p class="small muted"><span class="agent-pulse" aria-hidden="true"></span> Researching…</p></article>` : memoCard(m, reb[m.role])).join("")}</div>`;
}

// ---- Deep research ----

export function dossierHtml(o) {
  const d = o.dossier || {};
  return `<section class="team-synth" aria-label="Dossier">
      <p class="pf-sub">Dossier${o.focus ? ` · focus: ${esc(o.focus)}` : ""}</p>
      <p class="team-synth-head">${esc(d.headline)}</p>
      <p>${esc(d.summary)}</p>
      ${unbacked(o.unbackedNumbers)}
    </section>
    ${(d.sections || []).map((s) => `<section class="team-section"><h4>${esc(s.heading)}</h4>${String(s.body || "").split(/\n{2,}/).map((p) => `<p class="small">${esc(p)}</p>`).join("")}
      ${s.sources?.length ? `<p class="small muted">Sources: ${s.sources.map((u) => sourceLink(u)).join(" · ")}</p>` : ""}</section>`).join("")}
    <div class="team-cols">
      <div><p class="pf-sub">▲ Bull points</p>${list(d.bullPoints)}</div>
      <div><p class="pf-sub">▼ Bear points</p>${list(d.bearPoints)}</div>
    </div>
    ${d.keyNumbers?.length ? `<div class="table-scroll"><table class="mini-table"><caption class="sr-only">Key numbers</caption><thead><tr><th scope="col" class="left">Figure</th><th scope="col" class="num">Value</th><th scope="col" class="left">Source</th></tr></thead>
      <tbody>${d.keyNumbers.map((k) => `<tr><th scope="row" class="left">${esc(k.label)}</th><td class="num">${esc(k.value)}</td><td class="left small">${srcs(k.source_url, k.sourced)}</td></tr>`).join("")}</tbody></table></div>` : ""}
    <div class="team-cols">
      ${d.openQuestions?.length ? `<div><p class="pf-sub">Open questions</p>${list(d.openQuestions)}</div>` : ""}
      ${d.nextSteps?.length ? `<div><p class="pf-sub">Next steps</p>${list(d.nextSteps)}</div>` : ""}
    </div>
    ${o.remembered ? `<p class="small muted">${o.remembered} finding${o.remembered === 1 ? "" : "s"} saved to the fund's shared memory for other agents.</p>` : ""}
    <details class="team-tree"><summary>Each analyst's answer</summary>${(o.findings || []).map((f) => `<section class="team-section"><h4>${esc(f.label)}${f.ok ? ` ${confMeter(f.confidence)}` : ""}</h4>
      ${f.ok ? `<p class="small muted">${esc(f.question)}</p><div class="small">${String(f.answer || "").split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join("")}</div>
      <ul class="small">${(f.findings || []).map((x) => `<li>${esc(x.text)} ${srcs(x.source_url, x.sourced)}</li>`).join("")}</ul>${f.gaps?.length ? `<p class="small muted">Couldn't find: ${f.gaps.map(esc).join("; ")}</p>` : ""}`
      : `<p class="small muted">Didn't finish: ${esc(f.error || "")}</p>`}</section>`).join("")}</details>`;
}

// ---- Portfolio review ----

const SCORE_SHAPE = (v, invert = false) => {
  if (v == null) return `<span class="muted">—</span>`;
  const good = invert ? v <= 2 : v >= 4, bad = invert ? v >= 4 : v <= 2;
  return `<span class="team-score ${good ? "is-pos" : bad ? "is-neg" : "is-mid"}" title="${v} of 5">${good ? "▲" : bad ? "▼" : "●"} ${v}</span>`;
};

export function reviewHtml(o) {
  return `<section class="team-synth" aria-label="Monday agenda">
      <p class="pf-sub">Five things to discuss at Monday's meeting</p>
      <p class="team-synth-head">${esc(o.headline)}</p>
      <ol class="team-agenda">${(o.agenda || []).map((a) => `<li><p><strong>${esc(a.title)}</strong>${(a.symbols || []).map((s) => ` <a class="symbol-cell" href="#/research/${encodeURIComponent(s)}">${esc(s)}</a>`).join("")}</p><p class="small">${esc(a.detail)}</p><p class="small"><em>${esc(a.question)}</em></p></li>`).join("")}</ol>
      ${o.quiet?.length ? `<p class="small muted">Quiet this week: ${o.quiet.map(esc).join(", ")}</p>` : ""}
    </section>
    <div class="table-scroll"><table class="mini-table team-scores"><caption>Scorecards (1 to 5; for risk, higher means more risk)</caption>
      <thead><tr><th scope="col" class="left">Holding</th><th scope="col" class="num">Weight</th><th scope="col" class="num">Thesis</th><th scope="col" class="num">Valuation</th><th scope="col" class="num">Risk</th><th scope="col" class="left">This week</th></tr></thead>
      <tbody>${(o.scoreboard || []).map((s) => s.error ? `<tr><th scope="row" class="left">${esc(s.symbol)}</th><td colspan="5" class="left small muted">Not scored: ${esc(s.error)}</td></tr>`
        : `<tr${s.discuss ? ` class="team-discuss"` : ""}><th scope="row" class="left"><a class="symbol-cell" href="#/research/${encodeURIComponent(s.symbol)}">${esc(s.symbol)}</a></th><td class="num">${s.weight}%</td>
          <td class="num">${SCORE_SHAPE(s.thesis?.score)}</td><td class="num">${SCORE_SHAPE(s.valuation?.score)}</td><td class="num">${SCORE_SHAPE(s.risk?.score, true)}</td>
          <td class="left small">${esc(s.headline)}${s.discuss ? ` <span class="badge badge-watch" title="${esc(s.whyDiscuss)}">discuss</span>` : ""} <a href="#/agents/runs/${s.runId}" class="muted">trace</a></td></tr>`).join("")}</tbody></table></div>`;
}

// The body of a finished (or running) team run.
export function teamBodyHtml(tree) {
  const o = tree.output;
  if (tree.status === "running" || !o) return tree.team === "committee" ? liveCommittee(tree) : "";
  if (o.kind === "committee") return committeeHtml(o);
  if (o.kind === "deep_research") return dossierHtml(o);
  if (o.kind === "portfolio_review") return reviewHtml(o);
  return "";
}

export function teamRunHtml(tree, opts = {}) {
  return `<article class="panel team-run" data-run="${tree.runId}">${runHeader(tree, opts)}${teamBodyHtml(tree)}${workersHtml(tree)}
    <footer class="agent-brief-foot"><span class="muted small">AI agents simulating a research team, not advice. Members decide and vote. <a href="#/agents/runs/${tree.runId}">Synthesis trace</a></span></footer></article>`;
}

// Polls a running team run into `box` until it finishes. Returns a stop function.
export function followRun(box, runId, { onDone, opts = {} } = {}) {
  let stopped = false, timer = null, lastStatus = null;
  const tick = async () => {
    if (stopped || !box.isConnected) return;
    let tree;
    try { tree = await api(`/api/agents/teams/runs/${runId}`); } catch (err) { box.innerHTML = aiErrorHtml(err); return; }
    // Keep open <details> open across repaints.
    const open = [...box.querySelectorAll("details[open] > summary")].map((s) => s.textContent);
    box.innerHTML = teamRunHtml(tree, opts);
    box.querySelectorAll("details > summary").forEach((s) => { if (open.includes(s.textContent)) s.parentElement.open = true; });
    if (tree.status === "running") timer = setTimeout(tick, 2500);
    else if (lastStatus === "running" || lastStatus === null) { onDone?.(tree); }
    lastStatus = tree.status;
  };
  tick();
  return () => { stopped = true; clearTimeout(timer); };
}

export function runRow(r) {
  return `<li class="team-row"><a href="#/agents/teams/${r.runId}">
    <span class="team-row-main"><strong>${esc(r.title)}</strong>${r.headline ? `<span class="small muted">${esc(r.headline)}</span>` : ""}</span>
    <span class="team-row-side">${statusChip(r.status)}<span class="small muted">${localTime(r.createdAt)} · ${money(r.costUsd)}${r.startedByName ? ` · ${esc(r.startedByName)}` : r.trigger !== "manual" ? ` · ${esc(r.trigger === "schedule" ? "scheduled" : "automatic")}` : ""}</span></span>
  </a></li>`;
}

export { money, icon };
