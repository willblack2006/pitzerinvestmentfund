// Searchable, grouped pick list (APG combobox + listbox). Items: { id, label, description, group, keywords, meta }.
// Pure helpers are exported for node tests; nothing touches document or window at import time.

const RECENT_MAX = 5;
const RECENT_GROUP = "Recent";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Every word in the query must appear somewhere in label, description or keywords.
export function filterItems(items, query) {
  const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items.slice();
  return items.filter((it) => {
    const hay = [it.label, it.description, ...(it.keywords || [])].join(" ").toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

// How well an item matches the search: lower is better. A name match beats a match that only
// turns up in a description, so "rsi" + Enter picks RSI, not a preset that mentions RSI.
export function matchRank(it, query) {
  const q = String(query || "").toLowerCase().trim();
  const label = String(it.label || "").toLowerCase();
  const keys = (it.keywords || []).map((k) => String(k).toLowerCase());
  if (label === q) return 0;
  if (keys.includes(q)) return 1;
  if (label.startsWith(q)) return 2;
  if (keys.some((k) => k.startsWith(q))) return 3;
  if (label.split(/[^a-z0-9]+/).some((w) => w.startsWith(q))) return 4;
  if (label.includes(q)) return 5;
  if (keys.some((k) => k.includes(q))) return 6;
  return 7;
}

// Search results, best match first (stable within the same rank).
export function rankItems(items, query) {
  return items.map((it, i) => ({ it, i, r: matchRank(it, query) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.it);
}

// Groups in groupsOrder come first in that order, then any other groups in the order first seen.
// groupsOrder entries are names or { id, label }. Items with no group go last, under no heading.
export function groupItems(items, groupsOrder = []) {
  const out = [];
  const byId = new Map();
  for (const g of groupsOrder || []) {
    const id = typeof g === "string" ? g : g.id;
    const entry = { id, label: typeof g === "string" ? g : (g.label ?? g.id), items: [] };
    byId.set(id, entry);
    out.push(entry);
  }
  let loose = null;
  for (const it of items) {
    const id = it.group || "";
    if (!id) { (loose ||= { id: "", label: "", items: [] }).items.push(it); continue; }
    if (!byId.has(id)) { const entry = { id, label: id, items: [] }; byId.set(id, entry); out.push(entry); }
    byId.get(id).items.push(it);
  }
  if (loose) out.push(loose);
  return out.filter((g) => g.items.length);
}

// Items for the ids in recentIds, newest first, skipping ids that no longer exist.
export function recentItems(items, recentIds, max = RECENT_MAX) {
  const map = new Map(items.map((it) => [it.id, it]));
  return (recentIds || []).map((id) => map.get(id)).filter(Boolean).slice(0, max);
}

// New recent list with id moved to the front.
export function pushRecent(recentIds, id, max = RECENT_MAX) {
  return [id, ...(recentIds || []).filter((x) => x !== id)].slice(0, max);
}

function readRecent(key) {
  if (!key) return [];
  try { const v = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
function writeRecent(key, ids) {
  if (!key) return;
  try { localStorage.setItem(key, JSON.stringify(ids)); } catch { /* storage blocked: recents just don't persist */ }
}

let uid = 0;

export function pickList({ items = [], groups = [], placeholder = "Search", onPick, isSelected, recentKey, emptyText = "No matches for", renderRight }) {
  const n = ++uid;
  const listId = `ui-pick-${n}`;
  const el = document.createElement("div");
  el.className = "ui-pick";
  el.innerHTML = `
    <input type="search" class="ui-pick-search" role="combobox" aria-autocomplete="list" aria-expanded="true"
      aria-controls="${listId}" autocomplete="off" spellcheck="false" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}" />
    <div class="ui-pick-list" role="listbox" id="${listId}" aria-label="${esc(placeholder)}"></div>
    <p class="ui-pick-empty" role="status" aria-live="polite"></p>`;
  const input = el.querySelector(".ui-pick-search");
  const list = el.querySelector(".ui-pick-list");
  const empty = el.querySelector(".ui-pick-empty");

  let rows = [];   // flat list of rendered items, in display order
  let active = -1;

  function render() {
    const q = input.value.trim();
    const shown = filterItems(items, q);
    // While searching, one list ranked by match; otherwise the grouped view.
    const sections = q ? [{ id: "results", label: "", items: rankItems(shown, q) }] : groupItems(shown, groups);
    if (!q && recentKey) {
      const recent = recentItems(items, readRecent(recentKey));
      if (recent.length) sections.unshift({ id: RECENT_GROUP, label: RECENT_GROUP, items: recent });
    }
    rows = sections.flatMap((s) => s.items);
    let i = 0;
    list.innerHTML = sections.map((s, si) => {
      const hid = `${listId}-g${si}`;
      const head = s.label ? `<div class="ui-pick-head" id="${hid}" role="presentation">${esc(s.label)}</div>` : "";
      return `<div role="group" ${s.label ? `aria-labelledby="${hid}"` : ""}>${head}${s.items.map((it) => {
        const idx = i++;
        const sel = isSelected?.(it) ? "true" : "false";
        return `<div class="ui-pick-row" role="option" id="${listId}-o${idx}" data-idx="${idx}" aria-selected="false" aria-checked="${sel}">
          <span class="ui-pick-main"><span class="ui-pick-label">${esc(it.label)}</span>${it.description ? `<span class="ui-pick-desc">${esc(it.description)}</span>` : ""}</span>
          <span class="ui-pick-right">${sel === "true" ? `<span class="ui-pick-check" aria-hidden="true">✓</span>` : ""}</span></div>`;
      }).join("")}</div>`;
    }).join("");
    // renderRight can return a string or a Node; Nodes are appended after the checkmark.
    if (renderRight) list.querySelectorAll(".ui-pick-row").forEach((row) => {
      const extra = renderRight(rows[row.dataset.idx]);
      if (extra == null || extra === "") return;
      const slot = row.querySelector(".ui-pick-right");
      if (typeof extra === "string") slot.insertAdjacentHTML("beforeend", extra); else slot.append(extra);
    });
    empty.textContent = rows.length ? "" : `${emptyText} "${q}"`;
    empty.hidden = !!rows.length;
    setActive(rows.length ? 0 : -1, false);
  }

  function setActive(idx, scroll = true) {
    list.querySelector('[aria-selected="true"]')?.setAttribute("aria-selected", "false");
    active = idx;
    if (idx < 0) { input.removeAttribute("aria-activedescendant"); return; }
    const row = list.querySelector(`[data-idx="${idx}"]`);
    row.setAttribute("aria-selected", "true");
    input.setAttribute("aria-activedescendant", row.id);
    if (scroll) row.scrollIntoView({ block: "nearest" });
  }

  function pick(idx) {
    const it = rows[idx];
    if (!it) return;
    if (recentKey) writeRecent(recentKey, pushRecent(readRecent(recentKey), it.id));
    onPick?.(it);
  }

  input.addEventListener("input", render);
  input.addEventListener("keydown", (e) => {
    const last = rows.length - 1;
    if (e.key === "ArrowDown") { e.preventDefault(); if (last >= 0) setActive(active >= last ? 0 : active + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (last >= 0) setActive(active <= 0 ? last : active - 1); }
    else if (e.key === "Home" && last >= 0) { e.preventDefault(); setActive(0); }
    else if (e.key === "End" && last >= 0) { e.preventDefault(); setActive(last); }
    else if (e.key === "Enter") { e.preventDefault(); pick(active); }
  });
  list.addEventListener("mousemove", (e) => {
    const row = e.target.closest(".ui-pick-row");
    if (row && Number(row.dataset.idx) !== active) setActive(Number(row.dataset.idx), false);
  });
  // mousedown keeps focus in the search box so typing can continue.
  list.addEventListener("mousedown", (e) => { if (!e.target.closest(".ui-pick-right button, .ui-pick-right a")) e.preventDefault(); });
  list.addEventListener("click", (e) => {
    if (e.target.closest(".ui-pick-right button, .ui-pick-right a")) return; // e.g. a "?" glossary button
    const row = e.target.closest(".ui-pick-row");
    if (row) pick(Number(row.dataset.idx));
  });

  render();
  return {
    el,
    focus: () => input.focus(),
    // Re-render with the current query, e.g. after isSelected() changes.
    refresh() { const keep = active; render(); if (keep >= 0 && keep < rows.length) setActive(keep, false); },
  };
}
