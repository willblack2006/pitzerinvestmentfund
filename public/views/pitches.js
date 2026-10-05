import { esc, api, fmtUSD, fmtPct, signed, pageHead, loading, errorBox, subTabs, getMember } from "../shared.js";
import { IDEAS_TABS } from "./screener.js";

export const title = "Pitches";

const STATUS_ORDER = ["voting", "draft", "approved", "executed", "rejected", "withdrawn"];
const STATUS_LABEL = { voting: "Voting open", draft: "Drafts", approved: "Approved — awaiting trade", executed: "Executed", rejected: "Rejected", withdrawn: "Withdrawn" };

export function statusPill(s) {
  return `<span class="status-pill status-${esc(s)}">${esc(s)}</span>`;
}

export async function mount(container) {
  container.innerHTML = subTabs(IDEAS_TABS, "#/pitches") + loading("Loading pitches…");
  let rows;
  try {
    rows = await api("/api/pitches");
  } catch (err) {
    container.innerHTML = subTabs(IDEAS_TABS, "#/pitches") + pageHead("Pitches") + errorBox(`Could not load pitches: ${err.message}`);
    return;
  }
  const member = getMember();
  const groups = STATUS_ORDER.map((s) => [s, rows.filter((r) => r.status === s)]).filter(([, list]) => list.length);

  container.innerHTML = `
    ${subTabs(IDEAS_TABS, "#/pitches")}
    ${pageHead("Pitches", "Stock pitches move from draft to an investment-committee vote to execution. Every pitch records the price when it was made, so calls can be graded later.",
      `<a class="btn btn-primary" href="#/pitches/new">+ New pitch</a>`)}
    ${!member ? `<p class="notice page-pad-notice">Members vote on pitches. <button type="button" class="btn-link" data-member-signin>Sign in as a member</button> to vote or write pitches under your name.</p>` : ""}
    ${groups.length ? groups.map(([status, list]) => `
      <section class="pitch-group" aria-labelledby="g-${status}">
        <h3 id="g-${status}" class="group-title">${STATUS_LABEL[status]} <span class="count-pill">${list.length}</span></h3>
        <ul class="pitch-cards">
          ${list.map((p) => {
            const upside = p.basePrice && p.priceAtPitch ? p.basePrice / p.priceAtPitch - 1 : null;
            return `<li class="pitch-card">
              <a href="#/pitches/${p.id}" class="pitch-link">
                <span class="pitch-dir dir-${esc(p.direction)}">${esc(p.direction)}</span>
                <strong>${esc(p.symbol)}</strong> ${p.title ? `<span class="muted">— ${esc(p.title)}</span>` : ""}
              </a>
              <div class="muted small">${esc(p.author)} · ${esc(p.createdAt.slice(0, 10))}${p.priceAtPitch ? ` · pitched at ${fmtUSD(p.priceAtPitch)}` : ""}${upside !== null ? ` · base case ${fmtPct(upside * 100)}` : ""}</div>
              ${p.status === "voting" ? `<div class="small">${p.voteCounts.yes} yes · ${p.voteCounts.no} no · ${p.voteCounts.abstain} abstain ${p.passing ? `<span class="tone-good">(passing)</span>` : ""}</div>` : ""}
            </li>`;
          }).join("")}
        </ul>
      </section>`).join("") : `
      <div class="empty-state page-pad-panel">
        <p class="empty-title">No pitches yet</p>
        <p class="muted">Start one from any research page (“Pitch it”), or from the DCF on the Valuation tab to carry your target over.</p>
        <p><a class="btn btn-primary" href="#/pitches/new">Write the first pitch</a></p>
      </div>`}`;
}
