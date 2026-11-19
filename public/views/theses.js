// Thesis board (#/theses): every holding's thesis at a glance. Rows are holdings (and any name
// with pillars), columns are pillars P1..Pn with status chips, then the health score, its
// six-month sparkline, drift and catalysts. Filters pick out what needs attention.
import { esc, api, pageHead, errorState, bindRetry, skeleton, emptyState, can, lockedHint } from "../shared.js";
import { statusChip, healthBadge, sparkline, RANK } from "./research/thesisParts.js";

export const title = "Theses";

const FILTERS = [
  ["all", "All"],
  ["weakening", "Weakening"],
  ["stale", "Stale or unchecked"],
  ["drift", "Drifted"],
  ["none", "No pillars"],
];

let filter = "all";
let sort = "health";

function trend(history) {
  const h = (history || []).filter((x) => Number.isFinite(x.score));
  if (h.length < 2) return 0;
  const back = h.find((x) => Date.parse(x.date) >= Date.now() - 30 * 864e5) || h[0];
  return h.at(-1).score - back.score;
}

function matches(r) {
  if (filter === "weakening") return ["weakened", "broken", "watch"].includes(r.status) || trend(r.history) < -5;
  if (filter === "stale") return r.pillars.length && (r.health.overdue + r.health.unknown > 0 || r.health.adjustments?.some((a) => a.key === "stale"));
  if (filter === "drift") return r.drift?.drifted;
  if (filter === "none") return !r.pillars.length;
  return true;
}

function row(r, maxP) {
  const t = trend(r.history);
  const cells = [];
  for (let i = 0; i < maxP; i++) {
    const p = r.pillars[i];
    cells.push(`<td class="th-cell">${p ? `<a href="#/research/${encodeURIComponent(r.symbol)}/thesis" title="${esc(p.text)}">${statusChip(p.status, { compact: true })}</a>` : ""}</td>`);
  }
  const cs = r.catalysts?.stats || {};
  const next = r.catalysts?.next?.[0];
  return `<tr>
    <th scope="row"><a href="#/research/${encodeURIComponent(r.symbol)}/thesis"><strong>${esc(r.symbol)}</strong></a>${r.owned ? "" : ` <span class="badge">not held</span>`}</th>
    <td>${statusChip(r.status)}</td>
    ${cells.join("")}
    <td class="num">${healthBadge(r.health)}${t ? ` <span class="small ${t > 0 ? "gain-pos" : "gain-neg"}"><span aria-hidden="true">${t > 0 ? "▲" : "▼"}</span><span class="sr-only">${t > 0 ? "up" : "down"}</span>${Math.abs(Math.round(t))}</span>` : ""}</td>
    <td>${sparkline(r.history)}</td>
    <td>${r.drift?.drifted ? `<span class="badge badge-warn" title="Compared with ${esc(r.drift.from)}">Drift</span>` : r.drift ? `<span class="muted small">${Math.round((r.drift.similarity || 0) * 100)}% same</span>` : `<span class="muted small">—</span>`}</td>
    <td class="small">${next ? `${esc(next.dueDate || "no date")}${next.state === "late" ? ` <span class="badge badge-warn">late</span>` : ""}<div class="muted">${esc(next.text.slice(0, 50))}</div>` : cs.due ? `${cs.onTime}/${cs.due} on time` : `<span class="muted">—</span>`}</td>
  </tr>`;
}

function render(c, rows) {
  const shown = rows.filter(matches).sort((a, b) => (sort === "symbol" ? a.symbol.localeCompare(b.symbol) : (a.health.score ?? 101) - (b.health.score ?? 101) || RANK[a.status] - RANK[b.status]));
  const maxP = Math.max(1, ...shown.map((r) => r.pillars.length));
  const counts = Object.fromEntries(FILTERS.map(([k]) => [k, rows.filter((r) => { const f = filter; filter = k; const m = matches(r); filter = f; return m; }).length]));
  c.innerHTML = `
    ${pageHead("Theses", "Each holding's thesis split into pillars, checked over time by KPI rules, agents and members. Lowest health first.")}
    <div class="page-pad">
      <div class="th-toolbar">
        <div class="segmented" role="group" aria-label="Filter">${FILTERS.map(([k, l]) => `<button type="button" class="seg-btn${filter === k ? " active" : ""}" aria-pressed="${filter === k}" data-filter="${k}">${l} <span class="muted small">${counts[k]}</span></button>`).join("")}</div>
        <label class="small">Sort <select id="thSort"><option value="health" ${sort === "health" ? "selected" : ""}>Health, lowest first</option><option value="symbol" ${sort === "symbol" ? "selected" : ""}>Ticker</option></select></label>
      </div>
      ${shown.length ? `<div class="table-wrap"><table class="data-table th-board">
        <caption class="sr-only">Thesis status by holding and pillar</caption>
        <thead><tr><th scope="col">Ticker</th><th scope="col">Overall</th>${Array.from({ length: maxP }, (_, i) => `<th scope="col" class="th-cell">P${i + 1}</th>`).join("")}<th scope="col" class="num">Health</th><th scope="col">6 months</th><th scope="col">Drift</th><th scope="col">Next catalyst</th></tr></thead>
        <tbody>${shown.map((r) => row(r, maxP)).join("")}</tbody></table></div>`
        : emptyState({ icon: "target", title: filter === "all" ? "No holdings to track yet" : "Nothing matches this filter", body: filter === "all" ? "Add holdings, then split each thesis into pillars on its Research → Thesis tab." : "Try another filter." })}
      <p class="muted small">● intact · ◆ watch · ▼ weakened · ✕ broken · ○ unknown. Health = weighted share of pillars intact (watch 75%, weakened 50%, broken 0), leaving out unchecked or overdue pillars, minus points for a stale thesis, a price near the bear case, or a tripped exit tripwire. Hover a score for the reasons.</p>
    </div>`;
  c.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => { filter = b.dataset.filter; render(c, rows); c.querySelector(`[data-filter="${filter}"]`)?.focus(); }));
  c.querySelector("#thSort")?.addEventListener("change", (e) => { sort = e.target.value; render(c, rows); c.querySelector("#thSort")?.focus(); });
}

export async function mount(c) {
  if (!can("member")) {
    c.innerHTML = `${pageHead("Theses", "Each holding's thesis, checked over time.")}<div class="page-pad">${lockedHint("Sign in to see the thesis board.")}</div>`;
    return;
  }
  c.innerHTML = `${pageHead("Theses", "Loading…")}<div class="page-pad">${skeleton("rows", { rows: 6, label: "Loading theses" })}</div>`;
  try {
    const { rows } = await api("/api/theses");
    render(c, rows);
  } catch (e) {
    c.innerHTML = `${pageHead("Theses")}<div class="page-pad">${errorState({ detail: e.message, retryId: "thRetry" })}</div>`;
    bindRetry(c, "thRetry", () => mount(c));
  }
}
