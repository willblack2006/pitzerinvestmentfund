// Research Overview panel: recent federal contract actions (USAspending.gov). Low-evidence
// context, shown only for defense, health and IT names or when there are awards to show.
import { esc, api, safeUrl, fmtMoneyCompact, fmtRatio, loading } from "../shared.js";

export function govContractsPanelHtml() {
  return `
    <section class="panel" aria-labelledby="gov-h" id="govPanel" hidden>
      <h3 id="gov-h">Government contracts</h3>
      <div id="govBody">${loading("Checking USAspending.gov…")}</div>
    </section>`;
}

export async function loadGovContracts(symbol) {
  const panel = document.getElementById("govPanel");
  if (!panel) return;
  let r;
  try {
    r = await api(`/api/research/${encodeURIComponent(symbol)}/gov-contracts`);
  } catch {
    panel.remove(); // an optional panel: drop it rather than show an error
    return;
  }
  const box = document.getElementById("govBody");
  if (!box) return;
  if (!r.available || (!r.relevant && !r.count)) { panel.remove(); return; }
  panel.hidden = false;
  if (!r.count) {
    box.innerHTML = `<p class="muted small">No federal contract actions in the last ${r.days} days.</p>`;
    return;
  }
  box.innerHTML = `
    <dl class="facts small">
      <dt>Last ${r.days} days</dt><dd>${fmtMoneyCompact(r.total)} across ${r.count}${r.count >= 100 ? "+" : ""} actions</dd>
      ${r.pctOfRevenue != null ? `<dt>Share of annual revenue</dt><dd>${fmtRatio(r.pctOfRevenue, 2)}</dd>` : ""}
      ${r.topAgencies.length ? `<dt>Top agency</dt><dd>${esc(r.topAgencies[0].agency)}</dd>` : ""}
    </dl>
    <ul class="link-list small">${r.top.slice(0, 3).map((a) => `
      <li>${a.url ? `<a href="${safeUrl(a.url)}" target="_blank" rel="noopener">${fmtMoneyCompact(a.amount)}<span class="sr-only"> (opens USAspending.gov in new tab)</span></a>` : fmtMoneyCompact(a.amount)}
        · ${esc(a.agency || "")} · ${esc(a.date || "")}
        <div class="muted">${esc((a.description || "").slice(0, 120))}${(a.description || "").length > 120 ? "…" : ""}</div></li>`).join("")}</ul>
    <p class="muted small">Low-evidence context: awards are public news and largely priced in by the time they post. Defense Department data posts with a 90-day delay. Matched by company name ("${esc(r.searchText)}"), which can include subsidiaries.</p>`;
}
