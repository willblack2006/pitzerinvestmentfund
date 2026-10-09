// Personal notes, available everywhere: a floating "Note" button (and the N key) opens a drawer
// that already knows which company/page you're on; highlighted text can be quoted into it.
// Also exports the note card used by the Research notes panel and the My notes page.
import { esc, api, toast, can, currentMember, confirmAction } from "./shared.js";

const DRAFT_KEY = "pif_note_draft";
const SITE = " · Pitzer Investment Fund";

// Where you are right now: the ticker (on research pages) and an in-app link back.
export function pageContext() {
  const hash = location.hash || "#/";
  const m = hash.match(/^#\/research\/([^/?]+)/);
  return {
    symbol: m ? decodeURIComponent(m[1]).toUpperCase() : null,
    pageRef: hash,
    pageTitle: document.title.replace(SITE, ""),
  };
}

// Plain text, line breaks kept, $TICKER linked to research. Everything else escaped.
export function noteText(s) {
  return esc(s || "").replace(/\$([A-Z][A-Z0-9.\-]{0,9})\b/g, (_, t) => `<a href="#/research/${encodeURIComponent(t)}">$${t}</a>`).replace(/\n/g, "<br>");
}

const when = (iso) => {
  const d = new Date(`${iso.replace(" ", "T")}Z`);
  const days = Math.floor((Date.now() - d) / 864e5);
  return days < 1 ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : days < 7 ? `${days}d ago` : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: days > 300 ? "numeric" : undefined });
};

export function noteCard(n, { showSymbol = true } = {}) {
  return `<article class="note-card ${n.pinned ? "pinned" : ""}" data-note="${n.id}">
    <header class="note-head">
      ${showSymbol && n.symbol ? `<a class="symbol-cell" href="#/research/${encodeURIComponent(n.symbol)}">${esc(n.symbol)}</a>` : ""}
      <span class="muted small">${n.mine ? "You" : esc(n.authorName)} · ${esc(when(n.updatedAt))}${n.visibility === "club" ? ` · <span class="badge badge-watch">Shared with club</span>` : ""}${n.pinned && n.mine ? " · 📌" : ""}</span>
    </header>
    ${n.quote ? `<blockquote class="note-quote">${esc(n.quote)}</blockquote>` : ""}
    ${n.body ? `<div class="note-body">${noteText(n.body)}</div>` : ""}
    <footer class="note-foot small">
      ${n.pageRef ? `<a href="${esc(n.pageRef)}" class="muted-link">${esc(n.pageTitle || "Open page")}</a>` : ""}
      ${(n.tags || []).map((t) => `<span class="note-tag">#${esc(t)}</span>`).join("")}
      ${n.mine ? `<span class="note-actions">
        <button type="button" class="btn-link small" data-note-pin="${n.id}">${n.pinned ? "Unpin" : "Pin"}</button>
        <button type="button" class="btn-link small" data-note-share="${n.id}" data-to="${n.visibility === "club" ? "private" : "club"}">${n.visibility === "club" ? "Make private" : "Share with club"}</button>
        <button type="button" class="btn-link small" data-note-edit="${n.id}">Edit</button>
        <button type="button" class="btn-link small danger-link" data-note-del="${n.id}">Delete</button>
      </span>` : currentMember()?.isAdmin ? `<span class="note-actions"><button type="button" class="btn-link small danger-link" data-note-del="${n.id}">Remove</button></span>` : ""}
    </footer>
  </article>`;
}

// Wires pin/share/edit/delete on note cards inside `root`; `refresh` re-renders after a change.
export function wireNoteCards(root, notes, refresh) {
  root.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-note-pin],[data-note-share],[data-note-edit],[data-note-del]");
    if (!b) return;
    const id = b.dataset.notePin || b.dataset.noteShare || b.dataset.noteEdit || b.dataset.noteDel;
    const n = notes().find((x) => String(x.id) === id);
    try {
      if (b.dataset.notePin) await api(`/api/notes/${id}`, { method: "PUT", body: JSON.stringify({ pinned: !n.pinned }) });
      if (b.dataset.noteShare) await api(`/api/notes/${id}`, { method: "PUT", body: JSON.stringify({ visibility: b.dataset.to }) });
      if (b.dataset.noteDel) {
        if (!(await confirmAction({ title: "Delete this note?", body: "This can't be undone.", confirmLabel: "Delete", danger: true }))) return;
        await api(`/api/notes/${id}`, { method: "DELETE" });
        toast("Note deleted.");
      }
      if (b.dataset.noteEdit) { openNoteDrawer({ edit: n }); return; }
      invalidateNoteCounts();
      refresh();
    } catch (err) { toast(err.message, { type: "error" }); }
  });
}

// ---- Note markers next to tickers (Holdings, Watchlist, Today) ----

let counts = null;
export function invalidateNoteCounts() { counts = null; }
export async function noteCounts() {
  if (!can("member")) return {};
  if (!counts) counts = api("/api/notes/symbols").catch(() => ({}));
  return counts;
}
export function noteMarker(symbol, map) {
  const c = map?.[symbol];
  if (!c) return "";
  return `<a class="note-marker" href="#/research/${encodeURIComponent(symbol)}/notes" title="${c.mine ? `${c.mine} of your notes` : ""}${c.mine && c.total > c.mine ? " · " : ""}${c.total > c.mine ? `${c.total - c.mine} shared by others` : ""}" aria-label="${c.total} note${c.total === 1 ? "" : "s"} on ${esc(symbol)}">📝</a>`;
}

// ---- The drawer ----

let drawer = null;
let editing = null; // note being edited, else null

function ensureDrawer() {
  if (drawer) return drawer;
  drawer = document.createElement("dialog");
  drawer.id = "noteDrawer";
  drawer.className = "note-drawer";
  drawer.setAttribute("aria-labelledby", "noteDrawerTitle");
  drawer.innerHTML = `
    <form id="noteForm" class="stack-form" method="dialog">
      <div class="drawer-head"><h2 id="noteDrawerTitle">New note</h2><button type="button" class="btn-link" id="noteClose" aria-label="Close notes">✕</button></div>
      <label>Company (optional) <input name="symbol" maxlength="12" autocomplete="off" placeholder="Ticker, e.g. COST" /></label>
      <div id="noteQuoteBox"></div>
      <label>Note <textarea name="body" rows="7" maxlength="10000" placeholder="What did you notice? Use $TICKER to link a company."></textarea></label>
      <label>Tags (optional) <input name="tags" maxlength="120" placeholder="earnings, valuation" autocomplete="off" /></label>
      <label class="check"><input type="checkbox" name="club" /> Share with the club</label>
      <p class="muted small" id="noteWhere"></p>
      <div class="dialog-actions"><a href="#/notes" class="btn btn-ghost" id="noteAll">All my notes</a><button class="btn btn-primary" id="noteSave">Save note</button></div>
    </form>
    <div id="noteRecent"></div>`;
  document.body.append(drawer);
  const form = drawer.querySelector("form");
  drawer.querySelector("#noteClose").addEventListener("click", closeDrawer);
  drawer.querySelector("#noteAll").addEventListener("click", closeDrawer);
  drawer.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); closeDrawer(); } });
  form.addEventListener("input", saveDraft);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const body = {
      symbol: f.get("symbol"), body: f.get("body"), tags: f.get("tags"),
      visibility: f.get("club") ? "club" : "private",
      quote: drawer.dataset.quote || "", pageRef: drawer.dataset.pageRef || "", pageTitle: drawer.dataset.pageTitle || "",
    };
    try {
      if (editing) await api(`/api/notes/${editing.id}`, { method: "PUT", body: JSON.stringify(body) });
      else await api("/api/notes", { method: "POST", body: JSON.stringify(body) });
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
      invalidateNoteCounts();
      toast(editing ? "Note updated." : "Note saved.", { type: "success" });
      closeDrawer();
      window.dispatchEvent(new CustomEvent("pif:notes-changed", { detail: { symbol: body.symbol?.toUpperCase() || null } }));
    } catch (err) { toast(err.message, { type: "error" }); }
  });
  drawer.querySelector("#noteQuoteBox").addEventListener("click", (e) => {
    if (e.target.closest("[data-drop-quote]")) { drawer.dataset.quote = ""; renderQuote(); saveDraft(); }
  });
  return drawer;
}

function renderQuote() {
  const q = drawer.dataset.quote;
  drawer.querySelector("#noteQuoteBox").innerHTML = q
    ? `<blockquote class="note-quote">${esc(q)}</blockquote><button type="button" class="btn-link small" data-drop-quote>Remove quote</button>` : "";
}

function saveDraft() {
  if (editing) return;
  const f = new FormData(drawer.querySelector("form"));
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ symbol: f.get("symbol"), body: f.get("body"), tags: f.get("tags"), quote: drawer.dataset.quote || "" })); } catch { /* ignore */ }
}

let returnFocus = null;
function closeDrawer() {
  drawer?.close();
  editing = null;
  if (returnFocus?.isConnected) returnFocus.focus();
}

// Opens the drawer. `quote` comes from highlighted text; `edit` is an existing note.
export async function openNoteDrawer({ quote = "", edit = null } = {}) {
  if (!can("member")) { window.dispatchEvent(new CustomEvent("pif:request-signin")); return; }
  ensureDrawer();
  returnFocus = document.activeElement;
  editing = edit;
  const ctx = pageContext();
  const form = drawer.querySelector("form");
  let draft = {};
  try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}"); } catch { /* ignore */ }
  const src = edit || {};
  form.symbol.value = edit ? src.symbol || "" : ctx.symbol || draft.symbol || "";
  form.body.value = edit ? src.body : (!quote && draft.body) || "";
  form.tags.value = edit ? (src.tags || []).join(", ") : (!quote && draft.tags) || "";
  form.club.checked = edit ? src.visibility === "club" : false;
  drawer.dataset.quote = edit ? src.quote || "" : quote || (!quote && draft.quote) || "";
  drawer.dataset.pageRef = edit ? src.pageRef : ctx.pageRef;
  drawer.dataset.pageTitle = edit ? src.pageTitle : ctx.pageTitle;
  drawer.querySelector("#noteDrawerTitle").textContent = edit ? "Edit note" : "New note";
  drawer.querySelector("#noteSave").textContent = edit ? "Save changes" : "Save note";
  drawer.querySelector("#noteWhere").textContent = drawer.dataset.pageTitle ? `Linked to: ${drawer.dataset.pageTitle}` : "";
  renderQuote();
  if (!drawer.open) drawer.show(); // non-modal: you can keep reading the page while you write
  form.body.focus();
  // Your recent notes on this company, so you don't repeat yourself.
  const sym = form.symbol.value.trim().toUpperCase();
  const recent = drawer.querySelector("#noteRecent");
  recent.innerHTML = "";
  if (sym && !edit) {
    try {
      const list = (await api(`/api/notes?symbol=${encodeURIComponent(sym)}&limit=3`));
      if (list.length) recent.innerHTML = `<p class="pf-sub">Recent notes on ${esc(sym)}</p>${list.map((n) => noteCard(n, { showSymbol: false })).join("")}`;
    } catch { /* optional */ }
  }
}

// Floating button + "N" shortcut (signed-in members only).
export function initNotes() {
  const fab = document.createElement("button");
  fab.id = "noteFab";
  fab.className = "note-fab hidden";
  fab.type = "button";
  fab.setAttribute("aria-label", "Write a note (N)");
  fab.title = "Write a note (N)";
  fab.innerHTML = `<span aria-hidden="true">📝</span>`;
  fab.addEventListener("click", () => openNoteDrawer());
  document.body.append(fab);
  const sync = () => fab.classList.toggle("hidden", !can("member"));
  window.addEventListener("pif:session-changed", sync);
  sync();
  document.addEventListener("keydown", (e) => {
    if (e.key !== "n" || e.metaKey || e.ctrlKey || e.altKey || !can("member")) return;
    if (e.target.closest("input, textarea, select, [contenteditable]") || document.querySelector("dialog[open]")) return;
    e.preventDefault();
    openNoteDrawer({ quote: String(window.getSelection() || "").trim() });
  });
}

// A different person signing in on this browser must not see the previous person's markers.
window.addEventListener("pif:session-changed", invalidateNoteCounts);
