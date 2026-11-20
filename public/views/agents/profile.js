// #/agents/a/:slug: an agent's profile (WS7). Who owns it, what it watches and when, who follows
// it, what it did lately and what it cost, the memory it wrote and its version history. Follow,
// Run now, Ask, Duplicate; the owner can Edit/Pause, admins can Suspend. Editing, running and
// forking are WS2's /api/platform/agents endpoints.
import { esc, api, can, icon, toast, pageHead, lockedHint, skeleton, errorState, emptyState, fmtUSD, currentMember, confirmAction } from "../../shared.js";
import { mountFeed, ago } from "../../feed/feedUi.js";

export const title = (p = {}) => `Agent ${p.slug || ""}`.trim();

const money = (v) => (v == null ? "—" : v > 0 && v < 0.01 ? `$${v.toFixed(4)}` : fmtUSD(v));
const pct = (v) => (v == null ? "No ratings yet" : `${Math.round(v * 100)}% useful`);
const STATUS = { active: ["badge-owned", "Active"], paused: ["badge-warn", "Paused"], suspended: ["badge-danger", "Suspended"], archived: ["", "Archived"] };
const RUN_STATUS = { done: "badge-owned", failed: "badge-danger", refused: "badge-warn", running: "badge-watch" };
const LEVELS = [["inbox", "Important posts right away, the rest in the evening digest"], ["all", "Every post"], ["digest", "Evening digest only"], ["off", "Don't notify me"]];
const hue = (s) => { let h = 0; for (const c of String(s || "")) h = (h * 31 + c.charCodeAt(0)) % 8; return h; };

export function followButton(a) {
  return a.following
    ? `<button type="button" class="btn btn-ghost btn-sm" data-follow="${esc(a.slug)}" data-following="1" aria-pressed="true">${icon("check", { size: 14 })} Following</button>`
    : `<button type="button" class="btn btn-sm btn-primary" data-follow="${esc(a.slug)}" aria-pressed="false">${icon("plus", { size: 14 })} Follow</button>`;
}

export function agentCard(a) {
  const s = a.stats || {};
  return `<article class="panel feed-agent-card" data-agent-card="${esc(a.slug)}">
    <header class="feed-agent-card-head">
      <span class="feed-avatar is-agent feed-tone-${hue(a.slug)}" aria-hidden="true">${icon("sparkle", { size: 16 })}</span>
      <div><h3><a href="#/agents/a/${encodeURIComponent(a.slug)}">${esc(a.name)}</a></h3>
        <p class="small muted">${a.kind === "builtin" ? "Built in" : a.owner ? `By ${esc(a.owner.name)}` : "Team"}${a.visibility === "private" ? " · Private" : ""}${a.status !== "active" ? ` · <span class="badge ${STATUS[a.status]?.[0] || ""}">${esc(STATUS[a.status]?.[1] || a.status)}</span>` : ""}</p></div>
    </header>
    ${a.description ? `<p class="feed-agent-desc">${esc(a.description)}</p>` : ""}
    ${a.triggers?.length ? `<p class="small muted">${a.triggers.map(esc).join(" · ")}</p>` : ""}
    <p class="feed-agent-stats small"><span>${a.followers} follower${a.followers === 1 ? "" : "s"}</span><span>${s.runs30d ?? 0} run${s.runs30d === 1 ? "" : "s"} in 30 days</span><span>${esc(pct(s.acceptance))}</span></p>
    <footer>${followButton(a)}</footer>
  </article>`;
}

// One delegated handler for Follow buttons anywhere in `root`. Following asks nothing; the
// notify level can be changed on the profile.
export function bindFollow(root, onChange) {
  root.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-follow]");
    if (!b) return;
    b.disabled = true;
    const slug = b.dataset.follow, following = b.dataset.following === "1";
    try {
      const r = await api(`/api/agents/a/${encodeURIComponent(slug)}/follow`, { method: following ? "DELETE" : "PUT", body: following ? undefined : JSON.stringify({ notify: "inbox" }) });
      b.outerHTML = followButton({ slug, following: r.following });
      toast(r.following ? "Following. Important posts reach your inbox; the rest go in the evening digest." : "Unfollowed.");
      onChange?.(r);
    } catch (err) { b.disabled = false; toast(err.message, { type: "error" }); }
  });
}

// WS2's engine API. A missing endpoint (engine not merged yet) gives a plain message.
async function engine(path, opts) {
  try { return await api(`/api/platform/agents/${path}`, opts); } catch (err) {
    if (/No such API endpoint/.test(err.message)) throw new Error("That needs the agent engine, which isn't on this server yet.");
    throw err;
  }
}

function factsHtml(p) {
  const a = p.agent, s = p.stats;
  return `<dl class="panel agent-facts feed-profile-facts">
    <dt>Owner</dt><dd>${a.kind === "builtin" ? "Built in (the fund)" : a.owner ? `<a href="#/members/${a.owner.id}">${esc(a.owner.name)}</a>` : "—"}</dd>
    <dt>Watches</dt><dd>${esc(a.scope)}</dd>
    <dt>Runs</dt><dd>${a.triggers.length ? a.triggers.map(esc).join("<br>") : a.kind === "builtin" ? "When its event happens (filings, earnings, pitches…) or on request" : "Only when someone runs it"}${a.nextRunAt ? `<br><span class="small muted">Next: ${esc(ago(a.nextRunAt))}</span>` : ""}</dd>
    <dt>Posts to</dt><dd>${a.outputs?.length ? a.outputs.map(esc).join(", ") : "The team feed"}</dd>
    <dt>Last 30 days</dt><dd>${s.runs30d} run${s.runs30d === 1 ? "" : "s"}${s.failed30d ? `, ${s.failed30d} failed` : ""}${s.lastRunAt ? ` · last ${esc(ago(s.lastRunAt))}` : ""}</dd>
    <dt>Usefulness</dt><dd>${esc(pct(s.acceptance))}${s.feedback.useful + s.feedback.wrong + s.feedback.notUseful ? ` <span class="small muted">(${s.feedback.useful} useful, ${s.feedback.notUseful} not useful, ${s.feedback.wrong} wrong)</span>` : ""}</dd>
    <dt>Cost this month</dt><dd>${money(s.costMonthUsd)}${a.budget?.perMonthUsd ? ` of ${money(a.budget.perMonthUsd)} budget` : ""}</dd>
    <dt>Version</dt><dd>v${a.version}${a.forkedFrom ? " · copied from another agent" : ""}</dd>
  </dl>`;
}

function actionsHtml(p) {
  const a = p.agent, c = p.can;
  const b = (attr, label, cls = "btn-ghost", ic = "") => `<button type="button" class="btn btn-sm ${cls}" ${attr}>${ic ? icon(ic, { size: 14 }) : ""}${label}</button>`;
  return `<div class="feed-profile-actions">
    ${followButton(a)}
    ${a.following ? `<label class="sr-only" for="followLevel">Notify me about</label><select id="followLevel" class="feed-level">${LEVELS.map(([k, l]) => `<option value="${k}" ${a.notify === k ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>` : ""}
    ${c.run ? b("data-run-now", " Run now", "btn-ghost", "sparkle") : ""}
    ${can("ai") ? b("data-ask-agent", " Ask", "btn-ghost", "chat") : ""}
    ${c.duplicate ? b("data-duplicate", " Duplicate") : ""}
    ${c.edit && a.kind === "custom" ? `<a class="btn btn-ghost btn-sm" href="#/agents/${encodeURIComponent(a.slug)}/edit">${icon("pencil", { size: 14 })} Edit</a>` : ""}
    ${c.pause && a.status === "active" ? b("data-pause", "Pause") : ""}
    ${c.pause && a.status === "paused" ? b("data-resume", "Resume") : ""}
    ${c.suspend && a.status !== "suspended" ? b("data-suspend", "Suspend", "btn-ghost feed-danger") : ""}
    ${c.suspend && a.status === "suspended" ? b("data-resume", "Lift suspension") : ""}
  </div>`;
}

function runsHtml(runs) {
  if (!runs.length) return `<p class="muted small">No runs yet.</p>`;
  return `<ol class="feed-runs">${runs.map((r) => `<li><a href="#/agents/runs/${r.id}"><span class="badge ${RUN_STATUS[r.status] || ""}">${esc(r.status)}</span>
    ${r.symbol ? `<strong>${esc(r.symbol)}</strong>` : ""} <span class="muted small">${esc(r.trigger || "")}${r.byName ? ` · by ${esc(r.byName)}` : ""}</span>
    ${r.summary ? `<span class="feed-run-summary">${esc(String(r.summary).slice(0, 140))}</span>` : ""}
    <span class="muted small feed-run-meta">${esc(ago(r.createdAt))} · ${money(r.costUsd)}</span></a></li>`).join("")}</ol>`;
}

function memoryHtml(memory) {
  if (!memory.length) return `<p class="muted small">This agent hasn't written anything to the team's memory yet.</p>`;
  return `<ul class="feed-memory">${memory.map((m) => `<li><span class="badge">${esc(m.kind)}</span>${m.scopeKey ? ` <strong>${esc(m.scopeKey)}</strong>` : ""} ${esc(m.text)}
    <span class="muted small">${esc(ago(m.createdAt))}${m.status === "proposed" ? " · waiting for approval" : ""}${m.sourceRunId ? ` · <a href="#/agents/runs/${m.sourceRunId}">from run</a>` : ""}</span></li>`).join("")}</ul>`;
}

function versionsHtml(v) {
  if (!v.length) return `<p class="muted small">Only the first version so far.</p>`;
  return `<ol class="feed-versions">${v.map((x) => `<li><strong>v${x.version}</strong> <span class="muted small">${esc(ago(x.createdAt))}${x.editedByName ? ` by ${esc(x.editedByName)}` : ""}</span>${x.note ? ` · ${esc(x.note)}` : ""}</li>`).join("")}</ol>`;
}

export async function mount(container, params = {}) {
  if (!can("member")) { container.innerHTML = pageHead("Agent") + `<div class="toolbar">${lockedHint("Sign in to see the team's agents.")}</div>`; return; }
  const slug = String(params.slug || "");
  container.innerHTML = pageHead("Agent") + `<div class="page-pad">${skeleton("text", { rows: 6 })}</div>`;
  let p;
  try { p = await api(`/api/agents/a/${encodeURIComponent(slug)}`); } catch (err) {
    container.innerHTML = pageHead("Agent") + `<div class="page-pad">${errorState({ title: "No such agent.", detail: "It may be private or archived." })}<p><a href="#/agents/directory">All team agents</a></p></div>`; return;
  }
  const a = p.agent;
  document.title = `${a.name} · Pitzer Investment Fund`;
  const st = STATUS[a.status] || ["", a.status];
  container.innerHTML = pageHead(`${esc(a.name)} <span class="badge ${st[0]}">${esc(st[1])}</span>`,
    `${esc(a.description || "")} <span class="muted">@${esc(a.slug)}</span>`, "")
    + `<div class="page-pad feed-profile">
      <div class="feed-profile-top">${actionsHtml(p)}<p class="small muted feed-presence" id="profilePresence" aria-live="polite"></p></div>
      ${p.running.length ? `<p class="feed-running"><span class="feed-running-label small muted">Running now</span>${p.running.map((r) => `<a class="feed-running-chip" href="#/agents/runs/${r.id}"><span class="agent-pulse" aria-hidden="true"></span>${r.symbol ? esc(r.symbol) : "Run"}${r.by ? ` · for ${esc(r.by)}` : ""}</a>`).join("")}</p>` : ""}
      <div class="feed-profile-grid">
        <div class="feed-profile-main">
          <section><h3>Latest posts</h3><div id="profileFeed"></div></section>
          <section class="panel"><h3>Recent runs</h3>${runsHtml(p.runs)}</section>
        </div>
        <aside class="feed-profile-side">
          ${factsHtml(p)}
          <section class="panel"><h3>Followers <span class="muted small">${p.followers.length}</span></h3>
            ${p.followers.length ? `<p class="feed-followers">${p.followers.map((f) => `<a href="#/members/${f.id}">${esc(f.name)}</a>`).join(", ")}</p>` : `<p class="muted small">No one yet.</p>`}</section>
          <section class="panel"><h3>What it remembers</h3>${memoryHtml(p.memory)}</section>
          <section class="panel"><h3>Versions</h3>${versionsHtml(p.versions)}</section>
        </aside>
      </div></div>`;
  mountFeed(container.querySelector("#profileFeed"), { query: { agent: a.id, limit: 8 }, compact: true, markRead: false, emptyText: { title: "No posts yet", body: "When this agent finds something, it posts here and to the team feed." } });

  // Presence: who else has this profile open.
  const target = `agent:${a.slug}`;
  const showViewers = (viewers = []) => {
    const others = viewers.filter((v) => v.id !== currentMember()?.id);
    const el = container.querySelector("#profilePresence");
    if (el) el.textContent = others.length ? `${others.map((v) => v.name).join(", ")} ${others.length === 1 ? "is" : "are"} looking at this agent too` : "";
  };
  const beat = () => api("/api/feed/presence", { method: "POST", body: JSON.stringify({ target }) }).then((r) => showViewers(r.viewers)).catch(() => {});
  beat();
  const timer = setInterval(beat, 30e3);
  const onLive = (e) => { if (e.detail?.type === "feed.presence" && e.detail.data?.target === target) showViewers(e.detail.data.viewers); };
  window.addEventListener("pif:live", onLive);
  const leave = () => { clearInterval(timer); window.removeEventListener("pif:live", onLive); window.removeEventListener("hashchange", leave); api("/api/feed/presence", { method: "POST", body: JSON.stringify({ target, leave: true }) }).catch(() => {}); };
  window.addEventListener("hashchange", leave);

  const reload = () => mount(container, params);
  bindFollow(container.querySelector(".feed-profile-actions"), () => reload());
  container.querySelector("#followLevel")?.addEventListener("change", async (e) => {
    try { await api(`/api/agents/a/${encodeURIComponent(a.slug)}/follow`, { method: "PUT", body: JSON.stringify({ notify: e.target.value }) }); toast("Saved."); } catch (err) { toast(err.message, { type: "error" }); }
  });
  const on = (sel, fn) => container.querySelector(sel)?.addEventListener("click", async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try { await fn(); } catch (err) { toast(err.message, { type: "error" }); } finally { btn.disabled = false; }
  });
  on("[data-run-now]", async () => {
    const r = await engine(`${a.id}/run`, { method: "POST", body: JSON.stringify({}) });
    toast("Running. Its post will show up in the feed when it's done.", r?.runId ? { action: { label: "Watch", onClick: () => { location.hash = `#/agents/runs/${r.runId}`; } } } : {});
  });
  on("[data-ask-agent]", async () => {
    const { openAsk } = await import("../../ai.js");
    openAsk({ question: `@${a.slug} ` });
  });
  on("[data-duplicate]", async () => {
    const r = await engine(`${a.id}/fork`, { method: "POST", body: JSON.stringify({}) });
    const copy = r?.agent || r;
    toast("Copied. It's yours to edit.");
    if (copy?.slug) location.hash = `#/agents/${encodeURIComponent(copy.slug)}/edit`;
  });
  on("[data-pause]", async () => { await engine(`${a.id}/pause`, { method: "POST", body: JSON.stringify({}) }); reload(); });
  on("[data-resume]", async () => { await engine(`${a.id}/resume`, { method: "POST", body: JSON.stringify({}) }); reload(); });
  on("[data-suspend]", async () => {
    if (!(await confirmAction({ title: `Suspend ${a.name}?`, body: "It stops running for everyone until an admin lifts the suspension.", confirmLabel: "Suspend", danger: true }))) return;
    await engine(`${a.id}/suspend`, { method: "POST", body: JSON.stringify({}) }); reload();
  });
}

export { emptyState };
