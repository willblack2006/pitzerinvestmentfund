// Fund AI spend (plan WS8, admins): this month's AI cost by agent, member, model tier and day,
// the projection to month end at the last week's pace, the most expensive runs, and a red banner
// at 80% of the cap. Route #/ai-spend.
import { esc, api, can, currentMember, pageHead, lockedHint, skeleton, errorState } from "../shared.js";
import { localTime } from "../ai.js";
import { money } from "./agents/trace.js";
import { miniBars, shortDay } from "./agents/miniBars.js";
import { ensureCss } from "./agents/cssLoader.js";

export const title = "AI spend";

const TIER = { cheap: "Cheap tier", mid: "Mid tier", top: "Top tier", other: "Other models", none: "No model call" };
const pct = (v) => `${Math.round((v || 0) * 100)}%`;

async function labeler() {
  try { const { workflowLabel } = await import("./agents.js"); return workflowLabel; } catch { return (w) => w; }
}

function shareTable(caption, rows, name, link = null) {
  if (!rows.length) return `<p class="muted small">Nothing yet this month.</p>`;
  return `<div class="table-scroll"><table class="mini-table spend-table"><caption class="sr-only">${esc(caption)}</caption>
    <thead><tr><th scope="col" class="left">${esc(caption)}</th><th scope="col" class="num">Runs</th><th scope="col" class="num">Cost</th><th scope="col" class="left">Share</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><th scope="row" class="left">${link ? `<a href="${link(r)}">${esc(name(r))}</a>` : esc(name(r))}</th><td class="num">${r.runs}</td><td class="num">${money(r.costUsd)}</td>
      <td class="left"><span class="share-bar" aria-hidden="true"><span style="width:${Math.max(1, r.share * 100).toFixed(1)}%"></span></span> <span class="small">${pct(r.share)}</span></td></tr>`).join("")}</tbody></table></div>`;
}

function banner(s) {
  if (s.level === "over") return `<p class="spend-banner is-bad" role="alert"><strong>The monthly AI budget is used up.</strong> Agents and Ask PIF are refusing new runs until the month ends or the cap is raised in <a href="#/settings">Settings</a>.</p>`;
  if (s.level === "warn") return `<p class="spend-banner is-bad" role="alert"><strong>${pct(s.pct)} of the monthly AI budget is used.</strong> At this pace the month ends near ${money(s.projectedUsd)} against a ${money(s.capUsd)} cap. Raise it in <a href="#/settings">Settings</a> or pause the costliest agents.</p>`;
  if (s.level === "pace") return `<p class="spend-banner is-warn"><strong>On pace to pass the cap.</strong> ${money(s.spentUsd)} so far; at the last week's rate the month ends near ${money(s.projectedUsd)} against ${money(s.capUsd)}.</p>`;
  return "";
}

export async function mount(container) {
  ensureCss("/css/trace.css");
  if (!can("ai") || !currentMember()?.isAdmin) {
    container.innerHTML = pageHead("AI spend") + `<div class="toolbar">${lockedHint("Only admins can see the fund's AI spend.", "ai")}</div>`;
    return;
  }
  container.innerHTML = pageHead("AI spend") + `<div class="page-pad">${skeleton("text", { rows: 8 })}</div>`;
  let s;
  try { s = await api("/api/admin/ai-spend"); }
  catch (err) { container.querySelector(".page-pad").innerHTML = errorState({ title: "Couldn't load AI spend.", detail: err.message }); return; }
  const wl = await labeler();
  const monthName = new Date(`${s.month}-15T00:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const agentName = (r) => (String(r.key).startsWith("w") ? wl(r.name) : r.name);
  const p = Math.min(100, s.pct * 100), proj = Math.min(100, (s.projectedPct || 0) * 100);
  const chart = miniBars(s.byDay.map((d) => ({ label: d.day, short: shortDay(d.day), value: d.costUsd, extra: `${d.runs} run${d.runs === 1 ? "" : "s"}, ${money(d.cumulativeUsd)} so far` })),
    { label: `AI spend per day in ${monthName}`, format: money, height: 120 });
  container.innerHTML = pageHead("AI spend", `Every OpenAI call the app made in ${esc(monthName)} (UTC days), from agents, Ask PIF and the older AI features.`, `<a class="btn btn-ghost btn-sm" href="#/settings">Change the cap</a>`)
    + `<div class="page-pad trace-page">
    ${banner(s)}
    <div class="trace-tiles">
      <div class="trace-tile"><span class="muted small">Spent this month</span><strong>${money(s.spentUsd)}</strong><span class="muted small">${pct(s.pct)} of ${money(s.capUsd)}</span></div>
      <div class="trace-tile"><span class="muted small">Month end at this pace</span><strong>${money(s.projectedUsd)}</strong><span class="muted small">${money(s.dailyRateUsd)} a day over the last week</span></div>
      <div class="trace-tile"><span class="muted small">Left</span><strong>${money(s.remainingUsd)}</strong><span class="muted small">${Math.ceil(s.daysLeft)} day${Math.ceil(s.daysLeft) === 1 ? "" : "s"} to go</span></div>
      <div class="trace-tile"><span class="muted small">Runs</span><strong>${s.runs.toLocaleString()}</strong><span class="muted small">${s.refused ? `${s.refused} refused for budget` : "none refused"}</span></div>
    </div>
    <section class="panel"><h3>Budget</h3>
      <div class="spend-meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p.toFixed(0)}" aria-label="Monthly AI budget used">
        <span class="spend-used ${s.level === "over" || s.level === "warn" ? "is-bad" : ""}" style="width:${p.toFixed(1)}%"></span>
        ${proj > p ? `<span class="spend-proj" style="left:${p.toFixed(1)}%;width:${(proj - p).toFixed(1)}%"></span>` : ""}
        <span class="spend-warn-mark" style="left:80%" title="80% of the cap"></span>
      </div>
      <p class="muted small">Solid: spent. Hatched: projected by month end. The mark is 80%, where admins get an alert. Each member can also spend up to ${money(s.memberDailyCapUsd)} a day on their own questions.</p>
    </section>
    <section class="panel"><h3>Spend per day</h3>${chart}</section>
    <div class="stats-grid">
      <section class="panel"><h3>By agent</h3>${shareTable("Agent", s.byAgent, agentName, (r) => `#/agents/stats/${encodeURIComponent(r.key)}`)}</section>
      <section class="panel"><h3>By member</h3>${shareTable("Member", s.byMember, (r) => r.name)}<p class="muted small">Scheduled agents run without a member; their cost comes from the fund's cap only.</p></section>
    </div>
    <div class="stats-grid">
      <section class="panel"><h3>By model tier</h3>${shareTable("Tier", s.byTier, (r) => TIER[r.key] || r.key)}</section>
      <section class="panel"><h3>Most expensive runs</h3>${s.top.length ? `<ol class="spend-top">${s.top.map((r) => `<li><a href="#/agents/runs/${r.id}">${esc(wl(r.workflow))}${r.symbol ? ` · ${esc(r.symbol)}` : ""}</a> <strong>${money(r.costUsd)}</strong><span class="muted small">${esc(localTime(r.createdAt))}${r.member ? ` · ${esc(r.member)}` : ""} · ${esc(r.model || "")}</span></li>`).join("")}</ol>` : `<p class="muted small">No runs yet this month.</p>`}</section>
    </div>
  </div>`;
}
