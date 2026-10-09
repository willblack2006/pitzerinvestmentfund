import { el, esc, api, can, pageHead, loading, lockedHint } from "../shared.js";
import { noteCard, wireNoteCards, openNoteDrawer } from "../notes.js";

export const title = "Notes";

const state = { scope: "all", q: "", symbol: "" };

export async function mount(container) {
  if (!can("member")) {
    container.innerHTML = pageHead("Notes") + `<div class="toolbar">${lockedHint("Sign in to keep personal notes.")}</div>`;
    return;
  }
  container.innerHTML = `
    ${pageHead("Notes", "Your notes on companies and pages, plus notes others shared with the club. Press N anywhere to write one, or highlight text to quote it.", `<button type="button" class="btn btn-primary" id="newNote">Write a note</button>`)}
    <section class="toolbar notes-toolbar">
      <div class="field-inline">
        <label for="noteSearch" class="sr-only">Search notes</label>
        <input id="noteSearch" type="search" placeholder="Search notes…" value="${esc(state.q)}" autocomplete="off" />
        <label for="noteSymbol" class="sr-only">Filter by ticker</label>
        <input id="noteSymbol" placeholder="Ticker" maxlength="12" value="${esc(state.symbol)}" autocomplete="off" style="width:110px" />
      </div>
      <div class="seg seg-sm" role="group" aria-label="Whose notes">
        ${[["all", "All"], ["mine", "Mine"], ["club", "Shared with club"]].map(([v, l]) => `<button type="button" class="seg-btn" data-scope="${v}" aria-pressed="${state.scope === v}">${l}</button>`).join("")}
      </div>
    </section>
    <div id="notesBody" class="page-pad notes-page"></div>`;
  const body = el("notesBody");
  let notes = [];
  const load = async () => {
    body.innerHTML = loading("Loading notes…");
    const q = new URLSearchParams({ scope: state.scope });
    if (state.q) q.set("q", state.q);
    if (state.symbol) q.set("symbol", state.symbol);
    try { notes = await api(`/api/notes?${q}`); } catch (err) { body.innerHTML = `<p class="muted">${esc(err.message)}</p>`; return; }
    if (!el("notesBody")) return;
    body.innerHTML = notes.length ? `<p class="muted small">${notes.length} note${notes.length === 1 ? "" : "s"}</p><div class="note-list">${notes.map((n) => noteCard(n)).join("")}</div>`
      : `<div class="empty-state"><p class="empty-title">${state.q || state.symbol ? "No notes match" : "No notes yet"}</p><p class="muted">Press <kbd>N</kbd> on any page, use “Write a note” on a company's research page, or highlight text and choose “Add to note”.</p></div>`;
  };
  wireNoteCards(body, () => notes, load);
  el("newNote").addEventListener("click", () => openNoteDrawer());
  let t = null;
  el("noteSearch").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value.trim(); load(); }, 250); });
  el("noteSymbol").addEventListener("change", (e) => { state.symbol = e.target.value.trim().toUpperCase(); load(); });
  container.querySelectorAll("[data-scope]").forEach((b) => b.addEventListener("click", () => {
    state.scope = b.dataset.scope;
    container.querySelectorAll("[data-scope]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    load();
  }));
  const onChange = () => { if (!el("notesBody")) { window.removeEventListener("pif:notes-changed", onChange); return; } load(); };
  window.addEventListener("pif:notes-changed", onChange);
  load();
}
