// Ticker search for every ticker box: type a symbol or a company name ("hershey") and pick
// from a list. Any <input data-ticker> gets it on first focus, so views only add the attribute.
// Add data-ticker-go to submit the form on pick. On submit, a typed company name is swapped for its ticker before the form's own handler runs.
//
// ARIA 1.2 combobox: the input owns a listbox; arrow keys move, Enter or click picks, Escape
// closes. The list is position: fixed next to the input so it isn't clipped by scroll boxes and
// still sits in a modal <dialog>'s top layer.
import { api, esc, fundContext, recentTickers } from "./shared.js";

const cache = new Map(); // query → results
let uid = 0;

async function search(q) {
  const key = q.trim().toLowerCase();
  if (!key) return [];
  if (!cache.has(key)) {
    cache.set(key, api(`/api/symbols/search?q=${encodeURIComponent(key)}`).then((r) => r.results || []).catch((err) => { cache.delete(key); throw err; }));
  }
  return cache.get(key);
}

const norm = (v) => v.trim().toUpperCase().replace(/[./](?=[A-Z]$)/, "-");

// The ticker a typed value means: itself if it is one of the results, else the best match.
export async function resolveTicker(value) {
  const v = value.trim();
  if (!v) return v;
  try {
    const results = await search(v);
    const exact = results.find((r) => r.symbol === norm(v) || r.symbol.replace(/[.-]/g, "") === norm(v).replace(/[.-]/g, ""));
    if (exact) return exact.symbol;
    return results[0]?.symbol || v.toUpperCase();
  } catch {
    return v.toUpperCase(); // search offline: keep what was typed
  }
}

function attach(input) {
  if (input.dataset.tickerReady) return;
  input.dataset.tickerReady = "1";
  input.maxLength = 60; // company names are longer than tickers
  input.autocomplete = "off";
  input.spellcheck = false;
  input.removeAttribute("list");
  const id = `tp-${++uid}`;
  const list = document.createElement("ul");
  list.id = id;
  list.className = "tp-list hidden";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Matching tickers");
  input.after(list);
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", id);
  if (!input.placeholder || /^ticker$/i.test(input.placeholder)) input.placeholder = "Ticker or company";

  let results = [];
  let active = -1;
  let timer = null;
  let seq = 0;

  const place = () => {
    const r = input.getBoundingClientRect();
    list.style.left = `${Math.max(8, Math.min(r.left, innerWidth - 328))}px`;
    list.style.top = `${r.bottom + 4}px`;
    list.style.minWidth = `${Math.max(r.width, 260)}px`;
  };
  const close = () => {
    list.classList.add("hidden");
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  };
  const setActive = (i) => {
    active = i;
    const options = list.querySelectorAll('[role="option"]');
    options.forEach((li, j) => li.setAttribute("aria-selected", String(j === i)));
    if (i >= 0) {
      input.setAttribute("aria-activedescendant", `${id}-${i}`);
      options[i]?.scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  };
  // sections: [{ title?, rows }]. A title adds a heading row; options are numbered across sections.
  let sections = [];
  const render = () => {
    if (!results.length || document.activeElement !== input) return close();
    let n = 0;
    list.innerHTML = sections.map((s) => `${s.title ? `<li role="presentation" class="tp-group">${esc(s.title)}</li>` : ""}${s.rows.map((r) => `
      <li id="${id}-${n++}" role="option" aria-selected="false" data-symbol="${esc(r.symbol)}">
        <span class="tp-sym">${esc(r.symbol)}</span>
        <span class="tp-name">${esc(r.name || "")}</span>
        <span class="tp-meta">${r.owned ? `<span class="badge badge-owned">Owned</span>` : r.watching ? `<span class="badge badge-watch">Watching</span>` : esc(r.exchange || "")}</span>
      </li>`).join("")}`).join("");
    place();
    list.classList.remove("hidden");
    input.setAttribute("aria-expanded", "true");
    setActive(-1);
  };
  // Empty box on focus: Recent tickers, then holdings (same rows as search results).
  const showSuggestions = async () => {
    if (input.value.trim() || input.readOnly) return;
    const mine = ++seq;
    const ctx = await fundContext().catch(() => null);
    if (mine !== seq || input.value.trim() || document.activeElement !== input) return;
    const status = (symbol) => ({ symbol, owned: !!ctx?.owned.has(symbol), watching: !ctx?.owned.has(symbol) && !!ctx?.watched.has(symbol) });
    const recent = recentTickers().slice(0, 5).map(status);
    const seen = new Set(recent.map((r) => r.symbol));
    const holdings = (ctx?.positions || []).filter((p) => !seen.has(p.symbol)).slice(0, 8).map((p) => status(p.symbol));
    sections = [{ title: "Recent", rows: recent }, { title: "Holdings", rows: holdings }].filter((s) => s.rows.length);
    results = sections.flatMap((s) => s.rows);
    render();
  };
  const pick = (symbol) => {
    input.value = symbol;
    input.dataset.tickerResolved = symbol;
    close();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new CustomEvent("ticker:pick", { bubbles: true, detail: { symbol } }));
  };

  input.addEventListener("input", (e) => {
    if (e instanceof CustomEvent || !e.isTrusted) return;
    delete input.dataset.tickerResolved;
    clearTimeout(timer);
    const q = input.value;
    if (!q.trim()) { results = []; close(); showSuggestions(); return; }
    const mine = ++seq;
    timer = setTimeout(async () => {
      try { results = await search(q); } catch { results = []; }
      sections = [{ rows: results }];
      if (mine === seq) render();
    }, 150);
  });
  input.addEventListener("keydown", (e) => {
    const open = !list.classList.contains("hidden");
    if (e.key === "ArrowDown" && results.length) {
      e.preventDefault();
      if (!open) render();
      setActive(Math.min(active + 1, results.length - 1));
    } else if (e.key === "ArrowUp" && open) {
      e.preventDefault();
      setActive(Math.max(active - 1, 0));
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation(); // don't also close a surrounding dialog
      close();
    } else if (e.key === "Enter" && open && active >= 0) {
      // Fill the ticker and let the form submit as usual.
      pick(results[active].symbol);
    }
  });
  list.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus in the input
  list.addEventListener("click", (e) => {
    const li = e.target.closest("[data-symbol]");
    if (!li) return;
    pick(li.dataset.symbol);
    // Single-box forms (search, "add to watchlist") go straight away; longer forms wait.
    if (input.form && input.hasAttribute("data-ticker-go")) input.form.requestSubmit();
  });
  input.addEventListener("focus", showSuggestions);
  input.addEventListener("click", () => { if (list.classList.contains("hidden")) showSuggestions(); });
  input.addEventListener("blur", () => setTimeout(close, 100));
  addEventListener("resize", () => { if (!list.classList.contains("hidden")) place(); });
  addEventListener("scroll", () => { if (!list.classList.contains("hidden")) place(); }, true);
  if (document.activeElement === input) showSuggestions(); // first focus: attach() ran after the focus event
}

export function initTickerPicker() {
  document.addEventListener("focusin", (e) => {
    if (e.target.matches?.("input[data-ticker]")) attach(e.target);
  });
  // Runs before any form's own submit handler: swap typed company names for tickers first.
  document.addEventListener("submit", (e) => {
    const inputs = [...e.target.querySelectorAll("input[data-ticker]")]
      .filter((i) => !i.readOnly && i.value.trim() && i.dataset.tickerResolved !== i.value);
    if (!inputs.length) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const form = e.target;
    const submitter = e.submitter;
    Promise.all(inputs.map(async (i) => {
      const t = await resolveTicker(i.value);
      i.value = t;
      i.dataset.tickerResolved = t;
    })).then(() => {
      // A cached lookup resolves in the same task, while the browser still ignores
      // requestSubmit() ("firing submission events"), so resubmit on the next task.
      setTimeout(() => form.requestSubmit(submitter && form.contains(submitter) ? submitter : undefined));
    });
  }, true);
}
