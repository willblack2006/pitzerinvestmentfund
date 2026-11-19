// Command palette: Cmd/Ctrl+K from anywhere. Jump to a page, one of the fund's holdings, or any ticker.
import { api, esc } from "./shared.js";

const PAGES = [
  ["Today", "#/today", "briefing news markets"],
  ["Portfolio: Holdings", "#/", "positions gains"],
  ["Portfolio: Performance", "#/performance", "returns benchmark"],
  ["Portfolio: Risk", "#/risk", "drawdown beta var"],
  ["Portfolio: Allocation & policy", "#/allocation", "sectors limits"],
  ["Portfolio: Factors", "#/factors", "style"],
  ["Portfolio: Dividends", "#/dividends", "income"],
  ["Portfolio: Transactions", "#/transactions", "trades cash"],
  ["Alerts", "#/alerts", "needs attention"],
  ["Research", "#/research", "ticker lookup"],
  ["Ideas: Discovery", "#/screener", "screener"],
  ["Ideas: Watchlist", "#/watchlist", "lists"],
  ["Ideas: Pitches", "#/pitches", "votes"],
  ["Ideas: Track record", "#/track-record", ""],
  ["Ideas: Paper trading", "#/paper", "season"],
  ["Market: Macro", "#/macro", "rates fed"],
  ["Market: Insiders", "#/insiders", "form 4"],
  ["Market: 13F tracker", "#/13f", "managers"],
  ["Market: Calendar", "#/calendar", "earnings"],
  ["Settings", "#/settings", "policy members"],
  ["Notes", "#/notes", ""],
];

let root = null;
let holdings = null;
let opener = null;

async function loadHoldings() {
  if (holdings) return holdings;
  try { holdings = (await api("/api/positions")).map((p) => p.symbol); } catch { holdings = []; }
  return holdings;
}

function results(q) {
  const t = q.trim().toLowerCase();
  const out = [];
  const match = (s) => !t || s.toLowerCase().includes(t);
  for (const [name, href, kw] of PAGES) if (match(`${name} ${kw}`)) out.push({ group: "Go to", label: name, href });
  if (t) {
    for (const s of holdings || []) if (s.toLowerCase().startsWith(t)) out.push({ group: "Holdings", label: s, hint: "Research", href: `#/research/${encodeURIComponent(s)}` });
    const sym = q.trim().toUpperCase().replace(/[^A-Z0-9.\-^=]/g, "");
    if (sym && /^[A-Za-z0-9.\-^=]{1,10}$/.test(q.trim()) && !out.some((r) => r.label === sym)) out[out.some((r) => r.group === "Go to") ? "push" : "unshift"]({ group: "Research", label: `Research ${sym}`, href: `#/research/${encodeURIComponent(sym)}` });
  }
  return out.slice(0, 12);
}

export function closePalette() {
  if (!root) return;
  root.remove();
  root = null;
  document.body.classList.remove("palette-open");
  if (opener && document.contains(opener)) opener.focus();
  opener = null;
}

export async function openPalette() {
  if (root) return;
  opener = document.activeElement;
  root = document.createElement("div");
  root.className = "palette-backdrop";
  root.innerHTML = `<div class="palette" role="dialog" aria-modal="true" aria-label="Quick find">
    <input class="palette-input" type="text" role="combobox" aria-expanded="true" aria-controls="paletteList" autocomplete="off" spellcheck="false" placeholder="Jump to a page or ticker…" />
    <ul class="palette-list" id="paletteList" role="listbox"></ul>
    <div class="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>esc</kbd> close</span></div>
  </div>`;
  document.body.append(root);
  document.body.classList.add("palette-open");
  const input = root.querySelector("input");
  const list = root.querySelector("ul");
  let items = [];
  let active = 0;
  const paint = () => {
    items = results(input.value);
    active = Math.min(active, Math.max(0, items.length - 1));
    let last = "";
    list.innerHTML = items.length ? items.map((r, i) => {
      const head = r.group !== last ? `<li class="palette-group" role="presentation">${esc(r.group)}</li>` : "";
      last = r.group;
      return `${head}<li id="pal-${i}" role="option" data-i="${i}" aria-selected="${i === active}"><span>${esc(r.label)}</span>${r.hint ? `<span class="palette-hint">${esc(r.hint)}</span>` : ""}</li>`;
    }).join("") : `<li class="palette-empty" role="presentation">Nothing matches “${esc(input.value)}”.</li>`;
    input.setAttribute("aria-activedescendant", items.length ? `pal-${active}` : "");
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  };
  const go = (r) => { if (!r) return; closePalette(); location.hash = r.href; };
  input.addEventListener("input", () => { active = 0; paint(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(items.length - 1, active + 1); paint(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(0, active - 1); paint(); }
    else if (e.key === "Enter") { e.preventDefault(); go(items[active]); }
    else if (e.key === "Escape") { e.preventDefault(); closePalette(); }
    else if (e.key === "Tab") e.preventDefault(); // keep focus in the box
  });
  list.addEventListener("mousemove", (e) => { const li = e.target.closest("[data-i]"); if (li && +li.dataset.i !== active) { active = +li.dataset.i; paint(); } });
  list.addEventListener("click", (e) => { const li = e.target.closest("[data-i]"); if (li) go(items[+li.dataset.i]); });
  root.addEventListener("mousedown", (e) => { if (e.target === root) closePalette(); });
  paint();
  input.focus();
  loadHoldings().then(() => { if (root) paint(); });
}

export function initCommandPalette() {
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (root) closePalette(); else openPalette();
    }
  });
  window.addEventListener("hashchange", closePalette);
}
