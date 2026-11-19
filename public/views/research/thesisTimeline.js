// Research → Thesis: the thesis over time (WS4). Pillar status lanes, every check with its
// evidence, thesis versions, scenario odds, catalysts, tripwires and price on one time axis,
// plus the tools to keep it current: add/edit pillars with KPI rules, a member's status call
// (with a sentence of evidence), catalysts, scenario odds, and AI suggestions that land as
// proposals to approve.
import { esc, api, toast, fmtUSD, safeUrl, signed, fmtPct } from "../../shared.js";
import { STATUS, statusChip, healthBadge, sparkline, fmtKpi } from "./thesisParts.js";

const DAY = 864e5;
const ts = (d) => Date.parse(String(d).length <= 10 ? `${d}T00:00:00Z` : String(d).replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(d) ? "" : "Z"));
const day = (d) => String(d || "").slice(0, 10);
const pct = (x) => `${Math.round(x * 100)}%`;

let catalog = null;
async function metricCatalog() {
  if (!catalog) catalog = api("/api/theses/metrics").then((r) => r.metrics).catch(() => []);
  return catalog;
}

export async function mountThesisTimeline(box, { symbol }) {
  const state = { symbol, data: null, filter: "all", showForm: false, editing: null, statusFor: null, diffFor: null };
  box.innerHTML = `<p class="muted small" role="status">Loading the thesis history…</p>`;
  const load = async () => {
    try { state.data = await api(`/api/theses/${encodeURIComponent(symbol)}`); }
    catch (e) { box.innerHTML = `<p class="muted small">${esc(e.message)}</p>`; return; }
    state.metrics = await metricCatalog();
    render();
  };
  const render = () => { box.innerHTML = view(state); };

  box.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-th]");
    if (!b || !box.contains(b)) return;
    const act = b.dataset.th, id = b.dataset.id;
    const busy = (on) => { b.disabled = on; b.setAttribute("aria-busy", on ? "true" : "false"); };
    try {
      if (act === "add-toggle") { state.showForm = !state.showForm; state.editing = null; render(); box.querySelector("#thText")?.focus(); return; }
      if (act === "edit") { state.editing = Number(id); state.showForm = true; render(); box.querySelector("#thText")?.focus(); return; }
      if (act === "status-toggle") { state.statusFor = state.statusFor === Number(id) ? null : Number(id); render(); box.querySelector(`#thStatusNote`)?.focus(); return; }
      if (act === "diff") { state.diffFor = state.diffFor === Number(id) ? null : Number(id); render(); return; }
      if (act === "retire") {
        busy(true); await api(`/api/theses/pillars/${id}/retire`, { method: "POST", body: "{}" }); toast("Pillar retired. Its history stays on the timeline.", { type: "success" }); return load();
      }
      if (act === "release") { busy(true); await api(`/api/theses/pillars/${id}/release`, { method: "POST", body: "{}" }); toast("Handed back to its KPI rule.", { type: "success" }); return load(); }
      if (act === "rules") {
        busy(true); const r = await api(`/api/theses/${encodeURIComponent(symbol)}/evaluate`, { method: "POST", body: "{}" });
        toast(r.checked ? `Checked ${r.checked} KPI rule${r.checked > 1 ? "s" : ""}; ${r.moved} pillar${r.moved === 1 ? "" : "s"} moved.` : "No pillars with KPI rules to check yet.", { type: "success" });
        return load();
      }
      if (act === "suggest" || act === "ai-check" || act === "odds") {
        busy(true);
        b.textContent = act === "suggest" ? "Reading the pitch…" : act === "odds" ? "Weighing the scenarios…" : "Checking each pillar…";
        const path = { suggest: "pillars/suggest", "ai-check": "check", odds: "scenario/suggest" }[act];
        const r = await api(`/api/theses/${encodeURIComponent(symbol)}/${path}`, { method: "POST", body: "{}" });
        toast(r.skipped || (r.proposalId || r.results?.some((x) => x.proposalId) ? "Suggestion ready below. Approve it to apply." : "No changes suggested."), { type: r.skipped ? "info" : "success" });
        return load();
      }
      if (act === "decide") {
        busy(true); await api(`/api/agents/proposals/${id}/decide`, { method: "POST", body: JSON.stringify({ approve: b.dataset.approve === "1" }) });
        return load();
      }
      if (act === "cat") {
        busy(true); await api(`/api/theses/catalysts/${id}`, { method: "POST", body: JSON.stringify({ status: b.dataset.status }) }); return load();
      }
      if (act === "cat-del") { busy(true); await api(`/api/theses/catalysts/${id}`, { method: "DELETE" }); return load(); }
    } catch (err) { toast(err.message, { type: "error" }); busy(false); }
  });

  box.addEventListener("change", (e) => {
    if (e.target.id === "thFilter") { state.filter = e.target.value; render(); box.querySelector("#thFilter")?.focus(); }
    if (e.target.id === "thMetric") syncUnit(box, state);
  });

  box.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector("button[type=submit], button:not([type])");
    if (btn) btn.disabled = true;
    try {
      if (f.id === "thPillarForm") {
        const body = pillarBody(f, state);
        if (state.editing) await api(`/api/theses/pillars/${state.editing}`, { method: "PATCH", body: JSON.stringify(body) });
        else await api(`/api/theses/${encodeURIComponent(symbol)}/pillars`, { method: "POST", body: JSON.stringify(body) });
        state.showForm = false; state.editing = null;
        toast("Pillar saved.", { type: "success" });
      } else if (f.id === "thStatusForm") {
        await api(`/api/theses/pillars/${state.statusFor}/status`, { method: "POST", body: JSON.stringify({ status: f.status.value, note: f.note.value }) });
        state.statusFor = null;
        toast("Status recorded. It stands until a member changes it.", { type: "success" });
      } else if (f.id === "thCatForm") {
        await api(`/api/theses/${encodeURIComponent(symbol)}/catalysts`, { method: "POST", body: JSON.stringify({ text: f.text.value, dueDate: f.dueDate.value }) });
      } else if (f.id === "thOddsForm") {
        await api(`/api/theses/${encodeURIComponent(symbol)}/scenario`, { method: "POST", body: JSON.stringify({ bullProb: Number(f.bull.value), baseProb: Number(f.base.value), bearProb: Number(f.bear.value), note: f.note.value }) });
        toast("Odds recorded.", { type: "success" });
      }
      await load();
    } catch (err) { toast(err.message, { type: "error" }); if (btn) btn.disabled = false; }
  });

  await load();
}

function pillarBody(f, state) {
  const body = { text: f.text.value, weight: Number(f.weight.value) || 1, reviewDays: Number(f.reviewDays.value) || null, consensus: f.consensus.value };
  const metric = f.metric.value;
  if (!metric) { body.kpi = null; return body; }
  const unit = state.metrics.find((m) => m.name === metric)?.unit;
  const scale = (v) => (unit === "pct" ? Number(v) / 100 : Number(v));
  const op = f.op.value;
  body.kpi = op === "between" ? { metric, op, value: [scale(f.value.value), scale(f.value2.value)] } : { metric, op, value: scale(f.value.value) };
  return body;
}

function syncUnit(box, state) {
  const m = state.metrics.find((x) => x.name === box.querySelector("#thMetric")?.value);
  const hint = box.querySelector("#thUnit");
  if (hint) hint.textContent = !m ? "" : m.unit === "pct" ? "in %, e.g. 20 for 20%" : m.unit === "usd" ? "in dollars" : "";
  box.querySelectorAll(".th-kpi-only").forEach((n) => { n.hidden = !m; });
}

// ---- Views ----

function view(state) {
  const d = state.data;
  const live = d.pillars || [];
  return `
    <div class="th-wrap">
      ${summaryRow(d)}
      ${d.pending?.length ? pendingBox(d) : ""}
      <section class="panel th-panel" aria-labelledby="thTlH">
        <div class="panel-head"><h3 id="thTlH">Thesis over time</h3> <a class="small" href="#/theses">All holdings</a>
          <span class="th-legend small muted" aria-hidden="true">${Object.entries(STATUS).map(([k, s]) => `<span class="th-chip ${s.cls}">${s.glyph} ${s.label}</span>`).join(" ")} · dot = rule check, ring = AI, square = member</span></div>
        ${timelineSvg(d)}
        <p class="muted small">Price (top), health score, then one lane per pillar. Marks on the price line: ✎ thesis edited, ✕ tripwire tripped, ◇ catalyst date. The full record is in the evidence log below.</p>
      </section>
      <section class="panel th-panel" aria-labelledby="thPilH">
        <div class="panel-head"><h3 id="thPilH">Pillars</h3>
          <div class="th-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-th="rules" title="Free: re-reads each pillar's KPI now">Check KPI rules now</button>
            ${d.canUseAi ? `<button type="button" class="btn btn-ghost btn-sm" data-th="suggest">Suggest pillars from the pitch</button>
            <button type="button" class="btn btn-ghost btn-sm" data-th="ai-check" ${live.length ? "" : "disabled"}>AI check against the latest brief</button>` : ""}
          </div></div>
        ${live.length ? `<ul class="th-pillars">${live.map((p) => pillarRow(p, state)).join("")}</ul>` : `<p class="muted">No pillars yet. A pillar is one claim the thesis depends on that someone can check later, ideally with a number: "Data-center revenue keeps growing 30%+ a year". Add 3 to 6, including what would prove the thesis wrong.</p>`}
        <p><button type="button" class="btn btn-ghost btn-sm" data-th="add-toggle" aria-expanded="${state.showForm}">${state.showForm && !state.editing ? "Cancel" : "+ Add a pillar"}</button></p>
        ${state.showForm ? pillarForm(state) : ""}
      </section>
      <div class="th-grid">
        ${scenarioPanel(d)}
        ${catalystPanel(d)}
      </div>
      ${evidenceLog(state)}
      ${versionsPanel(state)}
    </div>`;
}

function summaryRow(d) {
  const h = d.health || {};
  const ev = d.scenario?.expected;
  const cs = d.catalysts?.stats || {};
  return `<div class="th-summary">
    <div><span class="muted small">Health</span>${healthBadge(h)}${h.unknown || h.overdue ? `<div class="muted small">${h.unknown + h.overdue} pillar${h.unknown + h.overdue > 1 ? "s" : ""} unchecked or overdue, left out</div>` : ""}</div>
    <div><span class="muted small">Overall</span>${statusChip(d.status)}${d.thesis?.approvedStatus ? `<div class="muted small">Last approved status: ${esc(d.thesis.approvedStatus)}</div>` : ""}</div>
    <div><span class="muted small">Health, last 6 months</span>${sparkline(d.healthHistory)}</div>
    <div><span class="muted small">Probability-weighted value</span>${ev ? `<strong>${fmtUSD(ev.value)}</strong> <span class="small">${ev.upsidePct != null ? signed(ev.upsidePct * 100, fmtPct(ev.upsidePct * 100), { neutral: true }) : ""}</span>` : `<span class="muted">—</span>`}</div>
    <div><span class="muted small">Catalysts on time</span>${cs.due ? `<strong>${cs.onTime}/${cs.due}</strong>${cs.late ? ` <span class="badge badge-warn">${cs.late} late</span>` : ""}` : `<span class="muted">none due yet</span>`}</div>
    ${d.drift?.drifted ? `<div class="th-drift"><span class="badge badge-warn" title="Word overlap with ${esc(d.drift.from)}: ${Math.round(d.drift.similarity * 100)}%">Drift</span>
      <span class="small">The written thesis has moved away from ${esc(d.drift.from)}${d.drift.added.length ? `: now talks about <em>${esc(d.drift.added.slice(0, 5).join(", "))}</em>` : ""}${d.drift.dropped.length ? `; no longer mentions <em>${esc(d.drift.dropped.slice(0, 5).join(", "))}</em>` : ""}. Legitimate updates drift too: decide if this needs a new pitch.</span></div>` : ""}
  </div>`;
}

function pendingBox(d) {
  return `<section class="panel th-panel th-pending" aria-labelledby="thPendH">
    <h3 id="thPendH">Waiting for a member (agent suggestions)</h3>
    <ul class="th-list">${d.pending.map((p) => `<li>
      <div><span class="badge badge-watch">${esc(p.kindLabel)}</span> ${esc(p.title)}</div>
      ${p.kind === "thesis_pillars" ? `<ol class="small">${(p.payload.pillars || []).map((x) => `<li>${esc(x.text)}${x.kpi ? ` <span class="muted">(${esc(fmtKpi(x.kpi))})</span>` : ""}</li>`).join("")}</ol>
        ${(p.payload.catalysts || []).length ? `<p class="small muted">Catalysts: ${p.payload.catalysts.map((c) => `${esc(c.text)}${c.dueDate ? ` (${esc(c.dueDate)})` : ""}`).join("; ")}</p>` : ""}` : ""}
      ${p.payload?.evidence ? `<blockquote class="small">${esc(p.payload.evidence)}</blockquote>` : ""}
      <div class="th-actions"><button type="button" class="btn btn-primary btn-sm" data-th="decide" data-id="${p.id}" data-approve="1">Approve</button>
        <button type="button" class="btn btn-ghost btn-sm" data-th="decide" data-id="${p.id}" data-approve="0">Dismiss</button>
        ${p.runId ? `<a class="small" href="#/agents/runs/${Number(p.runId)}">See the run</a>` : ""}</div></li>`).join("")}</ul>
  </section>`;
}

function pillarRow(p, state) {
  const unit = state.metrics?.find((m) => m.name === p.kpi?.metric)?.unit;
  const label = state.metrics?.find((m) => m.name === p.kpi?.metric)?.label;
  const by = p.statusBy === "rule" ? "KPI rule" : p.statusBy === "ai" ? "AI check (approved)" : p.statusBy ? p.statusBy : "";
  const val = p.lastValue == null ? "" : unit === "pct" ? `${(p.lastValue * 100).toFixed(1)}%` : unit === "usd" ? fmtUSD(p.lastValue) : String(+Number(p.lastValue).toPrecision(4));
  return `<li class="th-pillar">
    <div class="th-pillar-head">${statusChip(p.status)} <span class="th-pillar-text">${esc(p.text)}</span>${Number(p.weight) !== 1 ? ` <span class="badge" title="Weight in the health score">×${esc(p.weight)}</span>` : ""}${p.origin === "kill" ? ` <span class="badge badge-danger">kill criterion</span>` : ""}</div>
    <div class="muted small">${p.kpi ? `KPI: ${esc(fmtKpi({ ...p.kpi, label }, unit))}${val ? ` · now <strong>${esc(val)}</strong>` : ""} · ` : "No KPI rule (checked by members and AI) · "}${by ? `status set by ${esc(by)}${p.statusAt ? ` on ${esc(day(p.statusAt))}` : ""} · ` : ""}${p.lastCheckAt ? `last checked ${esc(day(p.lastCheckAt))}` : "never checked"}${p.consensus ? ` · Street view: ${esc(p.consensus)}` : ""}</div>
    <div class="th-actions small">
      <button type="button" class="btn-link" data-th="status-toggle" data-id="${p.id}" aria-expanded="${state.statusFor === p.id}">Set status</button>
      <button type="button" class="btn-link" data-th="edit" data-id="${p.id}">Edit</button>
      ${p.kpi && p.statusBy && p.statusBy !== "rule" ? `<button type="button" class="btn-link" data-th="release" data-id="${p.id}">Hand back to the KPI rule</button>` : ""}
      <button type="button" class="btn-link" data-th="retire" data-id="${p.id}">Retire</button>
    </div>
    ${state.statusFor === p.id ? `<form id="thStatusForm" class="th-form th-inline-form">
      <label>Status <select name="status">${Object.entries(STATUS).map(([k, s]) => `<option value="${k}" ${k === p.status ? "selected" : ""}>${s.glyph} ${s.label}</option>`).join("")}</select></label>
      <label class="th-grow">Evidence <input id="thStatusNote" name="note" required minlength="10" maxlength="500" placeholder="What did you see? e.g. Q3 data-center revenue +12% vs +30% needed" /></label>
      <button class="btn btn-primary btn-sm">Record</button></form>` : ""}
  </li>`;
}

function pillarForm(state) {
  const p = state.editing ? state.data.pillars.find((x) => x.id === state.editing) : null;
  const m = state.metrics || [];
  const groups = [...new Set(m.map((x) => x.group))];
  const unit = m.find((x) => x.name === p?.kpi?.metric)?.unit;
  const show = (v) => (v == null ? "" : unit === "pct" ? +(v * 100).toFixed(4) : v);
  const v = p?.kpi?.value;
  return `<form id="thPillarForm" class="th-form" novalidate>
    <h4>${p ? "Edit pillar" : "New pillar"}</h4>
    <label class="th-full">Claim <textarea id="thText" name="text" rows="2" required maxlength="600" placeholder="One claim the thesis depends on, checkable later">${esc(p?.text || "")}</textarea></label>
    <label>Watch a number <select id="thMetric" name="metric"><option value="">None: members and AI check it</option>
      ${groups.map((g) => `<optgroup label="${esc(g)}">${m.filter((x) => x.group === g).map((x) => `<option value="${esc(x.name)}" ${x.name === p?.kpi?.metric ? "selected" : ""}>${esc(x.label)}</option>`).join("")}</optgroup>`).join("")}</select></label>
    <label class="th-kpi-only" ${p?.kpi ? "" : "hidden"}>Holds when <select name="op">${[[">=", "≥"], [">", ">"], ["<=", "≤"], ["<", "<"], ["between", "between"]].map(([k, l]) => `<option value="${k}" ${p?.kpi?.op === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    <label class="th-kpi-only" ${p?.kpi ? "" : "hidden"}>Value <input name="value" type="number" step="any" inputmode="decimal" value="${esc(show(Array.isArray(v) ? v[0] : v))}" /> <span id="thUnit" class="muted small">${unit === "pct" ? "in %, e.g. 20 for 20%" : ""}</span></label>
    <label class="th-kpi-only" ${p?.kpi ? "" : "hidden"}>and (between only) <input name="value2" type="number" step="any" inputmode="decimal" value="${esc(show(Array.isArray(v) ? v[1] : ""))}" /></label>
    <label>Re-check every <input name="reviewDays" type="number" min="7" max="365" step="1" value="${esc(p?.reviewDays || 90)}" /> days</label>
    <label>Weight <select name="weight">${[1, 2, 3].map((w) => `<option ${Number(p?.weight || 1) === w ? "selected" : ""}>${w}</option>`).join("")}</select></label>
    <label class="th-full">What the Street believes instead (optional) <input name="consensus" maxlength="400" value="${esc(p?.consensus || "")}" placeholder="e.g. Consensus models growth slowing to 15%" /></label>
    <div class="th-actions"><button class="btn btn-primary btn-sm">${p ? "Save" : "Add pillar"}</button>${p ? `<button type="button" class="btn btn-ghost btn-sm" data-th="add-toggle">Cancel</button>` : ""}</div>
  </form>`;
}

function scenarioPanel(d) {
  const marks = d.marks || [];
  const last = marks.at(-1);
  const pitch = d.pitch;
  const ok = pitch && [pitch.bullPrice, pitch.basePrice, pitch.bearPrice].every((x) => x > 0);
  const W = 320, H = 70, bw = Math.max(4, Math.min(24, (W - 8) / Math.max(1, marks.length) - 2));
  const bars = marks.slice(-24).map((m, i) => {
    const x = 4 + i * (bw + 2);
    const hb = m.bullProb * H, hm = m.baseProb * H, hr = m.bearProb * H;
    return `<g><title>${esc(day(m.createdAt))}: bull ${pct(m.bullProb)}, base ${pct(m.baseProb)}, bear ${pct(m.bearProb)}${m.memberName ? ` (${esc(m.memberName)})` : m.source === "agent" ? " (agent, approved)" : ""}</title>
      <rect x="${x}" y="0" width="${bw}" height="${hb}" class="th-bull"/><rect x="${x}" y="${hb}" width="${bw}" height="${hm}" class="th-base"/><rect x="${x}" y="${hb + hm}" width="${bw}" height="${hr}" class="th-bear"/></g>`;
  }).join("");
  return `<section class="panel th-panel" aria-labelledby="thOddsH">
    <div class="panel-head"><h3 id="thOddsH">Scenario odds</h3>${d.canUseAi && ok ? `<button type="button" class="btn btn-ghost btn-sm" data-th="odds">Suggest odds</button>` : ""}</div>
    ${ok ? `<p class="small muted">Bull ${fmtUSD(pitch.bullPrice)} · Base ${fmtUSD(pitch.basePrice)} · Bear ${fmtUSD(pitch.bearPrice)} (pitch #${Number(pitch.id)})</p>` : `<p class="small muted">The pitch has no bull/base/bear prices, so odds can't turn into a value.</p>`}
    ${marks.length ? `<svg class="th-odds" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Scenario odds over ${marks.length} updates; latest bull ${pct(last.bullProb)}, base ${pct(last.baseProb)}, bear ${pct(last.bearProb)}">${bars}</svg>
      <p class="small"><span class="th-key th-bull"></span> Bull ${pct(last.bullProb)} <span class="th-key th-base"></span> Base ${pct(last.baseProb)} <span class="th-key th-bear"></span> Bear ${pct(last.bearProb)}${last.note ? ` · <span class="muted">${esc(last.note)}</span>` : ""}</p>` : `<p class="muted small">No odds recorded yet.</p>`}
    <form id="thOddsForm" class="th-form th-inline-form">
      <label>Bull % <input name="bull" type="number" min="0" max="100" step="1" required value="${last ? Math.round(last.bullProb * 100) : 25}" /></label>
      <label>Base % <input name="base" type="number" min="0" max="100" step="1" required value="${last ? Math.round(last.baseProb * 100) : 50}" /></label>
      <label>Bear % <input name="bear" type="number" min="0" max="100" step="1" required value="${last ? Math.round(last.bearProb * 100) : 25}" /></label>
      <label class="th-grow">Why <input name="note" maxlength="300" placeholder="What changed your odds" /></label>
      <button class="btn btn-ghost btn-sm">Record odds</button>
    </form>
  </section>`;
}

function catalystPanel(d) {
  const all = d.catalysts || [];
  const stateBadge = { pending: "", late: `<span class="badge badge-warn">late</span>`, hit: `<span class="badge badge-owned">happened</span>`, miss: `<span class="badge badge-danger">missed</span>`, dropped: `<span class="badge">dropped</span>` };
  return `<section class="panel th-panel" aria-labelledby="thCatH">
    <h3 id="thCatH">Catalysts</h3>
    ${all.length ? `<ul class="th-list">${all.map((c) => `<li>
      <div>${c.dueDate ? `<strong>${esc(c.dueDate)}</strong> ` : `<span class="muted">no date</span> `}${esc(c.text)} ${stateBadge[c.state] || ""}</div>
      <div class="th-actions small">${c.state === "pending" || c.state === "late" ? `<button type="button" class="btn-link" data-th="cat" data-status="hit" data-id="${c.id}">It happened</button> · <button type="button" class="btn-link" data-th="cat" data-status="miss" data-id="${c.id}">Missed</button> · <button type="button" class="btn-link" data-th="cat" data-status="dropped" data-id="${c.id}">Drop</button>` : `<button type="button" class="btn-link" data-th="cat" data-status="pending" data-id="${c.id}">Reopen</button>`} · <button type="button" class="btn-link" data-th="cat-del" data-id="${c.id}" aria-label="Delete catalyst">Delete</button></div></li>`).join("")}</ul>` : `<p class="muted small">No dated catalysts. A catalyst with a date can be graded: did it happen on time?</p>`}
    <form id="thCatForm" class="th-form th-inline-form">
      <label class="th-grow">Catalyst <input name="text" required maxlength="300" placeholder="e.g. New product ramp shows in revenue" /></label>
      <label>By <input name="dueDate" type="date" /></label>
      <button class="btn btn-ghost btn-sm">Add</button>
    </form>
  </section>`;
}

function evidenceLog(state) {
  const d = state.data;
  const names = Object.fromEntries((d.pillars || []).map((p, i) => [p.id, `P${i + 1}`]));
  const rows = (d.checks || []).filter((c) => state.filter === "all" || (state.filter === "moves" ? c.moved : String(c.pillarId) === state.filter));
  return `<section class="panel th-panel" aria-labelledby="thEvH">
    <div class="panel-head"><h3 id="thEvH">Evidence log</h3>
      <label class="small">Show <select id="thFilter"><option value="all">Every check</option><option value="moves" ${state.filter === "moves" ? "selected" : ""}>Only status changes</option>
        ${(d.pillars || []).map((p, i) => `<option value="${p.id}" ${state.filter === String(p.id) ? "selected" : ""}>P${i + 1}: ${esc(p.text.slice(0, 50))}</option>`).join("")}</select></label></div>
    ${rows.length ? `<div class="table-wrap"><table class="data-table th-table"><thead><tr><th scope="col">Date</th><th scope="col">Pillar</th><th scope="col">By</th><th scope="col">Status</th><th scope="col">Reading and evidence</th></tr></thead><tbody>
      ${rows.slice(0, 150).map((c) => `<tr${c.moved ? ` class="th-moved"` : ""}>
        <td class="nowrap">${esc(day(c.createdAt))}</td>
        <td>${c.pillarId ? esc(names[c.pillarId] || "retired") : "Whole thesis"}</td>
        <td>${c.method === "member" ? esc(c.memberName || "member") : c.method === "ai" ? (c.runId ? `<a href="#/agents/runs/${Number(c.runId)}">AI</a>` : "AI") : "Rule"}</td>
        <td class="nowrap">${c.moved && c.prevStatus ? `${statusChip(c.prevStatus, { compact: true })} → ` : ""}${statusChip(c.status, { compact: !c.moved })}</td>
        <td>${esc(c.detail || "")}${(c.evidence || []).filter((e) => e.text && e.text !== c.detail).map((e) => `<blockquote class="small">${esc(e.text)}</blockquote>`).join("")}${(c.evidence || []).filter((e) => e.source_url).map((e) => (/^#\//.test(e.source_url) ? `<a class="small" href="${esc(e.source_url)}">source</a>` : `<a class="small" href="${safeUrl(e.source_url)}" target="_blank" rel="noopener">source</a>`)).join(" ")}</td>
      </tr>`).join("")}</tbody></table></div>` : `<p class="muted small">No checks yet. KPI rules run once a day; members and agents add the rest.</p>`}
  </section>`;
}

// Line-level diff: what each version added and removed relative to the one before it.
function lineDiff(a, b) {
  const A = String(a || "").split(/\n+/).map((s) => s.trim()).filter(Boolean), B = String(b || "").split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const sa = new Set(A), sb = new Set(B);
  return { added: B.filter((l) => !sa.has(l)), removed: A.filter((l) => !sb.has(l)) };
}

function versionsPanel(state) {
  const v = state.data.versions || [];
  if (!v.length && !state.data.original) return "";
  return `<section class="panel th-panel" aria-labelledby="thVerH">
    <h3 id="thVerH">Thesis versions</h3>
    ${state.data.original ? `<p class="small muted">Drift is measured against ${esc(state.data.original.from)}${state.data.original.at ? ` (${esc(day(state.data.original.at))})` : ""}.</p>` : ""}
    <ul class="th-list">${v.map((x, i) => {
      const prev = v[i + 1];
      const diff = state.diffFor === x.id ? lineDiff(prev?.text, x.text) : null;
      return `<li><div><strong>${esc(day(x.createdAt))}</strong> ${x.editedByName ? `by ${esc(x.editedByName)}` : ""}${x.targetPrice ? ` · target ${fmtUSD(x.targetPrice)}` : ""}${prev && prev.targetPrice !== x.targetPrice && prev.targetPrice ? ` <span class="muted">(was ${fmtUSD(prev.targetPrice)})</span>` : ""}
        <button type="button" class="btn-link small" data-th="diff" data-id="${x.id}" aria-expanded="${!!diff}">${prev ? "What changed" : "Show text"}</button></div>
        ${diff ? (prev ? `<div class="th-diff small">${diff.added.map((l) => `<p class="th-add"><span aria-hidden="true">+ </span><span class="sr-only">Added: </span>${esc(l)}</p>`).join("")}${diff.removed.map((l) => `<p class="th-del"><span aria-hidden="true">− </span><span class="sr-only">Removed: </span>${esc(l)}</p>`).join("")}${!diff.added.length && !diff.removed.length ? `<p class="muted">Only the target changed.</p>` : ""}</div>` : `<div class="th-diff small thesis-read">${esc(x.text)}</div>`) : ""}</li>`;
    }).join("")}</ul>
  </section>`;
}

// ---- The time-axis chart ----

function timelineSvg(d) {
  const pillars = d.pillars || [];
  const price = (d.priceHistory || []).map((p) => ({ t: ts(p.date), v: p.close })).filter((p) => Number.isFinite(p.t));
  const checks = (d.checks || []).map((c) => ({ ...c, t: ts(c.createdAt) })).filter((c) => Number.isFinite(c.t));
  const now = Date.now();
  const starts = [
    ...pillars.map((p) => ts(p.createdAt)), ...checks.map((c) => c.t), ...(d.versions || []).map((v) => ts(v.createdAt)),
    ...(d.marks || []).map((m) => ts(m.createdAt)), ...(d.healthHistory || []).map((h) => ts(h.date)),
  ].filter(Number.isFinite);
  let t0 = Math.min(...starts, now - 90 * DAY);
  if (price.length) t0 = Math.min(t0, price[0].t);
  const catDates = (d.catalysts || []).filter((c) => c.dueDate).map((c) => ts(c.dueDate));
  const t1 = Math.max(now, ...catDates.filter((t) => t < now + 120 * DAY));
  const W = 860, L = 44, R = 12, PH = 110, HH = 34, LANE = 20, gap = 10;
  const lanesTop = PH + gap + HH + gap;
  const H = lanesTop + Math.max(1, pillars.length) * LANE + 22;
  const x = (t) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const out = [];
  // Axis: month ticks.
  const first = new Date(t0); first.setUTCDate(1); first.setUTCHours(0, 0, 0, 0);
  const months = [];
  for (let m = new Date(first); m.getTime() <= t1; m.setUTCMonth(m.getUTCMonth() + 1)) if (m.getTime() >= t0) months.push(m.getTime());
  const step = Math.ceil(months.length / 8) || 1;
  months.forEach((t, i) => {
    out.push(`<line class="th-grid" x1="${x(t)}" x2="${x(t)}" y1="0" y2="${H - 18}"/>`);
    if (i % step === 0) out.push(`<text class="th-axis" x="${x(t) + 2}" y="${H - 6}">${new Date(t).toLocaleString("en-US", { month: "short", timeZone: "UTC" })}${new Date(t).getUTCMonth() === 0 ? ` ${new Date(t).getUTCFullYear()}` : ""}</text>`);
  });
  out.push(`<line class="th-now" x1="${x(now)}" x2="${x(now)}" y1="0" y2="${H - 18}"><title>Today</title></line>`);
  // Price.
  if (price.length > 1) {
    const vs = price.map((p) => p.v);
    const lo = Math.min(...vs, d.pitch?.bearPrice || Infinity), hi = Math.max(...vs);
    const y = (v) => 6 + (1 - (v - lo) / Math.max(1e-9, hi - lo)) * (PH - 12);
    out.push(`<path class="th-price" d="${price.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("")}"><title>Price ${fmtUSD(vs[0])} → ${fmtUSD(vs.at(-1))}</title></path>`);
    out.push(`<text class="th-axis" x="2" y="${y(hi) + 4}">${esc(fmtUSD(hi).replace(/\.\d\d$/, ""))}</text><text class="th-axis" x="2" y="${y(lo) + 4}">${esc(fmtUSD(lo).replace(/\.\d\d$/, ""))}</text>`);
    for (const [k, cls] of [["bearPrice", "th-bearline"], ["basePrice", "th-baseline"]]) {
      const v = d.pitch?.[k];
      if (v > 0 && v >= lo && v <= hi * 1.05) out.push(`<line class="${cls}" x1="${L}" x2="${W - R}" y1="${y(Math.min(v, hi))}" y2="${y(Math.min(v, hi))}"><title>${k === "bearPrice" ? "Bear" : "Base"} case ${fmtUSD(v)}</title></line>`);
    }
  } else {
    out.push(`<text class="th-axis" x="${L}" y="${PH / 2}">Price history unavailable</text>`);
  }
  // Markers on the price band.
  for (const v of d.versions || []) out.push(`<text class="th-mark" x="${x(ts(v.createdAt)) - 4}" y="${PH - 2}">✎<title>Thesis edited ${esc(day(v.createdAt))}${v.editedByName ? ` by ${esc(v.editedByName)}` : ""}</title></text>`);
  for (const t of d.tripwires || []) if (t.trippedAt) out.push(`<text class="th-mark th-mark-bad" x="${x(ts(t.trippedAt)) - 4}" y="12">✕<title>Tripwire tripped ${esc(day(t.trippedAt))}: ${esc(t.trippedDetail || "")}</title></text>`);
  for (const c of d.catalysts || []) if (c.dueDate) out.push(`<text class="th-mark th-cat-${esc(c.state)}" x="${x(ts(c.dueDate)) - 4}" y="${PH - 14}">◇<title>Catalyst ${esc(c.dueDate)} (${esc(c.state)}): ${esc(c.text)}</title></text>`);
  // Health band.
  const hy = (v) => PH + gap + (1 - v / 100) * HH;
  out.push(`<text class="th-axis" x="2" y="${PH + gap + HH / 2 + 4}">Health</text>`);
  const hh = (d.healthHistory || []).filter((h) => Number.isFinite(h.score));
  if (hh.length > 1) out.push(`<path class="th-healthline" d="${hh.map((h, i) => `${i ? "L" : "M"}${x(ts(h.date)).toFixed(1)},${hy(h.score).toFixed(1)}`).join("")}"><title>Health ${hh[0].score} → ${hh.at(-1).score}</title></path>`);
  else if (hh.length === 1) out.push(`<circle class="th-healthdot" cx="${x(ts(hh[0].date))}" cy="${hy(hh[0].score)}" r="2.5"><title>Health ${hh[0].score} on ${esc(hh[0].date)}</title></circle>`);
  out.push(`<line class="th-grid" x1="${L}" x2="${W - R}" y1="${hy(60)}" y2="${hy(60)}"/>`);
  // Pillar lanes: a status band from each status change, plus a mark per check.
  pillars.forEach((p, i) => {
    const y0 = lanesTop + i * LANE;
    out.push(`<text class="th-axis" x="2" y="${y0 + 13}">P${i + 1}<title>${esc(p.text)}</title></text>`);
    const mine = checks.filter((c) => c.pillarId === p.id).sort((a, b) => a.t - b.t);
    const moves = mine.filter((c) => c.moved);
    let from = ts(p.createdAt), st = "unknown";
    const seg = (a, b, s) => { if (b > a) out.push(`<rect class="th-lane ${STATUS[s]?.cls || "th-unknown"}" x="${x(a)}" y="${y0 + 4}" width="${Math.max(1, x(b) - x(a))}" height="${LANE - 8}" rx="2"><title>P${i + 1} ${esc(STATUS[s]?.label || s)} from ${esc(new Date(a).toISOString().slice(0, 10))}</title></rect>`); };
    for (const mv of moves) { seg(from, mv.t, st); from = mv.t; st = mv.status; }
    seg(from, now, moves.length ? st : p.status);
    for (const c of mine) {
      const cx = x(c.t), cy = y0 + LANE / 2, cls = `th-dot ${STATUS[c.status]?.cls || ""}`;
      const tip = `<title>${esc(day(c.createdAt))} ${c.method === "member" ? esc(c.memberName || "member") : c.method.toUpperCase()}: ${esc(STATUS[c.status]?.label || c.status)}. ${esc((c.detail || "").slice(0, 160))}</title>`;
      if (c.method === "rule") out.push(`<circle class="${cls}" cx="${cx}" cy="${cy}" r="2.5">${tip}</circle>`);
      else if (c.method === "ai") out.push(`<circle class="${cls} th-ring" cx="${cx}" cy="${cy}" r="4.5">${tip}</circle>`);
      else out.push(`<rect class="${cls} th-sq" x="${cx - 4}" y="${cy - 4}" width="8" height="8">${tip}</rect>`);
    }
  });
  if (!pillars.length) out.push(`<text class="th-axis" x="${L}" y="${lanesTop + 13}">No pillars yet: add some below to see them tracked here.</text>`);
  const summary = `Thesis timeline for ${d.symbol}: ${pillars.length} pillar${pillars.length === 1 ? "" : "s"}, ${checks.length} checks, ${(d.versions || []).length} thesis versions.`;
  return `<div class="th-tl-wrap"><svg class="th-tl" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(summary)}">${out.join("")}</svg></div>`;
}
