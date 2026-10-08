import {
  el, esc, api, fmtUSD, fmtPct, signed, loading, errorBox, toast, confirmAction, isUnlocked, getMember, requestMemberSignIn,
} from "../shared.js";
import { statusPill } from "./pitches.js";

export const title = (p) => (p.id ? `Pitch #${p.id}` : "New pitch");

const SECTIONS = [
  ["thesis", "Investment thesis", "What does the market misunderstand? Why now?", 6],
  ["catalysts", "Catalysts", "Specific events in the next 6–18 months that should close the gap (earnings, launches, buybacks…)", 3],
  ["risks", "Key risks", "What would make this thesis wrong? What would make us sell?", 3],
  ["valuation", "Valuation", "Multiples vs peers, DCF assumptions, how the target was derived", 3],
];

const BEAR_CHECKLIST = [
  "Checked the balance sheet for debt coming due or covenant risk",
  "Considered what a key competitor could do to undercut this thesis",
  "Checked insider selling and short interest",
  "Considered a recession / multiple-compression scenario, not just a company-specific miss",
  "Identified the single metric that would prove this thesis wrong fastest",
];

function parseChecklist(raw) {
  try { const v = JSON.parse(raw || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}

function scenarioBar(p, current) {
  const pts = [["Bear", p.bearPrice, "bear"], ["Base", p.basePrice, "base"], ["Bull", p.bullPrice, "bull"]].filter(([, v]) => v);
  if (!pts.length) return "";
  const ref = current || p.priceAtPitch;
  const all = [...pts.map(([, v]) => v), ref].filter(Boolean);
  const lo = Math.min(...all) * 0.95, hi = Math.max(...all) * 1.05;
  const pos = (v) => ((v - lo) / (hi - lo)) * 100;
  return `
    <div class="scenario" role="img" aria-label="${esc(`Scenarios: ${pts.map(([l, v]) => `${l} ${fmtUSD(v)}`).join(", ")}; current price ${ref ? fmtUSD(ref) : "unknown"}.`)}">
      <div class="scn-track">
        ${pts.map(([l, v, cls]) => `<span class="scn-mark scn-${cls}" style="left:${pos(v)}%"><span>${l}<br>${fmtUSD(v)}</span></span>`).join("")}
        ${ref ? `<span class="scn-mark scn-now" style="left:${pos(ref)}%"><span>Now<br>${fmtUSD(ref)}</span></span>` : ""}
      </div>
    </div>
    ${p.bullPrice && p.bearPrice && p.basePrice && ref ? `<p class="small muted">Reward/risk: ${((p.bullPrice - ref) / Math.max(0.01, ref - p.bearPrice)).toFixed(1)}× (upside to bull ÷ downside to bear)</p>` : ""}`;
}

function priceInfoHtml(current, basePrice) {
  if (!current) return `<span class="muted small">Current price unknown — type a ticker or check it on the research page.</span>`;
  const upside = basePrice ? basePrice / current - 1 : null;
  return `<span class="small">Current price: <strong>${fmtUSD(current)}</strong>${upside !== null ? ` · Upside to base case: ${signed(upside * 100, fmtPct(upside * 100))}` : ""}</span>`;
}

function editor(p, isNew, current) {
  const field = ([key, label, hint, rows]) => `
    <label class="field-block">${label}
      <textarea name="${key}" rows="${rows}" placeholder="${esc(hint)}">${esc(p[key] || "")}</textarea>
    </label>`;
  return `
    <form id="pitchForm" class="pitch-form" novalidate>
      <div class="form-row">
        <label>Ticker <input name="symbol" value="${esc(p.symbol || "")}" required maxlength="10" autocapitalize="characters" ${isNew ? "" : "readonly"} /></label>
        <label>Recommendation
          <select name="direction">${["buy", "add", "trim", "sell"].map((d) => `<option value="${d}" ${p.direction === d ? "selected" : ""}>${d[0].toUpperCase() + d.slice(1)}</option>`).join("")}</select>
        </label>
        <label>Proposed size (% of fund) <input name="sizePct" type="number" step="0.5" min="0" value="${p.sizePct ?? ""}" inputmode="decimal" /></label>
      </div>
      <div class="form-row">
        <label>Confidence (%) <input name="confidencePct" type="number" step="1" min="0" max="100" value="${p.confidencePct ?? ""}" inputmode="decimal" placeholder="e.g. 65" /></label>
        <label>Time horizon (months) <input name="horizonMonths" type="number" step="1" min="1" value="${p.horizonMonths ?? ""}" inputmode="numeric" placeholder="e.g. 12" /></label>
      </div>
      <p class="muted small">Confidence and horizon feed the fund's <a href="#/track-record">track record</a> — how often calls at a given confidence level actually play out.</p>
      <label class="field-block">One-line pitch <input name="title" value="${esc(p.title || "")}" maxlength="140" placeholder="e.g. Margin expansion the market isn't pricing in" /></label>
      ${SECTIONS.map(field).join("")}
      <fieldset class="scenarios">
        <legend>Price targets <span id="horizonLabel">${p.horizonMonths ? `(${p.horizonMonths}-month)` : "(set a time horizon above)"}</span></legend>
        <p id="pitchPriceInfo">${priceInfoHtml(current, p.basePrice)}</p>
        <div class="form-row">
          <label>Bear case ($) <input name="bearPrice" type="number" step="any" min="0" value="${p.bearPrice ?? ""}" inputmode="decimal" /></label>
          <label>Base case ($) <span class="req" aria-hidden="true">*</span><input name="basePrice" type="number" step="any" min="0" value="${p.basePrice ?? ""}" inputmode="decimal" /></label>
          <label>Bull case ($) <input name="bullPrice" type="number" step="any" min="0" value="${p.bullPrice ?? ""}" inputmode="decimal" /></label>
        </div>
        <div class="form-row form-row-3">
          <label>Bear scenario <textarea name="bearCase" rows="2">${esc(p.bearCase || "")}</textarea></label>
          <label>Base scenario <textarea name="baseCase" rows="2">${esc(p.baseCase || "")}</textarea></label>
          <label>Bull scenario <textarea name="bullCase" rows="2">${esc(p.bullCase || "")}</textarea></label>
        </div>
      </fieldset>
      <label class="field-block">Pre-mortem <span class="req" aria-hidden="true">*</span>
        <textarea name="preMortem" rows="3" placeholder="It's a year from now and this position lost 40%. Write the post-mortem: what happened?">${esc(p.preMortem || "")}</textarea>
      </label>
      <p class="muted small">Required before the pitch can go to a vote.</p>
      <fieldset class="bear-checklist">
        <legend>Bear-case checklist</legend>
        ${BEAR_CHECKLIST.map((label, i) => {
          const checked = parseChecklist(p.bearChecklist).includes(i);
          return `<label class="check"><input type="checkbox" name="bearChecklistItem" value="${i}" ${checked ? "checked" : ""} /> ${esc(label)}</label>`;
        }).join("")}
        <input type="hidden" name="bearChecklist" value="${esc(p.bearChecklist || "[]")}" />
      </fieldset>
      ${!getMember() ? `<label class="field-block">Author name <input name="author" value="${esc(p.author || "")}" placeholder="Your name" /></label>` : ""}
      <div class="dialog-actions">
        ${isNew ? `<a class="btn btn-ghost" href="#/pitches">Cancel</a>` : `<button type="button" class="btn btn-ghost" id="cancelEdit">Cancel</button>`}
        <button class="btn btn-primary">${isNew ? "Save draft" : "Save changes"}</button>
      </div>
    </form>`;
}

function readView(p) {
  const blocks = SECTIONS.filter(([k]) => p[k]?.trim()).map(([k, label]) => `<section class="pitch-section"><h3>${label}</h3><div class="prose">${esc(p[k])}</div></section>`).join("");
  const cases = [["Bear", p.bearCase, p.bearPrice], ["Base", p.baseCase, p.basePrice], ["Bull", p.bullCase, p.bullPrice]].filter(([, t, v]) => t?.trim() || v);
  const checklist = parseChecklist(p.bearChecklist);
  return `${blocks || `<p class="muted">No write-up yet.</p>`}
    ${cases.length ? `<section class="pitch-section"><h3>Scenarios</h3><div class="case-grid">${cases.map(([l, t, v]) => `<div class="case case-${l.toLowerCase()}"><strong>${l}${v ? ` · ${fmtUSD(v)}` : ""}</strong><p class="small">${esc(t || "")}</p></div>`).join("")}</div></section>` : ""}
    ${p.preMortem?.trim() ? `<section class="pitch-section"><h3>Pre-mortem</h3><p class="prose">${esc(p.preMortem)}</p></section>` : ""}
    ${checklist.length ? `<section class="pitch-section"><h3>Bear-case checklist</h3><ul class="link-list small">${BEAR_CHECKLIST.map((label, i) => checklist.includes(i) ? `<li>✓ ${esc(label)}</li>` : "").join("")}</ul></section>` : ""}`;
}

function votePanel(p) {
  const t = p.tally;
  const member = getMember();
  const mine = member && t.votes.find((v) => v.memberId === member.member.id);
  const pct = (n) => (t.total ? (n / t.total) * 100 : 0);
  return `
    <section class="panel vote-panel" aria-labelledby="vote-h">
      <h3 id="vote-h">Investment committee vote</h3>
      <div class="tally-bar" aria-hidden="true"><span class="t-yes" style="width:${pct(t.counts.yes)}%"></span><span class="t-no" style="width:${pct(t.counts.no)}%"></span><span class="t-abs" style="width:${pct(t.counts.abstain)}%"></span></div>
      <p><strong>${t.counts.yes}</strong> yes · <strong>${t.counts.no}</strong> no · <strong>${t.counts.abstain}</strong> abstain
        <span class="muted small">(${t.yesPct.toFixed(0)}% of decisive votes)</span></p>
      <p class="small ${t.quorumMet ? "" : "tone-warn"}">Rules: more than ${t.thresholdPct}% yes of yes+no votes, with at least ${t.quorum} votes cast. ${t.quorumMet ? (t.passing ? `<span class="tone-good">Currently passing.</span>` : `<span class="tone-bad">Currently failing.</span>`) : `Quorum not yet met (${t.total}/${t.quorum}).`}</p>
      ${p.status === "voting" ? (member ? `
        <form id="voteForm" class="vote-form">
          <fieldset><legend class="small">Your vote, ${esc(member.member.name)}${mine ? ` (currently <strong>${esc(mine.vote)}</strong>)` : ""}</legend>
            <div class="seg">
              ${["yes", "no", "abstain"].map((v) => `<label class="seg-opt"><input type="radio" name="vote" value="${v}" ${mine?.vote === v ? "checked" : ""} required /> <span>${v[0].toUpperCase() + v.slice(1)}</span></label>`).join("")}
            </div>
          </fieldset>
          <label class="field-block small">Comment (optional) <input name="comment" value="${esc(mine?.comment || "")}" maxlength="1000" placeholder="Why you voted this way" /></label>
          <button class="btn btn-primary btn-sm">${mine ? "Change vote" : "Cast vote"}</button>
        </form>` : `<p><button type="button" class="btn btn-primary btn-sm" data-member-signin>Sign in as a member to vote</button></p>`) : ""}
      ${t.votes.length ? `<ul class="vote-list">${t.votes.map((v) => `<li><span class="vote-chip v-${esc(v.vote)}">${esc(v.vote)}</span> <strong>${esc(v.name)}</strong>${v.comment ? ` <span class="muted small">— ${esc(v.comment)}</span>` : ""}</li>`).join("")}</ul>` : ""}
    </section>`;
}

function actionsFor(p) {
  const a = [];
  if (p.status === "draft") a.push(["open", "Open the vote", "btn-primary"], ["withdraw", "Withdraw", "btn-ghost"]);
  if (p.status === "voting") a.push(["close", "Close vote & record result", "btn-primary"], ["reopen", "Back to draft", "btn-ghost"], ["withdraw", "Withdraw", "btn-ghost"]);
  if (p.status === "approved") a.push(["executed", "Mark as executed", "btn-primary"]);
  if (p.status === "withdrawn") a.push(["reopen", "Reopen as draft", "btn-ghost"]);
  return a;
}

export async function mount(container, params) {
  const isNew = !params.id;
  let p;
  if (isNew) {
    let prefill = {};
    try { prefill = JSON.parse(sessionStorage.getItem("pif_pitch_prefill") || "{}"); } catch { /* ignore */ }
    if (prefill.symbol && params.symbol && prefill.symbol !== params.symbol.toUpperCase()) prefill = {};
    p = { symbol: (params.symbol || "").toUpperCase(), direction: "buy", author: (() => { try { return localStorage.getItem("pif_author") || ""; } catch { return ""; } })(), ...prefill };
  } else {
    container.innerHTML = loading("Loading pitch…");
    try {
      p = await api(`/api/pitches/${encodeURIComponent(params.id)}`);
    } catch (err) {
      container.innerHTML = `<div class="page-head"><h2>Pitch not found</h2></div>${errorBox(err.message, false)}<p class="page-pad"><a href="#/pitches">← All pitches</a></p>`;
      return;
    }
  }
  const canEdit = isUnlocked() || !!getMember();
  const editing = isNew || (container.dataset.editing === String(p.id) && ["draft", "voting"].includes(p.status));

  if (isNew && !canEdit) {
    container.innerHTML = `
      <div class="page-head"><h2>New pitch</h2></div>
      <div class="page-pad"><p>Pitches are written under a member's name.</p>
        <p><button type="button" class="btn btn-primary" data-member-signin>Sign in as a member</button> or <button type="button" class="btn btn-ghost" data-unlock>unlock editing</button>.</p>
        <p><a href="#/pitches">← All pitches</a></p></div>`;
    return;
  }

  let current = p.currentPrice;
  if (isNew && p.symbol && !current) {
    try { current = (await api(`/api/quotes?symbols=${encodeURIComponent(p.symbol)}`)).quotes?.[p.symbol]?.price ?? null; } catch { /* leave unknown */ }
  }
  const since = current && p.priceAtPitch ? current / p.priceAtPitch - 1 : null;
  const baseUpside = p.basePrice && (current || p.priceAtPitch) ? p.basePrice / (current || p.priceAtPitch) - 1 : null;

  container.innerHTML = `
    <div class="page-head">
      <div>
        <p class="crumb small"><a href="#/pitches">← All pitches</a></p>
        <h2>${isNew ? "New pitch" : `<span class="pitch-dir dir-${esc(p.direction)}">${esc(p.direction)}</span> ${esc(p.symbol)}`}${!isNew && p.title ? ` <span class="company-name">${esc(p.title)}</span>` : ""}</h2>
        ${!isNew ? `<p class="muted page-desc">${statusPill(p.status)} by ${esc(p.author)} · ${esc(p.createdAt.slice(0, 10))} · <a href="#/research/${encodeURIComponent(p.symbol)}">Research ${esc(p.symbol)}</a></p>` : `<p class="muted page-desc">Saved as a draft; open the vote when it's ready for the committee.</p>`}
      </div>
      ${!isNew && canEdit && !editing ? `<div class="page-actions">
        ${["draft", "voting"].includes(p.status) ? `<button class="btn btn-ghost" id="editBtn">Edit</button>` : ""}
        ${actionsFor(p).map(([act, label, cls]) => `<button class="btn ${cls}" data-action="${act}">${label}</button>`).join("")}
        ${p.status === "draft" ? `<button class="btn btn-danger" id="deleteBtn">Delete</button>` : ""}
      </div>` : ""}
    </div>
    ${!isNew ? `
    <section class="summary" aria-label="Pitch numbers">
      <div class="stat"><div class="label">Price at pitch</div><div class="value">${p.priceAtPitch ? fmtUSD(p.priceAtPitch) : "—"}</div><div class="sub">${esc(p.createdAt.slice(0, 10))}</div></div>
      <div class="stat"><div class="label">Price now</div><div class="value">${current ? fmtUSD(current) : "—"}</div><div class="sub">${since !== null ? `${signed(since * 100, fmtPct(since * 100))} since pitch` : ""}</div></div>
      <div class="stat"><div class="label">Base-case target</div><div class="value">${p.basePrice ? fmtUSD(p.basePrice) : "—"}</div><div class="sub">${baseUpside !== null ? `${fmtPct(baseUpside * 100)} from here` : ""}</div></div>
      <div class="stat"><div class="label">Proposed size</div><div class="value">${p.sizePct ? `${p.sizePct}%` : "—"}</div><div class="sub">of the fund</div></div>
      <div class="stat"><div class="label">Confidence</div><div class="value">${p.confidencePct != null ? `${p.confidencePct}%` : "—"}</div><div class="sub">${p.horizonMonths ? `${p.horizonMonths}-month horizon` : ""}</div></div>
    </section>` : ""}
    <div class="research-layout">
      <div class="research-main">
        <section class="panel">${editing ? editor(p, isNew, current) : `${scenarioBar(p, current)}${readView(p)}`}</section>
      </div>
      ${!isNew ? `<aside class="research-side">${votePanel(p)}
        ${p.status === "approved" ? `<section class="panel"><h3>Next step</h3><p class="small">Place the trade, then record it under <a href="#/transactions">Transactions</a> and mark this pitch executed.</p></section>` : ""}
      </aside>` : ""}
    </div>`;

  el("editBtn")?.addEventListener("click", () => { container.dataset.editing = String(p.id); mount(container, params); });
  el("cancelEdit")?.addEventListener("click", () => { delete container.dataset.editing; mount(container, params); });

  if (editing) {
    const form = el("pitchForm");
    let liveCurrent = current;
    const refreshPriceInfo = () => {
      const info = el("pitchPriceInfo");
      if (info) info.innerHTML = priceInfoHtml(liveCurrent, Number(form.basePrice.value) || null);
      const label = el("horizonLabel");
      if (label) label.textContent = form.horizonMonths.value ? `(${form.horizonMonths.value}-month)` : "(set a time horizon above)";
    };
    form.basePrice.addEventListener("input", refreshPriceInfo);
    form.horizonMonths.addEventListener("input", refreshPriceInfo);
    let lastLookup = "";
    form.symbol.addEventListener("blur", async () => {
      const sym = form.symbol.value.trim().toUpperCase();
      if (!sym || sym === lastLookup) return;
      lastLookup = sym;
      try {
        liveCurrent = (await api(`/api/quotes?symbols=${encodeURIComponent(sym)}`)).quotes?.[sym]?.price ?? null;
      } catch { liveCurrent = null; }
      if (form.symbol.value.trim().toUpperCase() === sym) refreshPriceInfo();
    });
  }

  el("pitchForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const checked = [...e.target.querySelectorAll('[name="bearChecklistItem"]:checked')].map((x) => Number(x.value));
    const body = Object.fromEntries(new FormData(e.target).entries());
    delete body.bearChecklistItem;
    body.bearChecklist = JSON.stringify(checked);
    if (!body.symbol?.trim()) {
      e.target.symbol.setAttribute("aria-invalid", "true");
      e.target.symbol.focus();
      return;
    }
    try { if (body.author) localStorage.setItem("pif_author", body.author); } catch { /* ignore */ }
    try {
      const saved = isNew
        ? await api("/api/pitches", { method: "POST", body: JSON.stringify(body) })
        : await api(`/api/pitches/${p.id}`, { method: "PUT", body: JSON.stringify(body) });
      try { sessionStorage.removeItem("pif_pitch_prefill"); } catch { /* ignore */ }
      delete container.dataset.editing;
      toast(isNew ? "Draft saved." : "Pitch updated.", { type: "success" });
      if (isNew) location.hash = `#/pitches/${saved.id}`;
      else mount(container, params);
    } catch (err) {
      toast(err.message, { type: "error" });
    }
  });

  container.querySelectorAll("[data-action]").forEach((b) => b.addEventListener("click", async () => {
    const action = b.dataset.action;
    if (action === "withdraw" || action === "close") {
      const ok = await confirmAction({
        title: action === "close" ? "Close voting?" : "Withdraw this pitch?",
        body: action === "close" ? "The result is recorded as approved or rejected based on the current votes." : "It will be kept for the record but no longer voted on.",
        confirmLabel: action === "close" ? "Close vote" : "Withdraw",
      });
      if (!ok) return;
    }
    try {
      const r = await api(`/api/pitches/${p.id}/status`, { method: "POST", body: JSON.stringify({ action }) });
      toast(`Pitch is now ${r.status}.`, { type: "success" });
      mount(container, params);
    } catch (err) {
      toast(err.message, { type: "error" });
    }
  }));

  el("deleteBtn")?.addEventListener("click", async () => {
    if (!(await confirmAction({ title: "Delete this draft?", body: "This can't be undone.", confirmLabel: "Delete", danger: true }))) return;
    try {
      await api(`/api/pitches/${p.id}`, { method: "DELETE" });
      toast("Draft deleted.");
      location.hash = "#/pitches";
    } catch (err) { toast(err.message, { type: "error" }); }
  });

  el("voteForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    if (!f.get("vote")) { toast("Choose yes, no or abstain.", { type: "error" }); return; }
    try {
      await api(`/api/pitches/${p.id}/vote`, { method: "POST", body: JSON.stringify({ vote: f.get("vote"), comment: f.get("comment") }) });
      toast("Vote recorded.", { type: "success" });
      mount(container, params);
    } catch (err) {
      if (err.code === "member_required") requestMemberSignIn();
      toast(err.message, { type: "error" });
    }
  });
}
