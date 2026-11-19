// The agent builder: a step-by-step form over the agent spec (plan 3.2), so a member can set up
// an agent without writing JSON. Six numbered sections (what to watch, when, only if, what to do,
// where results go, name and budget), a live plain-English summary and cost estimate beside
// them, "describe it in words" drafting, a test panel and version history.
//
// State lives in one object; inputs carry data-bind="path.in.state" and update it in place
// (so typing never re-renders and focus stays put). Adding or removing things re-renders the form.
import { esc, icon, can, toast, currentMember, fundContext } from "../shared.js";
import { toolLabel } from "../aiFormat.js";
import * as M from "./specModel.js";
import * as A from "./api.js";
import { AGENT_ICONS, avatar, statusDot, ensureCss, engineMissing } from "./ui.js";

const FALLBACK_TOOLS = ["get_research_overview", "get_news", "get_recent_filings", "get_estimate_revisions", "get_insider_activity", "get_risk", "get_financials", "get_short_pressure"];
const DAYS = [["1-5", "Weekdays"], ["*", "Every day"], ["1", "Mondays"], ["2", "Tuesdays"], ["3", "Wednesdays"], ["4", "Thursdays"], ["5", "Fridays"]];

function getPath(obj, path) { return path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj); }
function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  o[keys[keys.length - 1]] = value;
}

// "30 8 * * 1-5" -> { days: "1-5", time: "08:30" } when the form's simple picker can show it.
function simpleCron(cron) {
  const m = String(cron || "").trim().match(/^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5|[0-6])$/);
  return m ? { days: m[3], time: `${m[2].padStart(2, "0")}:${m[1].padStart(2, "0")}` } : null;
}
const toCron = ({ days, time }) => { const [h, m] = String(time || "08:30").split(":").map(Number); return `${m || 0} ${h || 0} * * ${days || "1-5"}`; };

const opts = (list, cur, val = (x) => x.key, lab = (x) => x.label) => list.map((x) => `<option value="${esc(val(x))}"${String(val(x)) === String(cur) ? " selected" : ""}>${esc(lab(x))}</option>`).join("");
const bind = (path, kind = "str") => `data-bind="${esc(path)}" data-kind="${kind}"`;
const section = (n, title, hint, body, { optional = false } = {}) => `<section class="panel ab-section" aria-labelledby="abs${n}">
  <header class="ab-section-head"><span class="ab-num" aria-hidden="true">${n}</span><div><h3 id="abs${n}">${esc(title)}${optional ? ` <span class="muted small">optional</span>` : ""}</h3>${hint ? `<p class="muted small">${hint}</p>` : ""}</div></header>
  ${body}</section>`;

export async function mountBuilder(root, { slug = null, template = null, embedded = false } = {}) {
  ensureCss();
  const me = currentMember();
  if (!can("ai")) { root.innerHTML = `<p class="notice">Building agents needs AI access. An admin can turn it on for you in Settings.</p>`; return; }
  root.innerHTML = `<div class="ab-loading">${icon("sparkle")} Loading the builder…</div>`;

  const st = {
    agent: null, meta: { name: "", description: "", icon: "sparkle", visibility: "team" }, spec: M.defaultSpec(),
    metrics: M.FALLBACK_METRICS, catalog: null, team: [], issues: [], server: null, engine: true, draftNote: null, note: "",
    holdingsCount: 12, watchlistCount: 15,
  };
  // Everything the form needs, in parallel; anything that fails falls back quietly.
  const [cat, mets, agents, tpl, existing, ctx] = await Promise.allSettled([
    A.catalog(), A.metrics(), A.listAgents(), template ? A.templates() : null, slug ? A.getAgent(slug) : null, fundContext(),
  ]);
  if (cat.status === "fulfilled") st.catalog = cat.value;
  if (mets.status === "fulfilled" && mets.value.length) st.metrics = mets.value;
  if (agents.status === "fulfilled") st.team = agents.value; else if (A.isMissing(agents.reason)) st.engine = false;
  if (ctx.status === "fulfilled" && ctx.value) {
    st.holdingsCount = ctx.value.owned?.size || st.holdingsCount;
    st.watchlistCount = ctx.value.watched?.size || st.watchlistCount;
  }
  if (slug) {
    if (existing.status !== "fulfilled") {
      root.innerHTML = A.isMissing(existing.reason) && !st.engine ? engineMissing("Saved agents") : `<p class="error">Couldn't open that agent: ${esc(existing.reason?.message || "not found")}. <a href="#/agents/gallery">Back to the gallery</a></p>`;
      return;
    }
    const a = existing.value;
    st.agent = a;
    st.meta = { name: a.name || "", description: a.description || "", icon: a.icon || "sparkle", visibility: a.visibility || "team" };
    st.spec = M.normalize(typeof a.spec === "string" ? JSON.parse(a.spec) : a.spec);
  } else if (template && tpl.status === "fulfilled") {
    const t = (tpl.value || []).find((x) => x.slug === template);
    if (t) {
      st.spec = M.normalize(t.spec);
      st.meta = { name: t.name || "", description: t.description || "", icon: t.icon || "sparkle", visibility: "team" };
      st.draftNote = { kind: "template", text: `Started from the "${t.name}" template. Change anything, then save it as your own agent.` };
    }
  }
  const mine = !st.agent || st.agent.ownerId === me?.id || me?.isAdmin;
  const readOnly = !!st.agent && !mine;
  const agentsBySlug = Object.fromEntries(st.team.map((a) => [a.slug, a]));
  const toolGroups = st.catalog?.groups?.length ? st.catalog.groups : [{ key: "core", label: "Everyday", tools: FALLBACK_TOOLS.map((name) => ({ name, dataStep: true, perSymbol: true })) }];
  const allTools = toolGroups.flatMap((g) => g.tools);
  const metricGroups = [...new Set(st.metrics.map((m) => m.group || "Other"))];
  const metricSelect = (path, cur) => `<select ${bind(path)} aria-label="What to check"><option value="">Pick a value…</option>${metricGroups.map((g) => `<optgroup label="${esc(g.charAt(0).toUpperCase() + g.slice(1))}">${st.metrics.filter((m) => (m.group || "Other") === g).map((m) => `<option value="${esc(m.name)}"${m.name === cur ? " selected" : ""}>${esc(m.label || m.name)}</option>`).join("")}</optgroup>`).join("")}${cur && !st.metrics.some((m) => m.name === cur) ? `<option value="${esc(cur)}" selected>${esc(cur)}</option>` : ""}</select>`;

  // ---- Section bodies ----
  const scopeBody = () => {
    const s = st.spec.scope;
    return `<div class="ab-choices" role="radiogroup" aria-label="What to watch">${M.UNIVERSES.map((u) => `<label class="ab-choice"><input type="radio" name="abUniverse" value="${u.key}" ${bind("spec.scope.universe")}${s.universe === u.key ? " checked" : ""} data-rerender><span><strong>${esc(u.label)}</strong><span class="muted small">${esc(u.hint)}</span></span></label>`).join("")}</div>
      ${s.universe === "symbols" ? `<label class="field-block ab-tickers">Tickers <span class="field-hint">Separate with commas or spaces</span><input type="text" value="${esc(s.symbols.join(", "))}" ${bind("spec.scope.symbols", "list")} placeholder="NVDA, MU, ORCL" autocapitalize="characters" spellcheck="false"></label>` : ""}`;
  };

  const whenBody = () => {
    const ts = st.spec.triggers;
    const si = ts.findIndex((t) => t.type === "schedule");
    const sched = ts[si];
    const mode = !sched ? "none" : sched.cron ? "custom" : sched.preset || "none";
    const simple = sched?.cron ? simpleCron(sched.cron) : null;
    const extraSchedules = ts.filter((t) => t.type === "schedule").length - 1;
    const hi = ts.findIndex((t) => t.type === "handoff");
    return `<div class="ab-row">
        <label class="field-block">On a schedule<select data-act="schedule" aria-label="Schedule"><option value="none"${mode === "none" ? " selected" : ""}>No schedule, only on events</option>${opts(M.PRESETS, mode, (p) => p.key, (p) => `${p.label} (${p.text})`)}<option value="custom"${mode === "custom" ? " selected" : ""}>Custom time…</option></select></label>
        ${mode === "custom" ? (simple ? `<label class="field-block">Days<select data-act="cron-days">${DAYS.map(([v, l]) => `<option value="${v}"${v === simple.days ? " selected" : ""}>${l}</option>`).join("")}</select></label>
          <label class="field-block">Time (New York)<input type="time" value="${simple.time}" data-act="cron-time"></label>` : "")
          + `<details class="ab-advanced"${simple ? "" : " open"}><summary class="small">Advanced: cron</summary><label class="field-block">Cron (minute hour day month weekday)<input type="text" value="${esc(sched.cron)}" ${bind(`spec.triggers.${si}.cron`)} spellcheck="false" placeholder="30 8 * * 1-5"></label><p class="field-hint">${esc(M.describeCron(sched.cron))}</p></details>` : ""}
      </div>
      ${extraSchedules > 0 ? `<p class="muted small">Plus ${extraSchedules} more schedule${extraSchedules === 1 ? "" : "s"} set outside the form; they're kept as they are.</p>` : ""}
      <fieldset class="ab-events"><legend>And whenever…</legend>
        ${M.EVENTS.map((e) => {
          const i = ts.findIndex((t) => t.type === "event" && t.on === e.on);
          const t = ts[i];
          return `<div class="ab-event${t ? " is-on" : ""}"><label class="ab-check"><input type="checkbox" data-act="event" data-on="${e.on}"${t ? " checked" : ""}> ${esc(e.label)}</label>
            ${t && e.param ? `<label class="ab-param">${esc(e.param.label)} <input type="number" min="${e.param.min}" max="${e.param.max}" step="${e.param.step}" value="${esc(t[e.param.key] ?? e.param.def)}" ${bind(`spec.triggers.${i}.${e.param.key}`, "num")}></label>` : ""}
            ${t && e.forms ? `<span class="ab-forms">${e.forms.map((f) => `<label class="ab-check small"><input type="checkbox" data-act="form" data-i="${i}" value="${f}"${(t.forms || e.forms).includes(f) ? " checked" : ""}> ${f}</label>`).join("")}</span>` : ""}</div>`;
        }).join("")}
        <div class="ab-event${hi >= 0 ? " is-on" : ""}"><label class="ab-check"><input type="checkbox" data-act="handoff-trigger"${hi >= 0 ? " checked" : ""}> Another agent hands off to it</label>
          ${hi >= 0 ? `<label class="ab-param">Topic <input type="text" value="${esc(ts[hi].topic || "")}" ${bind(`spec.triggers.${hi}.topic`)} placeholder="thesis" spellcheck="false"></label>` : ""}</div>
      </fieldset>
      <p class="muted small">Anyone on the team can also run it by hand.</p>`;
  };

  const condBody = () => `<ul class="ab-conds">${st.spec.conditions.map((c, i) => `<li class="ab-cond">
      ${metricSelect(`spec.conditions.${i}.metric`, c.metric)}
      <select ${bind(`spec.conditions.${i}.op`)} data-rerender aria-label="Comparison">${opts(M.OPS, c.op || "<", (o) => o.op, (o) => o.label)}</select>
      ${M.opDef(c.op).noValue ? "" : `<input type="${c.op === "in" ? "text" : "number"}" step="any" value="${esc(Array.isArray(c.value) ? c.value.join(", ") : c.value ?? "")}" ${bind(`spec.conditions.${i}.value`, c.op === "in" ? "list" : "num")} aria-label="Value" class="ab-num-input">`}
      <button type="button" class="icon-btn" data-act="cond-remove" data-i="${i}" aria-label="Remove this condition">${icon("x")}</button></li>`).join("")}</ul>
    <button type="button" class="btn btn-ghost btn-sm" data-act="cond-add">${icon("plus")} Add a condition</button>`;

  const toolOptions = (cur, { dataOnly }) => toolGroups.map((g) => {
    const tools = g.tools.filter((t) => !dataOnly || t.dataStep);
    return tools.length ? `<optgroup label="${esc(g.label)}">${tools.map((t) => `<option value="${esc(t.name)}"${t.name === cur ? " selected" : ""}>${esc(toolLabel(t.name).replace(/^the /, "").replace(/^./, (c) => c.toUpperCase()))}</option>`).join("")}</optgroup>` : "";
  }).join("");

  const aiTools = (s, i) => {
    const picked = new Set(s.tools || []);
    return `<details class="ab-tools"><summary>Tools it may use: <strong>${picked.size ? `${picked.size} picked` : "the usual set"}</strong></summary>
      <p class="field-hint">Fewer tools make it cheaper and more focused. Leave all unticked to let the app pick by the instructions.</p>
      ${toolGroups.map((g) => `<fieldset class="ab-toolgroup"><legend>${esc(g.label)} <button type="button" class="btn-link small" data-act="tools-group" data-i="${i}" data-group="${esc(g.key)}">${g.tools.every((t) => picked.has(t.name)) ? "none" : "all"}</button></legend>
        ${g.tools.map((t) => `<label class="ab-check small" title="${esc(t.description || "")}"><input type="checkbox" data-act="tool" data-i="${i}" value="${esc(t.name)}"${picked.has(t.name) ? " checked" : ""}> ${esc(toolLabel(t.name))}</label>`).join("")}</fieldset>`).join("")}
    </details>`;
  };

  const stepBody = (s, i) => {
    if (s.type === "tool") return `<label class="field-block">Read<select ${bind(`spec.steps.${i}.tool`)} data-rerender><option value="">Pick data…</option>${toolOptions(s.tool, { dataOnly: true })}</select></label>
      <p class="field-hint">${st.spec.scope.universe === "fund" ? "Runs once for the fund." : "Runs for each stock in scope."} Free: no AI.</p>`;
    if (s.type === "rule") return `<div class="ab-cond">${metricSelect(`spec.steps.${i}.if.metric`, s.if?.metric)}
        <select ${bind(`spec.steps.${i}.if.op`)} data-rerender aria-label="Comparison">${opts(M.OPS, s.if?.op || ">", (o) => o.op, (o) => o.label)}</select>
        ${M.opDef(s.if?.op).noValue ? "" : `<input type="number" step="any" class="ab-num-input" value="${esc(s.if?.value ?? "")}" ${bind(`spec.steps.${i}.if.value`, "num")} aria-label="Value">`}</div>
      <label class="field-inline small">Otherwise <select ${bind(`spec.steps.${i}.else`)}><option value="stop"${s.else !== "continue" ? " selected" : ""}>stop here (free)</option><option value="continue"${s.else === "continue" ? " selected" : ""}>carry on anyway</option></select></label>`;
    const cost = M.aiStepCost(s);
    return `<label class="field-block">Instructions<textarea rows="3" maxlength="2000" ${bind(`spec.steps.${i}.instructions`)} placeholder="e.g. Read the latest 8-K and news. Say whether anything changes our thesis, and cite each point.">${esc(s.instructions || "")}</textarea></label>
      <div class="ab-row">
        <div class="field-block"><span id="abTier${i}">Model</span><div class="seg seg-sm" role="group" aria-labelledby="abTier${i}">${M.TIERS.map((t) => `<button type="button" class="seg-btn" data-act="tier" data-i="${i}" data-tier="${t.key}" aria-pressed="${s.tier === t.key}" title="${esc(t.hint)}">${esc(t.label)}</button>`).join("")}</div>
          <span class="field-hint">${esc(M.TIERS.find((t) => t.key === s.tier)?.hint || "")} · up to ${M.usd(cost)} a run</span></div>
        <label class="field-block">Answer as<select ${bind(`spec.steps.${i}.output`)}>${opts(M.AI_OUTPUTS, s.output || "brief")}</select></label>
        <label class="field-block ab-narrow">Tool calls<input type="number" min="1" max="12" value="${esc(s.maxSteps ?? 6)}" ${bind(`spec.steps.${i}.maxSteps`, "num")} class="ab-num-input"></label>
      </div>
      <label class="ab-check small"><input type="checkbox" ${bind(`spec.steps.${i}.recall`, "bool")}${s.recall !== false ? " checked" : ""}> Use the team's shared memory about the stock (what agents and members already found)</label>
      ${aiTools(s, i)}`;
  };
  const STEP_KIND = { tool: ["Get data", "doc"], rule: ["Rule", "sliders"], ai: ["AI step", "sparkle"] };
  const stepsBody = () => {
    const steps = st.spec.steps, aiN = steps.filter((x) => x.type === "ai").length, full = steps.length >= M.MAX_STEPS;
    return `<ol class="ab-steps">${steps.map((s, i) => `<li class="ab-step ab-step-${s.type}">
        <div class="ab-step-head"><span class="ab-step-kind">${icon(STEP_KIND[s.type]?.[1] || "doc", { size: 16 })} ${esc(STEP_KIND[s.type]?.[0] || s.type)}</span><code class="muted small" title="Later steps and rules can refer to this step by its id">${esc(s.id)}</code>
          <span class="ab-step-actions"><button type="button" class="icon-btn" data-act="step-move" data-i="${i}" data-dir="-1" aria-label="Move step ${i + 1} up"${i === 0 ? " disabled" : ""}>${icon("arrow-up", { size: 16 })}</button><button type="button" class="icon-btn" data-act="step-move" data-i="${i}" data-dir="1" aria-label="Move step ${i + 1} down"${i === steps.length - 1 ? " disabled" : ""}>${icon("arrow-down", { size: 16 })}</button><button type="button" class="icon-btn" data-act="step-remove" data-i="${i}" aria-label="Remove step ${i + 1}">${icon("trash", { size: 16 })}</button></span></div>
        ${stepBody(s, i)}</li>`).join("")}</ol>
      <div class="ab-add-row"><span class="muted small">Add</span>
        <button type="button" class="btn btn-ghost btn-sm" data-act="step-add" data-type="tool"${full ? " disabled" : ""}>${icon("doc", { size: 16 })} Get data</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="step-add" data-type="rule"${full ? " disabled" : ""}>${icon("sliders", { size: 16 })} Rule</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="step-add" data-type="ai"${full || aiN >= M.MAX_AI_STEPS ? " disabled" : ""}>${icon("sparkle", { size: 16 })} AI step</button></div>`;
  };

  const outBody = () => `<ul class="ab-outs">${M.OUTPUT_KINDS.map((k) => {
      const i = st.spec.outputs.findIndex((o) => o.type === k.type);
      const o = st.spec.outputs[i];
      const p = (f) => `spec.outputs.${i}.${f}`;
      let extra = "";
      if (o && (k.type === "feed" || k.type === "notify")) extra += `<select ${bind(p("when"))} aria-label="When">${opts(M.WHEN, o.when || "always")}</select>`;
      if (o && k.type === "notify") extra = `<select ${bind(p("who"))} aria-label="Who">${opts(M.WHO, o.who || "owner")}</select><select ${bind(p("tier"))} aria-label="How">${opts(M.NOTIFY_TIERS, o.tier || "inbox")}</select>` + extra;
      if (o && k.type === "proposal") extra = `<select ${bind(p("kind"))} aria-label="Kind of change"><option value="">Pick…</option>${opts(M.PROPOSAL_KINDS, o.kind)}</select><span class="field-hint">A member approves it before anything changes.</span>`;
      if (o && k.type === "handoff") extra = `<input type="text" value="${esc(o.topic || "")}" ${bind(p("topic"))} placeholder="Topic, e.g. thesis" aria-label="Topic" spellcheck="false"><select ${bind(p("to"))} aria-label="To agent"><option value="">Any agent on that topic</option>${st.team.filter((a) => a.slug !== st.agent?.slug).map((a) => `<option value="${esc(a.slug)}"${a.slug === o.to ? " selected" : ""}>${esc(a.name)}</option>`).join("")}</select>`;
      if (o && k.type === "memory") extra = `<span class="field-hint">Other agents and Ask PIF will see it, marked as written by this agent.</span>`;
      if (o && k.type === "thesis_check") extra = `<span class="field-hint">${st.spec.steps.some((s) => s.type === "ai" && s.output === "verdict") ? "Uses the AI step's verdict." : "Works best with an AI step that answers as a verdict."}</span>`;
      return `<li class="ab-out${o ? " is-on" : ""}"><label class="ab-check"><input type="checkbox" data-act="output" data-type="${k.type}"${o ? " checked" : ""}> ${esc(k.label)}</label>${extra ? `<span class="ab-out-opts">${extra}</span>` : ""}</li>`;
    }).join("")}</ul>`;

  const metaBody = () => `<div class="ab-row">
      <label class="field-block ab-grow">Name<input type="text" maxlength="60" value="${esc(st.meta.name)}" ${bind("meta.name")} placeholder="e.g. Estimate cut watcher" required></label>
      <div class="field-block"><span id="abVis">Who can see it</span><div class="seg seg-sm" role="group" aria-labelledby="abVis"><button type="button" class="seg-btn" data-act="vis" data-v="team" aria-pressed="${st.meta.visibility !== "private"}">Team</button><button type="button" class="seg-btn" data-act="vis" data-v="private" aria-pressed="${st.meta.visibility === "private"}">Only me</button></div></div>
    </div>
    <label class="field-block">What it's for <span class="field-hint">One line the team sees in the gallery</span><input type="text" maxlength="280" value="${esc(st.meta.description)}" ${bind("meta.description")}></label>
    <fieldset class="ab-icons"><legend>Icon</legend>${AGENT_ICONS.map((n) => `<label class="ab-icon-opt" title="${esc(n)}"><input type="radio" name="abIcon" value="${n}" ${bind("meta.icon")}${st.meta.icon === n ? " checked" : ""}><span>${icon(n)}<span class="sr-only">${esc(n)}</span></span></label>`).join("")}</fieldset>
    <div class="ab-row">
      <label class="field-block ab-narrow">Max per run ($)<input type="number" min="0" step="0.01" value="${esc(st.spec.budget.perRunUsd ?? "")}" ${bind("spec.budget.perRunUsd", "num")} class="ab-num-input"></label>
      <label class="field-block ab-narrow">Max per month ($)<input type="number" min="0" step="0.5" value="${esc(st.spec.budget.perMonthUsd ?? "")}" ${bind("spec.budget.perMonthUsd", "num")} class="ab-num-input"></label>
      <p class="field-hint ab-grow">Runs stop when either cap is hit, and the fund's monthly AI cap and your daily cap still apply. Rule-only agents cost nothing.</p>
    </div>`;

  // ---- Side panel: summary, estimate, problems, save ----
  const sideHtml = () => {
    const est = st.server?.estimate ? { ...M.estimate(st.spec, st), ...st.server.estimate } : M.estimate(st.spec, st);
    const free = est.free ?? est.aiFree;
    const issues = [...(st.server?.errors || []).map((e) => ({ ...e, server: true })), ...(st.server?.warnings || []).map((w) => ({ ...w, warn: true })), ...M.check(st.spec, { name: st.meta.name, holdingsCount: st.holdingsCount, watchlistCount: st.watchlistCount })];
    const seen = new Set();
    const uniqueIssues = issues.filter((x) => { const k = x.message; if (seen.has(k)) return false; seen.add(k); return true; });
    const errors = uniqueIssues.filter((x) => !x.warn), warns = uniqueIssues.filter((x) => x.warn);
    st.issues = errors;
    return `<div class="ab-side-card">
      <p class="ab-side-label">In plain English</p>
      <p class="ab-summary">${esc(M.describe(st.spec, { metrics: st.metrics, agentsBySlug }))}</p>
      <div class="ab-cost">${free ? `<span class="badge badge-owned">Free: no AI</span>` : `<div><strong>${M.usd(est.perRunUsd)}</strong><span class="muted small">a run at most</span></div><div><strong>≈ ${M.usd(est.perMonthUsd)}</strong><span class="muted small">a month</span></div>`}
        <div><strong>≈ ${Math.round(est.runsPerMonth)}</strong><span class="muted small">checks a month</span></div></div>
      ${!free && est.gated ? `<p class="muted small">Conditions and rules run first, for free; AI only runs when they pass, so the monthly figure assumes about a third pass.</p>` : ""}
      ${errors.length ? `<ul class="ab-issues" aria-label="To fix before saving">${errors.map((e) => `<li class="is-error"><button type="button" class="btn-link" data-goto="${esc(e.path || "")}">${esc(e.message)}</button></li>`).join("")}</ul>` : ""}
      ${warns.length ? `<ul class="ab-issues">${warns.map((e) => `<li class="is-warn">${esc(e.message)}</li>`).join("")}</ul>` : ""}
      ${readOnly ? `<p class="muted small">This is ${esc(st.agent.ownerName || "a teammate")}'s agent. Duplicate it to make your own version.</p><div class="ab-actions"><button type="button" class="btn btn-primary" data-act="fork">Duplicate</button><button type="button" class="btn btn-ghost" data-act="test">Test</button></div>`
        : `${st.agent ? `<label class="field-block small">What changed <input type="text" maxlength="200" value="${esc(st.note)}" data-bind="note" data-kind="str" placeholder="optional, shows in history"></label>` : ""}
      <div class="ab-actions">
        <button type="button" class="btn btn-primary" data-act="save"${st.engine ? "" : " disabled"}>${st.agent ? "Save changes" : "Save and turn on"}</button>
        ${st.agent ? "" : `<button type="button" class="btn btn-ghost" data-act="save-paused"${st.engine ? "" : " disabled"}>Save paused</button>`}
        <button type="button" class="btn btn-ghost" data-act="test">${icon("flask", { size: 16 })} Test</button>
      </div>`}
    </div>`;
  };

  const head = () => st.agent ? `<div class="ab-agent-head">${avatar(st.agent, 22)}<div><p class="muted small">${statusDot(st.agent.status)} · version ${st.agent.version || 1}${st.agent.ownerName ? ` · by ${esc(st.agent.ownerName)}` : ""}</p></div>
      <span class="ab-head-actions">${mine ? `<button type="button" class="btn btn-ghost btn-sm" data-act="${st.agent.status === "paused" ? "resume" : "pause"}">${st.agent.status === "paused" ? "Turn on" : "Pause"}</button>` : ""}<button type="button" class="btn btn-ghost btn-sm" data-act="history">History</button></span></div>` : "";

  const describeBox = () => st.agent ? "" : `<form class="panel ab-describe" data-act="draft-form">
      <label for="abWords"><strong>${icon("sparkle", { size: 16 })} Describe it in words</strong> <span class="muted small">and the form fills itself in. You check everything before saving.</span></label>
      <div class="ab-describe-row"><textarea id="abWords" rows="2" maxlength="1500" placeholder="e.g. Tell me when any holding's estimates get cut twice in a month and check it against our thesis"></textarea>
      <button type="submit" class="btn btn-primary">Draft it</button></div>
      <p class="muted small" id="abDraftNote">${st.draftNote ? esc(st.draftNote.text) : "Uses the fast model, under a cent."}</p>
      ${st.draftNote?.assumptions?.length ? `<ul class="small ab-assume">${st.draftNote.assumptions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : ""}
    </form>`;

  const render = () => {
    const y = window.scrollY;
    root.innerHTML = `${st.engine ? "" : engineMissing()}${head()}${describeBox()}
      <div class="ab-layout">
        <form class="ab-form" novalidate>
          <fieldset ${readOnly ? "disabled" : ""} class="ab-fieldset">
          ${section(1, "What to watch", "", scopeBody())}
          ${section(2, "When it runs", "A schedule, events, or both.", whenBody())}
          ${section(3, "Only if", "Free checks before anything else runs. If one fails, the run stops without spending anything.", condBody(), { optional: true })}
          ${section(4, "What it does", "Steps run in order. Data and rule steps are free; AI steps read, judge and write.", stepsBody())}
          ${section(5, "Where results go", "", outBody())}
          ${section(6, "Name, sharing and budget", "", metaBody())}
          </fieldset>
        </form>
        <aside class="ab-side" aria-label="Summary">${sideHtml()}<div id="abTest"></div><div id="abHistory"></div></aside>
      </div>
      <div class="ab-mobilebar" aria-hidden="true"><span id="abMobileCost"></span><button type="button" class="btn btn-primary btn-sm" data-act="${readOnly ? "fork" : "save"}" tabindex="-1">${readOnly ? "Duplicate" : "Save"}</button></div>`;
    refreshMobile();
    window.scrollTo({ top: y });
    if (st.testState) import("./testPanel.js").then((m) => m.renderTest(root.querySelector("#abTest"), st.testState));
  };
  const refreshMobile = () => {
    const el = root.querySelector("#abMobileCost");
    if (!el) return;
    const est = M.estimate(st.spec, st);
    el.textContent = est.aiFree ? "Free: no AI" : `≈ ${M.usd(est.perMonthUsd)} a month`;
  };
  const refreshSide = () => {
    const card = root.querySelector(".ab-side-card");
    if (card) card.outerHTML = sideHtml();
    refreshMobile();
  };

  // Ask the engine to validate as the member types (debounced). Missing route: stay client-side.
  let vTimer = null, vSeq = 0;
  const validateSoon = () => {
    clearTimeout(vTimer);
    if (!st.engine || st.noValidate) return;
    vTimer = setTimeout(async () => {
      const seq = ++vSeq;
      try { const r = await A.validate(st.spec); if (seq === vSeq) { st.server = r; refreshSide(); } }
      catch (err) { if (A.isMissing(err)) st.noValidate = true; }
    }, 600);
  };
  const changed = (rerender) => { st.server = null; if (rerender) render(); else refreshSide(); validateSoon(); };

  // ---- Events ----
  const readValue = (el) => {
    const k = el.dataset.kind;
    if (k === "bool") return el.checked;
    if (k === "num") return el.value === "" ? "" : Number(el.value);
    if (k === "list") return el.value.split(/[\s,]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
    return el.value;
  };
  root.addEventListener("input", (e) => {
    const el = e.target.closest("[data-bind]");
    if (!el || el.type === "radio" || el.tagName === "SELECT") return;
    setPath(st, el.dataset.bind, readValue(el));
    if (el.dataset.bind === "note") return;
    changed(false);
  });
  root.addEventListener("change", (e) => {
    const el = e.target;
    if (el.matches("[data-bind]") && (el.type === "radio" || el.tagName === "SELECT" || el.type === "checkbox")) {
      setPath(st, el.dataset.bind, readValue(el));
      return changed(el.hasAttribute("data-rerender") || el.type === "radio" && el.name === "abUniverse");
    }
    const act = el.dataset.act;
    const T = st.spec.triggers;
    if (act === "schedule") {
      const i = T.findIndex((t) => t.type === "schedule");
      const next = el.value === "none" ? null : el.value === "custom" ? { type: "schedule", cron: T[i]?.cron || M.scheduleCron(T[i] || {}) || "30 8 * * 1-5", tz: "America/New_York" } : { type: "schedule", preset: el.value, tz: "America/New_York" };
      if (i >= 0) { if (next) T[i] = next; else T.splice(i, 1); } else if (next) T.unshift(next);
      return changed(true);
    }
    if (act === "cron-days" || act === "cron-time") {
      const t = T.find((x) => x.type === "schedule");
      const cur = simpleCron(t.cron) || { days: "1-5", time: "08:30" };
      cur[act === "cron-days" ? "days" : "time"] = el.value;
      t.cron = toCron(cur);
      return changed(true);
    }
    if (act === "event") {
      const d = M.eventDef(el.dataset.on);
      if (el.checked) { const t = { type: "event", on: d.on }; if (d.param) t[d.param.key] = d.param.def; if (d.forms) t.forms = [...d.forms]; T.push(t); }
      else st.spec.triggers = T.filter((t) => !(t.type === "event" && t.on === d.on));
      return changed(true);
    }
    if (act === "form") {
      const t = T[Number(el.dataset.i)], all = M.eventDef("filing").forms;
      const set = new Set(t.forms || all);
      if (el.checked) set.add(el.value); else set.delete(el.value);
      t.forms = all.filter((f) => set.has(f));
      return changed(false);
    }
    if (act === "handoff-trigger") {
      if (el.checked) T.push({ type: "handoff", topic: "thesis" }); else st.spec.triggers = T.filter((t) => t.type !== "handoff");
      return changed(true);
    }
    if (act === "tool") {
      const s = st.spec.steps[Number(el.dataset.i)], set = new Set(s.tools || []);
      if (el.checked) set.add(el.value); else set.delete(el.value);
      s.tools = allTools.map((t) => t.name).filter((n) => set.has(n));
      const sum = el.closest("details")?.querySelector("summary strong");
      if (sum) sum.textContent = s.tools.length ? `${s.tools.length} picked` : "the usual set";
      return changed(false);
    }
    if (act === "output") {
      const type = el.dataset.type;
      if (el.checked) st.spec.outputs.push(type === "feed" ? { type, when: "always" } : type === "notify" ? { type, who: "owner", tier: "inbox", when: "always" }
        : type === "memory" ? { type, scope: st.spec.scope.universe === "fund" ? "fund" : "symbol", kind: "observation" } : type === "handoff" ? { type, topic: "" } : type === "proposal" ? { type, kind: "" } : { type });
      else st.spec.outputs = st.spec.outputs.filter((o) => o.type !== type);
      return changed(true);
    }
  });

  root.addEventListener("click", async (e) => {
    const go = e.target.closest("[data-goto]");
    if (go) return focusPath(go.dataset.goto);
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    const act = b.dataset.act, i = Number(b.dataset.i);
    const steps = st.spec.steps;
    if (act === "cond-add") { st.spec.conditions.push({ metric: "", op: "<", value: "" }); changed(true); root.querySelector(`[data-bind="spec.conditions.${st.spec.conditions.length - 1}.metric"]`)?.focus(); return; }
    if (act === "cond-remove") { st.spec.conditions.splice(i, 1); return changed(true); }
    if (act === "step-add") {
      const type = b.dataset.type, id = M.nextStepId(st.spec, type);
      const fund = st.spec.scope.universe === "fund";
      steps.push(type === "tool" ? { id, type, tool: fund ? "get_holdings" : "get_research_overview", args: fund ? {} : { symbol: "$symbol" } }
        : type === "rule" ? { id, type, if: { metric: "", op: ">", value: "" }, else: "stop" }
          : { id, type: "ai", tier: "mid", instructions: "", tools: [], maxSteps: 6, output: "brief", recall: true });
      changed(true);
      root.querySelectorAll(".ab-step")[steps.length - 1]?.querySelector("select, textarea")?.focus();
      return;
    }
    if (act === "step-remove") { steps.splice(i, 1); return changed(true); }
    if (act === "step-move") { const j = i + Number(b.dataset.dir); [steps[i], steps[j]] = [steps[j], steps[i]]; changed(true); root.querySelector(`[data-act="step-move"][data-i="${j}"][data-dir="${b.dataset.dir}"]`)?.focus(); return; }
    if (act === "tier") { steps[i].tier = b.dataset.tier; if (b.dataset.tier === "cheap" && steps[i].maxSteps > 6) steps[i].maxSteps = 4; return changed(true); }
    if (act === "tools-group") {
      const g = toolGroups.find((x) => x.key === b.dataset.group), s = steps[i], set = new Set(s.tools || []);
      const all = g.tools.every((t) => set.has(t.name));
      g.tools.forEach((t) => (all ? set.delete(t.name) : set.add(t.name)));
      s.tools = allTools.map((t) => t.name).filter((n) => set.has(n));
      changed(true);
      root.querySelectorAll(".ab-tools")[steps.filter((x, k) => k < i && x.type === "ai").length]?.setAttribute("open", "");
      return;
    }
    if (act === "vis") { st.meta.visibility = b.dataset.v; root.querySelectorAll('[data-act="vis"]').forEach((x) => x.setAttribute("aria-pressed", String(x === b))); return; }
    if (act === "save" || act === "save-paused") return save(act === "save-paused", b);
    if (act === "fork") return forkIt(b);
    if (act === "test") {
      st.testState = { spec: st.spec, agent: st.agent, dirty: true, holdings: st.holdingsCount };
      const m = await import("./testPanel.js");
      m.renderTest(root.querySelector("#abTest"), st.testState, { start: true });
      return;
    }
    if (act === "history") {
      const m = await import("./history.js");
      const box = root.querySelector("#abHistory");
      m.renderHistory(box, { agent: st.agent, current: st.spec, metrics: st.metrics, canRestore: mine, onRestored: (a) => { location.hash = `#/agents/${encodeURIComponent(a.slug || st.agent.slug)}/edit`; window.dispatchEvent(new HashChangeEvent("hashchange")); } });
      box.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (act === "pause" || act === "resume") {
      b.disabled = true;
      try { await A[act](st.agent.id); st.agent.status = act === "pause" ? "paused" : "active"; toast(act === "pause" ? "Paused. It won't run until you turn it on." : "Turned on.", { type: "success" }); render(); }
      catch (err) { b.disabled = false; toast(err.message, { type: "error" }); }
    }
  });

  root.addEventListener("submit", async (e) => {
    const form = e.target.closest('[data-act="draft-form"]');
    e.preventDefault();
    if (!form) return;
    const text = form.querySelector("textarea").value.trim();
    const btn = form.querySelector("button"), note = form.querySelector("#abDraftNote");
    if (text.length < 8) { note.textContent = "Describe the agent in a sentence or two."; return; }
    btn.disabled = true; btn.textContent = "Drafting…"; note.textContent = "Reading what you wrote…";
    try {
      const r = await A.draft(text);
      st.spec = M.normalize(r.spec);
      if (r.name) st.meta.name = r.name;
      if (r.description) st.meta.description = r.description;
      st.server = r.errors?.length || r.warnings?.length ? { errors: r.errors, warnings: r.warnings } : null;
      st.draftNote = { text: r.source === "ai" ? "Drafted by AI. Check each section, then save." : `Drafted from keywords${r.aiError ? " because the AI call failed" : " (AI is off on the server)"}. Check each section, then save.`, assumptions: r.assumptions };
      render();
      root.querySelector("#abWords").value = text;
      root.querySelector(".ab-summary")?.closest(".ab-side-card")?.classList.add("is-fresh");
      validateSoon();
    } catch (err) { note.textContent = err.message; }
    finally { const b2 = root.querySelector('[data-act="draft-form"] button'); if (b2) { b2.disabled = false; b2.textContent = "Draft it"; } }
  });

  function focusPath(path) {
    const p = String(path || "").replace(/\[(\w+)\]/g, ".$1").replace(/^\./, "");
    const target = p === "name" ? "meta.name" : p.startsWith("spec.") || p.startsWith("meta.") ? p : `spec.${p}`;
    const els = [...root.querySelectorAll("[data-bind]")];
    const el = els.find((x) => x.dataset.bind === target) || els.find((x) => x.dataset.bind.startsWith(target));
    const sec = { scope: 1, triggers: 2, conditions: 3, steps: 4, outputs: 5, budget: 6 }[target.split(".")[1]];
    if (el) { el.focus(); el.scrollIntoView({ behavior: "smooth", block: "center" }); }
    else if (sec) root.querySelector(`#abs${sec}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function save(paused, btn) {
    refreshSide();
    if (st.issues.length) { toast("Fix the items in the summary first.", { type: "error" }); focusPath(st.issues[0].path); return; }
    btn.disabled = true;
    const body = { name: st.meta.name.trim(), description: st.meta.description.trim(), icon: st.meta.icon, visibility: st.meta.visibility, spec: st.spec };
    try {
      let a;
      if (st.agent) a = await A.updateAgent(st.agent.id, { ...body, note: st.note.trim() || undefined });
      else {
        a = await A.createAgent(body);
        if (paused) await A.pause(a.id).catch(() => {});
      }
      toast(st.agent ? "Saved. The change shows in its history." : paused ? "Saved, paused. Turn it on when you're ready." : "Saved and on. It runs on its next trigger.", { type: "success" });
      location.hash = `#/agents/${encodeURIComponent(a.slug || a.id)}/edit`;
      if (st.agent) window.dispatchEvent(new HashChangeEvent("hashchange"));
    } catch (err) {
      btn.disabled = false;
      if (err.errors?.length) { st.server = { errors: err.errors, warnings: err.warnings }; refreshSide(); focusPath(err.errors[0].path); }
      toast(err.message, { type: "error" });
    }
  }
  async function forkIt(btn) {
    btn.disabled = true;
    try { const a = await A.fork(st.agent.id); toast("Duplicated. This copy is yours to change.", { type: "success" }); location.hash = `#/agents/${encodeURIComponent(a.slug || a.id)}/edit`; }
    catch (err) { btn.disabled = false; toast(err.message, { type: "error" }); }
  }

  render();
  validateSoon();
  if (!embedded && !st.agent) root.querySelector("#abWords")?.focus({ preventScroll: true });
}
