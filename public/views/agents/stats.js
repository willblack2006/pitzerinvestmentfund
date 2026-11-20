// Agent stats (plan WS8). As a tab of the Agents hub: every agent with runs, success rate,
// typical cost and time, and how members rated it. As a page (#/agents/stats/:key): one agent's
// runs per day, spend against its budget, fire rate against what was expected, feedback reasons,
// eval results and its recent runs, each linking to its trace.
import { esc, api, can, pageHead, lockedHint, skeleton, emptyState, errorState } from "../../shared.js";
import { localTime } from "../../ai.js";
import { money, dur } from "./trace.js";
import { miniBars, shortDay } from "./miniBars.js";
import { ensureCss } from "./cssLoader.js";

export const title = "Agent stats";

const STATUS = { done: "badge-owned", failed: "badge-danger", refused: "badge-warn", running: "badge-watch" };
const REASON_LABEL = { wrong_number: "Wrong number", wrong_source: "Bad source", not_relevant: "Not relevant", already_knew: "Already knew", too_long: "Too long", great_catch: "Great catch", saved_time: "Saved me time" };
const pct = (v) => (v == null ? "—" : `${Math.round(v * 100)}%`);

async function label(w) {
  try { return (await import("../agents.js")).workflowLabel(w); } catch { return w; }
}

function rateBadge(v, { good = 0.9, ok = 0.7 } = {}) {
  if (v == null) return `<span class="muted">—</span>`;
  const tone = v >= good ? "badge-owned" : v >= ok ? "badge-warn" : "badge-danger";
  const word = v >= good ? "" : v >= ok ? " (watch)" : " (low)";
  return `<span class="badge ${tone}">${pct(v)}${word}</span>`;
}

async function overviewTable(rows) {
  if (!rows.length) return emptyState({ icon: "inbox", title: "No agent runs in the last 30 days", body: "Stats appear once agents run or members use AI features." });
  const names = await Promise.all(rows.map((r) => (r.key.startsWith("w") ? label(r.name) : r.name)));
  return `<div class="table-scroll"><table class="mini-table stats-table"><caption class="sr-only">Agents in the last 30 days</caption>
    <thead><tr><th scope="col" class="left">Agent</th><th scope="col" class="num">Runs</th><th scope="col" class="left">Success</th><th scope="col" class="num">Typical cost</th><th scope="col" class="num">Typical time</th><th scope="col" class="num">This month</th><th scope="col" class="left">Members rated useful</th><th scope="col" class="left">Last run</th></tr></thead>
    <tbody>${rows.map((r, i) => `<tr>
      <th scope="row" class="left"><a href="#/agents/stats/${encodeURIComponent(r.key)}">${esc(names[i])}</a>${r.failureStreak >= 3 ? ` <span class="badge badge-danger" title="${r.failureStreak} failed runs in a row">failing</span>` : ""}${r.status === "paused" ? ` <span class="badge">paused</span>` : ""}</th>
      <td class="num">${r.runs}</td>
      <td class="left">${rateBadge(r.successRate)}</td>
      <td class="num">${money(r.medianCostUsd)}</td>
      <td class="num">${dur(r.medianLatencyMs)}</td>
      <td class="num">${money(r.monthSpentUsd)}${r.monthBudgetUsd ? ` <span class="muted small">of ${money(r.monthBudgetUsd)}</span>` : ""}</td>
      <td class="left">${r.feedback ? `${pct(r.acceptance)} <span class="muted small">of ${r.feedback}</span>` : `<span class="muted small">no ratings</span>`}</td>
      <td class="left small">${r.lastRunAt ? esc(localTime(r.lastRunAt)) : "—"}</td></tr>`).join("")}</tbody></table></div>`;
}

// Tab module for the Agents hub (WS11 shell): { key, label, order, render(el, ctx) }.
export default {
  key: "stats", label: "Stats", order: 70,
  async render(el) {
    ensureCss("/css/trace.css");
    el.innerHTML = skeleton("rows", { rows: 5 });
    try {
      const [o, h] = await Promise.all([api("/api/agents/stats"), api("/api/agents/health").catch(() => ({ problems: [] }))]);
      el.innerHTML = `${h.problems.length ? `<div class="stats-alerts">${h.problems.map((p) => `<p class="notice small"><strong>${esc(p.title)}.</strong> ${esc(p.detail)}</p>`).join("")}</div>` : ""}
        <p class="muted small">The last 30 days. "Typical" is the median run. Success counts finished runs, not ones refused for budget. Open an agent for its daily runs, spend and ratings.</p>
        ${await overviewTable(o.agents)}`;
    } catch (err) { el.innerHTML = errorState({ title: "Couldn't load agent stats.", detail: err.message }); }
  },
};

function tiles(s) {
  const t = (lbl, v, sub = "") => `<div class="trace-tile"><span class="muted small">${lbl}</span><strong>${v}</strong>${sub ? `<span class="muted small">${sub}</span>` : ""}</div>`;
  const fire = s.fireRate.expectedPerDay != null ? `expected ${s.fireRate.expectedPerDay.toFixed(1)} a day` : "no schedule to compare";
  return `<div class="trace-tiles">
    ${t("Runs", s.runs, `${s.fireRate.perDay.toFixed(1)} a day · ${fire}`)}
    ${t("Success", pct(s.successRate), `${s.done} done · ${s.failed} failed${s.refused ? ` · ${s.refused} refused` : ""}`)}
    ${t("Typical cost", money(s.costUsd.median), `1 in 10 runs over ${money(s.costUsd.p90)}`)}
    ${t("Typical time", dur(s.latencyMs.median), `slowest tenth over ${dur(s.latencyMs.p90)}`)}
    ${t("Rated useful", pct(s.feedback.acceptance), `${s.feedback.total} rating${s.feedback.total === 1 ? "" : "s"}${s.costPerUseful != null ? ` · ${money(s.costPerUseful)} per useful run` : ""}`)}
  </div>`;
}

function budgetMeter(m) {
  if (!m.budgetUsd) return `<p class="small">Spent this month: <strong>${money(m.spentUsd)}</strong>. This agent has no budget of its own; the fund's monthly cap applies.</p>`;
  const p = Math.min(100, (m.pct || 0) * 100);
  return `<p class="small">Spent this month: <strong>${money(m.spentUsd)}</strong> of its ${money(m.budgetUsd)} budget</p>
    <div class="agent-meter ${p >= 100 ? "is-bad" : p >= 80 ? "is-warn" : ""}" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p.toFixed(0)}" aria-label="Agent budget used this month"><span style="width:${p.toFixed(1)}%"></span></div>`;
}

export async function mount(container, params = {}) {
  ensureCss("/css/trace.css");
  if (!can("ai")) { container.innerHTML = pageHead("Agent stats") + `<div class="toolbar">${lockedHint("Sign in to see agent stats.", "ai")}</div>`; return; }
  if (!params.key) {
    container.innerHTML = pageHead("Agent stats", "How every agent is doing: runs, success, cost, time and member ratings.") + `<div class="page-pad" id="statsBody"></div>`;
    return (await import("./stats.js")).default.render(container.querySelector("#statsBody"));
  }
  container.innerHTML = pageHead("Agent stats") + `<div class="page-pad">${skeleton("text", { rows: 8 })}</div>`;
  let s;
  try { s = await api(`/api/agents/stats/${encodeURIComponent(params.key)}`); }
  catch (err) { container.querySelector(".page-pad").innerHTML = errorState({ title: "Couldn't load this agent's stats.", detail: err.message }); return; }
  const name = s.key.startsWith("w") ? await label(s.name) : s.name;
  const runsChart = miniBars(s.perDay.map((d) => ({ label: d.day, short: shortDay(d.day), value: d.runs, extra: d.failed ? `${d.failed} failed` : "" })), { label: `${name}: runs per day, last ${s.days} days`, format: (v) => `${v} run${v === 1 ? "" : "s"}` });
  const costChart = miniBars(s.perDay.map((d) => ({ label: d.day, short: shortDay(d.day), value: d.costUsd })), { label: `${name}: AI spend per day`, format: money });
  const reasons = Object.entries(s.feedback.reasons || {}).sort((a, b) => b[1] - a[1]);
  container.innerHTML = pageHead(esc(name), `The last ${s.days} days.${s.agent?.status && s.agent.status !== "active" ? ` <span class="badge">${esc(s.agent.status)}</span>` : ""}`, `<a class="btn btn-ghost btn-sm" href="#/agents/stats">All agents</a>`)
    + `<div class="page-pad trace-page">
    ${s.failureStreak >= 3 ? `<p class="notice small"><strong>The last ${s.failureStreak} runs failed.</strong> Open one below to see where it broke.</p>` : ""}
    ${tiles(s)}
    <div class="stats-grid">
      <section class="panel"><h3>Runs per day</h3>${runsChart}</section>
      <section class="panel"><h3>Spend per day</h3>${costChart}${budgetMeter(s.month)}</section>
    </div>
    <div class="stats-grid">
      <section class="panel"><h3>What members said</h3>
        <p class="small">${s.feedback.useful} useful · ${s.feedback.not_useful} not useful · ${s.feedback.wrong} wrong</p>
        ${reasons.length ? `<ul class="chip-list">${reasons.map(([k, n]) => `<li class="chip">${esc(REASON_LABEL[k] || k)}: ${n}</li>`).join("")}</ul>` : `<p class="muted small">No reasons given yet. Members can add one after rating a run.</p>`}
      </section>
      <section class="panel"><h3>Evals</h3>${s.lastEval ? `<p class="small"><strong>${s.lastEval.passed} of ${s.lastEval.cases}</strong> golden cases passed on ${esc(localTime(s.lastEval.at))}.</p>` : `<p class="muted small">No eval cases have run for this agent. See <code>eval/agents/</code> and <code>npm run eval:agents</code>.</p>`}</section>
    </div>
    <section class="panel"><h3>Recent runs</h3>${s.recent.length ? `<div class="table-scroll"><table class="mini-table"><caption class="sr-only">Recent runs, newest first</caption>
      <thead><tr><th scope="col" class="left">When</th><th scope="col" class="left">Status</th><th scope="col" class="left">Ticker</th><th scope="col" class="num">Time</th><th scope="col" class="num">Cost</th><th scope="col" class="left">Trace</th></tr></thead>
      <tbody>${s.recent.map((r) => `<tr><td class="left small">${esc(localTime(r.createdAt))}</td><td class="left"><span class="badge ${STATUS[r.status] || ""}">${esc(r.status)}</span>${r.error ? ` <span class="muted small">${esc(r.error.slice(0, 80))}</span>` : ""}</td>
        <td class="left">${r.symbol ? esc(r.symbol) : "—"}</td><td class="num">${dur(r.latencyMs)}</td><td class="num">${money(r.costUsd)}</td><td class="left"><a href="#/agents/runs/${r.id}">Run #${r.id}</a></td></tr>`).join("")}</tbody></table></div>`
      : `<p class="muted small">No runs you can see in this window. Members' own questions stay private to them.</p>`}</section>
  </div>`;
}
