// Highlight anything on a page → a small toolbar offers "Add to note" and "Share to chat",
// carrying the quoted text and a link back to where it came from. Signed-in members only.
import { can } from "./shared.js";
import { openNoteDrawer, pageContext } from "./notes.js";

let bar = null;

function ensureBar() {
  if (bar) return bar;
  bar = document.createElement("div");
  bar.className = "sel-bar hidden";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Selected text");
  bar.innerHTML = `
    <button type="button" data-sel="note"><span aria-hidden="true">📝</span> Add to note</button>
    <button type="button" data-sel="chat"><span aria-hidden="true">💬</span> Share to chat</button>`;
  // mousedown would clear the selection before click fires; keep it.
  bar.addEventListener("mousedown", (e) => e.preventDefault());
  bar.addEventListener("click", (e) => {
    const b = e.target.closest("[data-sel]");
    if (!b) return;
    const quote = currentQuote();
    hide();
    if (b.dataset.sel === "note") openNoteDrawer({ quote });
    else window.dispatchEvent(new CustomEvent("pif:share-to-chat", { detail: { kind: "quote", quote, ...pageContext() } }));
  });
  document.body.append(bar);
  return bar;
}

function currentQuote() {
  return String(window.getSelection() || "").replace(/\s+/g, " ").trim().slice(0, 2000);
}

function hide() { bar?.classList.add("hidden"); }

function update() {
  const sel = window.getSelection();
  const text = currentQuote();
  const anchor = sel?.anchorNode?.parentElement;
  // Only for text in the page itself (not inside inputs, dialogs, the chat panel or this bar).
  if (!can("member") || text.length < 3 || !anchor?.closest("#view") || anchor.closest("input, textarea, dialog, .chat-panel")) { hide(); return; }
  ensureBar();
  bar.querySelector('[data-sel="chat"]').classList.toggle("hidden", !window.__pifChatReady);
  bar.classList.remove("hidden");
  const narrow = window.matchMedia("(max-width: 720px)").matches;
  if (narrow) {
    // Phones show their own copy/paste menu above the selection; sit at the bottom instead.
    bar.style.left = "50%"; bar.style.top = ""; bar.style.bottom = "16px"; bar.style.transform = "translateX(-50%)";
    return;
  }
  const r = sel.getRangeAt(0).getBoundingClientRect();
  const w = bar.offsetWidth, h = bar.offsetHeight;
  const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
  const top = r.top - h - 8 < 60 ? r.bottom + 8 : r.top - h - 8;
  Object.assign(bar.style, { left: `${left}px`, top: `${top}px`, bottom: "", transform: "" });
}

export function initSelection() {
  let t = null;
  document.addEventListener("selectionchange", () => { clearTimeout(t); t = setTimeout(update, 180); });
  window.addEventListener("scroll", hide, { passive: true });
  window.addEventListener("hashchange", hide);
}
