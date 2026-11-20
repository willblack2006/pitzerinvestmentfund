// Agents → Home (WS11): what needs you, what is running right now (live), your agents and the
// ones you follow, the latest from the team feed, and your recent Ask conversations.
import { esc, api, icon } from "../../shared.js";
import { agentChip } from "../../ui/agentChip.js";
import { schedulePill } from "../../ui/schedulePill.js";
import { runCard, watchRun, ago } from "../../ui/runCard.js";
import { feedItem } from "../../ui/feedItem.js";
import { workflowLabel } from "../agents.js";

const section = (id, title, action, body) => `<section class="hub-section" aria-labelledby="${id}"><div class="hub-section-head"><h3 id="${id}">${title}</h3>${action || ""}</div>${body}</section>`;

function agentCard(a) {
  return `<li class="hub-agent">${agentChip(a, { meta: a.kind === "builtin" ? "Built-in" : a.ownerName ? `by ${a.ownerName}` : "" })}
    <div class="hub-agent-meta">${schedulePill(a.triggers)}${a.lastRunAt ? `<span class="small muted">Last ran ${esc(ago(a.lastRunAt))}</span>` : `<span class="small muted">Hasn't run yet</span>`}</div>
    ${a.description ? `<p class="small muted hub-agent-desc">${esc(a.description.length > 110 ? `${a.description.slice(0, 107)}…` : a.description)}</p>` : ""}
    <div class="hub-agent-actions"><button type="button" class="btn-link small" data-ask-agent-open="${esc(a.slug)}">${icon("chat", { size: 12 })} Ask</button></div></li>`;
}

function needsYou(n) {
  const items = [];
  if (n.pendingProposals) items.push(`<li class="hub-need is-approval"><span class="hub-need-icon" aria-hidden="true">${icon("check-circle", { size: 16 })}</span><a href="#/agents/approvals"><strong>${n.pendingProposals} change${n.pendingProposals === 1 ? "" : "s"} waiting for approval</strong><span class="small muted">${esc(n.proposals.slice(0, 2).map((p) => p.title).join(" · "))}</span></a></li>`);
  for (const u of n.unread) items.push(`<li class="hub-need"><span class="hub-need-icon" aria-hidden="true">${icon(u.type === "mention" ? "at" : u.type === "tripwire" ? "flag" : "sparkle", { size: 16 })}</span><a href="${esc(/^#\//.test(u.link || "") ? u.link : "#/inbox")}" data-note="${u.id}"><strong>${esc(u.title)}</strong><span class="small muted">${u.body ? `${esc(u.body.slice(0, 120))} · ` : ""}${esc(ago(u.createdAt))}</span></a></li>`);
  return items.length ? `<ul class="hub-needs">${items.join("")}</ul>` : `<p class="hub-clear muted small">${icon("check", { size: 14 })} You're all caught up.</p>`;
}

export default {
  key: "home", label: "Home", order: 0,
  async render(el) {
    const h = await api("/api/agents-hub/home");
    const running = h.running.map((r) => ({ ...r, label: workflowLabel(r.workflow), steps: [] }));
    const createBtn = `<a class="btn btn-primary btn-sm" href="#/agents/new">${icon("plus", { size: 14 })} Create agent</a>`;
    const yours = h.myAgents.length ? `<ul class="hub-agents">${h.myAgents.map(agentCard).join("")}</ul>`
      : `<div class="hub-empty"><p class="small muted">You haven't made an agent yet. An agent watches something for you on a schedule or when something happens, and posts what it finds.</p>${createBtn}</div>`;
    const followed = h.followed.length ? `<ul class="hub-agents">${h.followed.map(agentCard).join("")}</ul>`
      : h.teamAgents.length ? `<p class="small muted">Follow a teammate's agent to hear when it finds something.</p><ul class="hub-agents">${h.teamAgents.map(agentCard).join("")}</ul>`
      : `<p class="small muted">Agents you follow show up here.</p>`;
    const feed = h.feed.length ? `<div class="hub-feed">${h.feed.map((f) => feedItem(f, { compact: true, actions: false })).join("")}</div>`
      : `<p class="small muted">Nothing on the team feed yet. Agent briefs, shared answers and trades will show up here.</p>`;
    const convos = h.threads.length ? `<ul class="hub-threads">${h.threads.map((t) => `<li><a href="#/agents/ask?thread=${t.id}">${t.agentSlug ? `<span class="ask-to">@${esc(t.agentSlug)}</span> ` : ""}${esc(t.title)}</a><span class="small muted">${esc(ago(t.updatedAt))}${t.visibility === "team" ? " · shared" : ""}</span></li>`).join("")}</ul>`
      : `<p class="small muted">Ask PIF anything about the fund or a ticker. <button type="button" class="btn-link small" data-ask-open>Start a conversation</button></p>`;
    el.innerHTML = `<div class="hub">
      <div class="hub-main">
        ${section("hubNeeds", `${icon("bell", { size: 16 })} Needs you`, "", needsYou(h.needsYou))}
        ${section("hubRunning", `<span class="hub-live-dot${running.length ? " is-on" : ""}" aria-hidden="true"></span> Running now`, "", running.length ? `<div class="hub-running" id="hubRunningList">${running.map((r) => runCard(r, { compact: true, member: r.memberName })).join("")}</div>` : `<p class="small muted">No agent is working right now. Runs appear here live while they work.</p>`)}
        ${section("hubFeed", `${icon("megaphone", { size: 16 })} Latest from the team`, `<a class="small" href="#/feed">Open feed →</a>`, feed)}
      </div>
      <div class="hub-side">
        ${section("hubMine", "Your agents", h.myAgents.length ? createBtn : "", yours)}
        ${section("hubFollowed", h.followed.length ? "Agents you follow" : "Team agents", "", followed)}
        ${section("hubConvos", "Recent conversations", `<a class="small" href="#/agents/ask">All →</a>`, convos)}
      </div>
    </div>`;
    // Running runs update live; when one finishes, its card settles into its summary.
    for (const r of running) {
      const node = () => el.querySelector(`[data-run-card="${r.id}"]`);
      const repaint = () => { const n = node(); if (n) n.outerHTML = runCard(r, { compact: true, member: r.memberName }); };
      watchRun(r.id, {
        onStep: (s, steps) => { r.steps = steps; repaint(); },
        onText: (text) => { r.text = text; repaint(); },
        onDone: (out, ev) => { Object.assign(r, { status: "done", text: "", summary: out?.answer || out?.headline || out?.summary || out?.title || "Finished.", costUsd: ev?.costUsd ?? r.costUsd }); repaint(); },
        onError: (msg, ev) => { Object.assign(r, { status: ev?.status || "failed", error: msg }); repaint(); },
      });
    }
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-ask-agent-open]");
      if (!b) return;
      import("../../ai.js").then(({ openAsk }) => openAsk({ question: `@${b.dataset.askAgentOpen} ` }));
    });
    el.addEventListener("click", (e) => {
      const a = e.target.closest("[data-note]");
      if (a) import("../../inbox.js").then(({ markRead }) => markRead(Number(a.dataset.note))).catch(() => {});
    });
  },
};
