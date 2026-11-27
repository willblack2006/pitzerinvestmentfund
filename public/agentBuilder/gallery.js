// Agent gallery: templates to start from, and every agent the team has made, as cards with a
// plain-English line of what each does. "Use template", "Duplicate", "Follow", "Run now".
import { esc, icon, toast, currentMember, emptyState, errorState, bindRetry, skeleton } from "../shared.js";
import * as M from "./specModel.js";
import * as A from "./api.js";
import { avatar, statusDot, ensureCss, engineMissing, relTime } from "./ui.js";

const FILTERS = [["all", "All"], ["templates", "Templates"], ["team", "Team"], ["mine", "Mine"], ["following", "Following"]];
const parse = (s) => (typeof s === "string" ? JSON.parse(s || "{}") : s || {});

function costBadge(spec) {
  const e = M.estimate(spec);
  return e.aiFree ? `<span class="badge badge-owned">Free: no AI</span>` : `<span class="badge" title="Rough estimate for the whole fund's holdings">≈ ${M.usd(e.perMonthUsd)}/mo</span>`;
}

export function templateCard(t) {
  const spec = M.normalize(t.spec);
  return `<li class="ab-card ab-card-template">
    <div class="ab-card-head">${avatar(t, 20)}<div><h3>${esc(t.name)}</h3><p class="muted small">Template${t.category === "rule" || M.estimate(spec).aiFree ? " · rule-only" : ""}</p></div>${costBadge(spec)}</div>
    ${t.description ? `<p class="ab-card-desc">${esc(t.description)}</p>` : ""}
    <p class="ab-card-sum small">${esc(M.describe(spec))}</p>
    <div class="ab-card-actions"><a class="btn btn-primary btn-sm" href="#/agents/new/${encodeURIComponent(t.slug)}">Use template</a></div>
  </li>`;
}

export function agentCard(a, me) {
  const spec = M.normalize(parse(a.spec));
  const mine = a.ownerId === me?.id;
  return `<li class="ab-card" data-agent="${esc(a.id)}">
    <div class="ab-card-head">${avatar(a, 20)}<div><h3><a href="#/agents/${encodeURIComponent(a.slug)}/edit">${esc(a.name)}</a></h3>
      <p class="muted small">${statusDot(a.status)} · ${a.kind === "builtin" ? "Built in" : mine ? "Yours" : esc(a.ownerName || "Team")}${a.visibility === "private" ? ` · ${icon("lock", { size: 12 })} only you` : ""}</p></div>${costBadge(spec)}</div>
    ${a.description ? `<p class="ab-card-desc">${esc(a.description)}</p>` : ""}
    ${a.kind === "builtin" ? "" : `<p class="ab-card-sum small">${esc(M.describe(spec))}</p>`}
    <p class="muted small ab-card-meta">${a.lastRunAt ? `Last ran ${esc(relTime(a.lastRunAt))}` : "Hasn't run yet"}${a.nextRunAt ? ` · next ${esc(relTime(a.nextRunAt))}` : ""}${a.followers ? ` · ${a.followers} follower${a.followers === 1 ? "" : "s"}` : ""}</p>
    <div class="ab-card-actions">
      <button type="button" class="btn btn-ghost btn-sm" data-follow="${esc(a.id)}" aria-pressed="${!!a.following}">${icon(a.following ? "star-filled" : "star", { size: 14 })} ${a.following ? "Following" : "Follow"}</button>
      ${a.kind === "builtin" ? "" : `<button type="button" class="btn btn-ghost btn-sm" data-fork="${esc(a.id)}">Duplicate</button>`}
      ${a.status === "active" ? `<button type="button" class="btn btn-ghost btn-sm" data-run="${esc(a.id)}">Run now</button>` : ""}
      ${mine && a.kind !== "builtin" ? `<a class="btn btn-ghost btn-sm" href="#/agents/${encodeURIComponent(a.slug)}/edit">Edit</a>` : ""}
    </div>
  </li>`;
}

export async function mountGallery(root, { filter = "all" } = {}) {
  ensureCss();
  const me = currentMember();
  let state = { filter, q: "", templates: [], agents: [], engine: true };
  root.innerHTML = skeleton("cards", { rows: 6 });
  const load = async () => {
    const [t, a] = await Promise.allSettled([A.templates(), A.listAgents()]);
    if (t.status === "rejected" && a.status === "rejected") {
      if (A.isMissing(a.reason)) { state.engine = false; return draw(); }
      root.innerHTML = errorState({ title: "Couldn't load the agents.", detail: a.reason.message, retryId: "gallery" });
      bindRetry(root, "gallery", load);
      return;
    }
    state.templates = t.status === "fulfilled" ? t.value : [];
    state.agents = a.status === "fulfilled" ? a.value : [];
    draw();
  };
  const match = (x) => !state.q || `${x.name} ${x.description || ""}`.toLowerCase().includes(state.q);
  const draw = () => {
    const f = state.filter;
    const agents = state.agents.filter(match).filter((a) => a.status !== "archived")
      .filter((a) => f === "all" || f === "team" ? true : f === "mine" ? a.ownerId === me?.id : f === "following" ? a.following : false);
    const tpls = f === "all" || f === "templates" ? state.templates.filter(match) : [];
    const mine = agents.filter((a) => a.ownerId === me?.id), others = agents.filter((a) => a.ownerId !== me?.id);
    const list = (xs, card) => `<ul class="ab-cards">${xs.map(card).join("")}</ul>`;
    root.innerHTML = `${state.engine ? "" : engineMissing("The gallery and saved agents")}
      <div class="ab-gal-bar">
        <div class="seg seg-sm" role="group" aria-label="Show">${FILTERS.map(([k, l]) => `<button type="button" class="seg-btn" data-filter="${k}" aria-pressed="${k === f}">${l}</button>`).join("")}</div>
        <label class="ab-search"><span class="sr-only">Search agents</span>${icon("search", { size: 16 })}<input type="search" placeholder="Search agents" value="${esc(state.q)}" data-q></label>
        <a class="btn btn-primary btn-sm" href="#/agents/new">${icon("plus", { size: 16 })} Create agent</a>
      </div>
      ${f === "all" && !state.q ? `<a class="panel ab-create" href="#/agents/new"><span class="ab-create-icon">${icon("agent", { size: 22 })}</span><span><strong>Describe an agent in words</strong><span class="muted small">"Tell me when any holding's estimates get cut twice in a month and check it against our thesis"</span></span>${icon("arrow-up", { size: 16 })}</a>` : ""}
      ${tpls.length ? `<h3 class="ab-gal-h">Start from a template</h3>${list(tpls, templateCard)}` : ""}
      ${f !== "templates" && mine.length ? `<h3 class="ab-gal-h">${f === "mine" ? "Your agents" : "Yours"}</h3>${list(mine, (a) => agentCard(a, me))}` : ""}
      ${f !== "templates" && f !== "mine" && others.length ? `<h3 class="ab-gal-h">${f === "following" ? "Following" : "The team's agents"}</h3>${list(others, (a) => agentCard(a, me))}` : ""}
      ${!tpls.length && !agents.length ? emptyState({ icon: "sparkle", title: state.q ? "No agents match that." : f === "following" ? "You aren't following any agents yet." : f === "mine" ? "You haven't made an agent yet." : "No agents yet.", body: f === "following" ? "Follow an agent to get its results in your inbox." : "Start from a template or describe one in words.", action: { label: "Create agent", href: "#/agents/new" } }) : ""}`;
  };
  root.addEventListener("click", async (e) => {
    const fb = e.target.closest("[data-filter]");
    if (fb) { state.filter = fb.dataset.filter; return draw(); }
    const b = e.target.closest("[data-follow], [data-fork], [data-run]");
    if (!b) return;
    const a = state.agents.find((x) => String(x.id) === (b.dataset.follow || b.dataset.fork || b.dataset.run));
    if (!a) return;
    b.disabled = true;
    try {
      if (b.dataset.follow) {
        await A.follow(a.id, !a.following);
        a.following = !a.following; a.followers = Math.max(0, (a.followers || 0) + (a.following ? 1 : -1));
        toast(a.following ? `Following ${a.name}. Its results come to your inbox.` : `Stopped following ${a.name}.`, { type: "success" });
        draw();
      } else if (b.dataset.fork) {
        const c = await A.fork(a.id);
        toast("Duplicated. The copy is yours to change.", { type: "success" });
        location.hash = `#/agents/${encodeURIComponent(c.slug || c.id)}/edit`;
      } else {
        const r = await A.runNow(a.id);
        toast(`${a.name} is running.`, { type: "success", action: r?.runId ? { label: "Open run", onClick: () => { location.hash = `#/agents/runs/${r.runId}`; } } : undefined });
        b.disabled = false;
      }
    } catch (err) { b.disabled = false; toast(err.message, { type: "error" }); }
  });
  let qt;
  root.addEventListener("input", (e) => {
    if (!e.target.matches("[data-q]")) return;
    clearTimeout(qt);
    qt = setTimeout(() => {
      state.q = e.target.value.trim().toLowerCase();
      const pos = e.target.selectionStart;
      draw();
      const q = root.querySelector("[data-q]");
      q.focus(); q.setSelectionRange(pos, pos);
    }, 150);
  });
  await load();
}
