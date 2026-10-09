import { esc, api, can, loading, lockedHint } from "../../shared.js";
import { noteCard, wireNoteCards, openNoteDrawer, invalidateNoteCounts } from "../../notes.js";

// Notes on one company: yours (private or shared) plus notes others shared with the club.
// `compact` = the small panel on the Overview tab (latest 2 + a write button).
export async function render(c, { symbol, compact = false }) {
  if (!can("member")) {
    c.innerHTML = compact ? "" : `<div class="page-pad">${lockedHint("Sign in to keep notes on this company.")}</div>`;
    return;
  }
  c.innerHTML = loading("Loading notes…");
  let notes = [];
  const load = async () => {
    try { notes = await api(`/api/notes?symbol=${encodeURIComponent(symbol)}`); } catch (err) { c.innerHTML = `<p class="muted">${esc(err.message)}</p>`; return; }
    draw();
  };
  const draw = () => {
    const shown = compact ? notes.slice(0, 2) : notes;
    const mine = notes.filter((n) => n.mine).length, theirs = notes.length - mine;
    c.innerHTML = `
      <section class="panel ${compact ? "notes-compact" : "span-full"}" aria-labelledby="notes-h-${compact ? "c" : "t"}">
        <div class="panel-head">
          <h3 id="notes-h-${compact ? "c" : "t"}">Notes on ${esc(symbol)}</h3>
          <span class="muted small">${notes.length ? `${mine} yours${theirs ? ` · ${theirs} shared by others` : ""}` : "Only you see notes unless you share them"}</span>
        </div>
        <div class="notes-actions"><button type="button" class="btn btn-primary btn-sm" data-write>Write a note</button>${compact && notes.length > 2 ? ` <a class="small" href="#/research/${encodeURIComponent(symbol)}/notes">All ${notes.length} notes →</a>` : ""}</div>
        ${shown.length ? `<div class="note-list">${shown.map((n) => noteCard(n, { showSymbol: false })).join("")}</div>`
          : `<p class="muted small">${compact ? "No notes yet." : "No notes on this company yet. Tip: highlight any text on these pages and choose \"Add to note\" to quote it."}</p>`}
      </section>`;
    c.querySelector("[data-write]").addEventListener("click", () => openNoteDrawer());
  };
  wireNoteCards(c, () => notes, load);
  const onChange = (e) => { if (!c.isConnected) { window.removeEventListener("pif:notes-changed", onChange); return; } if (!e.detail?.symbol || e.detail.symbol === symbol) { invalidateNoteCounts(); load(); } };
  window.addEventListener("pif:notes-changed", onChange);
  await load();
}
