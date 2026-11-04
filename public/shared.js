export const el = (id) => document.getElementById(id);
export const fmtUSD = (n) => (n ?? 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
export const fmtPct = (n) => `${n >= 0 ? "+" : ""}${(n ?? 0).toFixed(2)}%`;
export const fmtNum = (n) => (n === null || n === undefined ? "—" : n.toLocaleString("en-US"));
// Ratios stored as fractions (0.123 → "12.3%").
export const fmtRatio = (n, digits = 1) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : `${(n * 100).toFixed(digits)}%`);
export const fmtX = (n, digits = 1) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : `${n.toFixed(digits)}×`);
export const fmtMoneyCompact = (n) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : `${n < 0 ? "−" : ""}$${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(Math.abs(n))}`);
export const fmtCompact = (n) =>
  n === null || n === undefined ? "—" : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n);

// Every value that comes from the database or a third-party API goes through esc() before
// being interpolated into innerHTML: theses, news headlines and insider names are untrusted.
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

// Only allow http(s) links from external data (blocks javascript: URLs in news feeds).
export const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? esc(u) : "#");

// Gain/loss with a shape cue (▲/▼) so it never relies on red/green alone. Missing values
// stay neutral instead of defaulting to "positive".
// `invert`: for numbers where up is the bad direction (e.g. rising short interest), so the
// color matches the meaning while the arrow still shows the direction.
// `neutral`: arrow only, no green/red, for gaps to a model value or a price target (a target
// above the price is not a gain, and showing it green reads like a buy signal).
export function signed(value, formatted, { invert = false, neutral = false } = {}) {
  if (value === null || value === undefined || Number.isNaN(value)) return `<span class="muted">—</span>`;
  const good = !neutral && (invert ? value < 0 : value > 0), bad = !neutral && (invert ? value > 0 : value < 0);
  const cls = good ? "gain-pos" : bad ? "gain-neg" : "";
  const icon = value > 0 ? "▲" : value < 0 ? "▼" : "";
  const word = value > 0 ? "up" : value < 0 ? "down" : "";
  return `<span class="${cls}">${icon ? `<span aria-hidden="true">${icon} </span><span class="sr-only">${word} </span>` : ""}${formatted ?? value}</span>`;
}

// ---- Signed-in member (cookie session; loaded once by app.js from /api/auth/session) ----
// can("member")  → signed in (notes, chat, pitches, theses, watchlist, votes, paper trading)
// can("trade")   → portfolio manager: holdings, trades, cash, dividends
// can("admin")   → members and fund settings
let session = { member: null, setupNeeded: false, loaded: false };

export function currentMember() { return session.member; }
export function sessionInfo() { return session; }
export function can(cap = "member") {
  const m = session.member;
  if (!m) return false;
  return cap === "member" || (cap === "trade" && m.canTrade) || (cap === "admin" && m.isAdmin);
}
export function setSession(next) {
  const before = session.member?.id ?? null;
  session = { ...session, ...next, loaded: true };
  prefs = session.member ? { ...(next.prefs || (session.member?.id === before ? prefs : {})) } : readLocalPrefs();
  applyTheme();
  if ((session.member?.id ?? null) !== before) window.dispatchEvent(new CustomEvent("pif:session-changed"));
}

// ---- Personal preferences: saved to your account when signed in (they follow you across
// devices), otherwise to this browser. Keys are validated server-side (lib/prefs.js). ----
let prefs = {};
const LOCAL_PREFS = "pif_prefs";
function readLocalPrefs() { try { return JSON.parse(localStorage.getItem(LOCAL_PREFS) || "{}"); } catch { return {}; } }
export function getPref(key, fallback = null) { return prefs[key] ?? fallback; }
export async function setPref(key, value) {
  prefs = { ...prefs, [key]: value };
  if (value === null) delete prefs[key];
  if (key === "theme") applyTheme();
  window.dispatchEvent(new CustomEvent("pif:prefs-changed", { detail: { key, value } }));
  if (session.member) {
    try { prefs = await api("/api/prefs", { method: "PUT", body: JSON.stringify({ [key]: value }) }); }
    catch (err) { toast(`Couldn't save that preference: ${err.message}`, { type: "error" }); }
  } else {
    try { localStorage.setItem(LOCAL_PREFS, JSON.stringify(prefs)); } catch { /* private mode */ }
  }
}
// Light / dark / system. "system" leaves it to the device (prefers-color-scheme).
export function applyTheme() {
  const t = prefs.theme;
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
// "?benchmark=…" for the comparison pages when you've picked your own (else the fund's).
export function benchParam(prefix = "?") {
  const b = prefs.benchmark;
  return b ? `${prefix}benchmark=${encodeURIComponent(b)}` : "";
}
export async function loadSession() {
  try { setSession(await api("/api/auth/session")); } catch { setSession({ member: null }); }
  return session;
}
// The first page waits for this, so it never flashes "Sign in" hints at a signed-in member.
let firstLoad = null;
export function sessionReady() { return (firstLoad ||= loadSession()); }

// A page load routinely asks for the same GET twice at once, e.g. a view's own
// "/api/positions" fetch alongside fundContext()'s, or "/api/alerts" for both the page body
// and the header badge. Sharing one in-flight request for duplicate concurrent GETs halves
// that round-trip cost without caching anything beyond the moment both callers are waiting.
const inflightGets = new Map();

export async function api(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  if (method === "GET" && inflightGets.has(path)) return inflightGets.get(path);

  const promise = (async () => {
    // x-pif-app: proves the request came from this app (session cookies alone don't).
    const headers = Object.assign({ "Content-Type": "application/json", "x-pif-app": "1" }, options.headers || {});
    const res = await fetch(path, { ...options, headers, credentials: "same-origin" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      // Signed out elsewhere, expired, or deactivated: drop the stale session in the UI.
      if (body.code === "signin_required" && session.member) {
        setSession({ member: null });
        window.dispatchEvent(new CustomEvent("pif:auth-expired"));
      }
      throw Object.assign(new Error(body.error || `Request failed (${res.status})`), { code: body.code, status: res.status });
    }
    return res.status === 204 ? null : res.json();
  })();

  if (method === "GET") {
    inflightGets.set(path, promise);
    promise.finally(() => inflightGets.delete(path)).catch(() => {});
  }
  return promise;
}

// ---- Feedback: toasts (announced via role=status) and an in-app confirm dialog ----

export function toast(message, { type = "info", action, timeout = 5000 } = {}) {
  const region = el("toasts");
  const node = document.createElement("div");
  node.className = `toast toast-${type}`;
  node.setAttribute("role", type === "error" ? "alert" : "status");
  node.innerHTML = `<span>${esc(message)}</span>`;
  if (action) {
    const btn = document.createElement("button");
    btn.className = "btn btn-ghost btn-sm";
    btn.textContent = action.label;
    btn.addEventListener("click", () => {
      action.onClick();
      node.remove();
    });
    node.append(btn);
  }
  const close = document.createElement("button");
  close.className = "toast-close";
  close.setAttribute("aria-label", "Dismiss notification");
  close.textContent = "×";
  close.addEventListener("click", () => node.remove());
  node.append(close);
  region.append(node);
  setTimeout(() => node.remove(), action ? timeout * 2 : timeout);
}

export function confirmAction({ title, body, confirmLabel = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    const dialog = el("confirmDialog");
    el("confirmTitle").textContent = title;
    el("confirmBody").textContent = body || "";
    const ok = el("confirmOk");
    ok.textContent = confirmLabel;
    ok.className = `btn ${danger ? "btn-danger-solid" : "btn-primary"}`;
    const returnFocus = document.activeElement;
    const done = (value) => {
      dialog.removeEventListener("close", onClose);
      ok.removeEventListener("click", onOk);
      dialog.close();
      if (returnFocus?.isConnected) returnFocus.focus();
      resolve(value);
    };
    const onOk = () => done(true);
    const onClose = () => done(false);
    ok.addEventListener("click", onOk);
    dialog.addEventListener("close", onClose);
    dialog.showModal();
    el("confirmCancel").focus();
  });
}

export function requestSignIn() {
  window.dispatchEvent(new CustomEvent("pif:request-signin"));
}

const CAP_REASON = { trade: "Only portfolio managers can do this.", admin: "Only admins can do this." };

// Shown in place of controls someone can't use, so they know the feature exists and why
// it's off: a Sign in button for visitors, a plain reason for members without the right.
export function lockedHint(text, cap = "member") {
  if (!session.member) {
    return `<p class="locked-hint"><span aria-hidden="true">🔒</span> ${esc(text)}
      <button type="button" class="btn-link" data-signin>Sign in</button></p>`;
  }
  return `<p class="locked-hint"><span aria-hidden="true">🔒</span> ${esc(CAP_REASON[cap] || text)}</p>`;
}

// ---- Sortable tables: real <button>s inside <th> with aria-sort ----

// `after` is extra HTML placed after the sort button (e.g. a glossary "?" from term(key, "")),
// since a button can't sit inside another button.
export function sortHeader(key, label, sortState, { align = "", after = "" } = {}) {
  const active = sortState.key === key;
  const ariaSort = active ? (sortState.dir === 1 ? "ascending" : "descending") : "none";
  const arrow = active ? (sortState.dir === 1 ? "↑" : "↓") : "↕";
  const btn = `<button type="button" class="sort-btn" data-sort="${key}">${label}<span class="sort-arrow" aria-hidden="true">${arrow}</span></button>`;
  return `<th scope="col" aria-sort="${ariaSort}" class="${align}">
    ${after ? `<div class="sort-wrap">${btn}${after}</div>` : btn}
  </th>`;
}

export function sortRows(rows, { key, dir }) {
  return [...rows].sort((a, b) => {
    const av = a[key], bv = b[key];
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    if (typeof av === "string") return av.localeCompare(bv) * dir;
    return (av - bv) * dir;
  });
}

export function bindSort(container, sortState, rerender) {
  container.addEventListener("click", (e) => {
    const btn = e.target.closest(".sort-btn");
    if (!btn || !container.contains(btn)) return;
    const key = btn.dataset.sort;
    sortState.dir = sortState.key === key ? -sortState.dir : (key === "symbol" ? 1 : -1);
    sortState.key = key;
    rerender();
    container.querySelector(`.sort-btn[data-sort="${key}"]`)?.focus();
  });
}

// ---- Cross-page context: what the fund owns / watches (for badges + search suggestions) ----

let contextCache = null;
export async function fundContext(force = false) {
  if (!contextCache || force) {
    const [positions, watchlist] = await Promise.all([
      api("/api/positions").catch(() => []),
      api("/api/watchlist").catch(() => []),
    ]);
    contextCache = {
      positions,
      watchlist,
      owned: new Set(positions.map((p) => p.symbol)),
      watched: new Set(watchlist.map((w) => w.symbol)),
    };
  }
  return contextCache;
}
export function invalidateContext() {
  contextCache = null;
  window.dispatchEvent(new CustomEvent("pif:context-changed"));
}

export function statusBadge(symbol, ctx) {
  if (ctx?.owned.has(symbol)) return `<span class="badge badge-owned">Owned</span>`;
  if (ctx?.watched.has(symbol)) return `<span class="badge badge-watch">Watching</span>`;
  return "";
}

// Recently viewed research pages (per-viewer convenience only).
export function recentTickers() {
  try { return JSON.parse(localStorage.getItem("pif_recent") || "[]"); } catch { return []; }
}
export function pushRecent(symbol) {
  try {
    const list = [symbol, ...recentTickers().filter((s) => s !== symbol)].slice(0, 8);
    localStorage.setItem("pif_recent", JSON.stringify(list));
  } catch { /* storage unavailable, fine */ }
}

// Consistent page header: h2 (router focuses it on navigation), one-line description, actions.
export function pageHead(title, description = "", actions = "") {
  return `<div class="page-head">
    <div>
      <h2>${title}</h2>
      ${description ? `<p class="muted page-desc">${description}</p>` : ""}
    </div>
    ${actions ? `<div class="page-actions">${actions}</div>` : ""}
  </div>`;
}

// Loading state that is announced to screen readers and gives a sense of progress.
export function loading(text) {
  return `<div class="loading" role="status"><span class="spinner" aria-hidden="true"></span>${esc(text)}</div>`;
}

export function errorBox(text, retry = true) {
  return `<div class="error-box" role="alert"><p>${esc(text)}</p>
    ${retry ? `<button type="button" class="btn btn-ghost btn-sm" onclick="window.dispatchEvent(new HashChangeEvent('hashchange'))">Try again</button>` : ""}</div>`;
}

// ---- State helpers: skeleton, empty, error, icon. Styles are in ui/states.css. ----
// Content-shaped placeholder. The visible shapes fade in after ~300ms (pure CSS), so a fast
// load never flashes a placeholder. kind: "rows" | "chart" | "cards" | "text".
export function skeleton(kind = "rows", { rows = 4, label = "Loading" } = {}) {
  const n = Math.max(1, Math.min(20, Number(rows) || 4));
  const bar = (cls = "") => `<span class="skeleton-bar ${cls}"></span>`;
  let body;
  if (kind === "chart") body = `<span class="skeleton-block skeleton-chart"></span>`;
  else if (kind === "cards") body = `<div class="skeleton-cards">${Array.from({ length: Math.min(n, 6) }, () => `<span class="skeleton-block skeleton-card"></span>`).join("")}</div>`;
  else if (kind === "text") body = Array.from({ length: n }, (_, i) => bar(i === n - 1 ? "skeleton-short" : "")).join("");
  else body = Array.from({ length: n }, () => `<span class="skeleton-row">${bar("skeleton-w1")}${bar("skeleton-w2")}${bar("skeleton-w3")}</span>`).join("");
  return `<div class="skeleton skeleton-${esc(kind)}" role="status"><span class="sr-only">${esc(label)}</span><div class="skeleton-shapes" aria-hidden="true">${body}</div></div>`;
}

// Nothing here yet. action is { label, href } (link) or { label, id } (button).
export function emptyState({ icon: name, title, body, action } = {}) {
  const act = !action ? "" : action.href
    ? `<a class="btn btn-ghost btn-sm" href="${esc(action.href)}">${esc(action.label)}</a>`
    : `<button type="button" class="btn btn-ghost btn-sm"${action.id ? ` id="${esc(action.id)}"` : ""}>${esc(action.label)}</button>`;
  return `<div class="empty-state">${name ? `<span class="empty-state-icon">${icon(name, { size: 32 })}</span>` : ""}
    <p class="empty-state-title">${esc(title)}</p>${body ? `<p class="empty-state-body">${esc(body)}</p>` : ""}${act}</div>`;
}

// Failed to load. retryId ties the button to one panel's loader (see bindRetry).
export function errorState({ title = "Couldn't load this", detail, retryId } = {}) {
  return `<div class="error-state" role="alert"><p class="error-state-title">${esc(title)}</p>${detail ? `<p class="error-state-detail">${esc(detail)}</p>` : ""}
    ${retryId ? `<button type="button" class="btn btn-ghost btn-sm" data-retry="${esc(retryId)}">Try again</button>` : ""}</div>`;
}

// Re-runs only this panel's loader (errorBox, by contrast, re-renders the whole page).
export function bindRetry(container, retryId, fn) {
  if (!container) return;
  container.querySelectorAll("[data-retry]").forEach((b) => {
    if (b.dataset.retry === String(retryId)) b.addEventListener("click", () => fn(), { once: true });
  });
}

// Inline SVG from the sprite. Root-relative so it works from any hash route.
export function icon(name, { size = 18, label } = {}) {
  const a11y = label ? `role="img" aria-label="${esc(label)}"` : `aria-hidden="true"`;
  return `<svg class="icon" width="${Number(size) || 18}" height="${Number(size) || 18}" ${a11y} focusable="false"><use href="/icons.svg#i-${esc(name)}"/></svg>`;
}

// Shown at the top of grouped sections (Ideas, Market) so related pages read as one area.
// Items are [href, label] or [href, label, group]; a group name is shown once, before the
// first tab in that group, so long tab bars read as a few clusters.
export function subTabs(items, activeHref) {
  return `<nav class="subtabs" aria-label="Section">
    ${items.map(([href, label, group], i) => `${group && group !== items[i - 1]?.[2] ? `<span class="subtab-group">${esc(group)}</span>` : ""}<a href="${href}" class="subtab" ${href === activeHref ? 'aria-current="page"' : ""}>${label}</a>`).join("")}
  </nav>`;
}

// Minimal, safe Markdown → HTML for AI summaries: text is escaped FIRST, then only headings,
// bullets, bold and paragraphs are re-introduced. No links or raw HTML get through.
export function renderMarkdown(md) {
  const lines = esc(md || "").split(/\r?\n/);
  let html = "", inList = false;
  const inline = (t) => t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|\W)\*(?!\s)(.+?)\*(?=\W|$)/g, "$1<em>$2</em>");
  for (const line of lines) {
    const bullet = line.match(/^\s*[-*•]\s+(.*)/);
    if (bullet) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${inline(bullet[1])}</li>`;
      continue;
    }
    if (inList) { html += "</ul>"; inList = false; }
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) html += `<h4>${inline(h[2])}</h4>`;
    else if (line.trim()) html += `<p>${inline(line)}</p>`;
  }
  if (inList) html += "</ul>";
  return html;
}

// Tabs rendered as links (each tab is deep-linkable) with aria-current on the active one.
export function tabNav(items, activeKey, label = "Sections") {
  return `<nav class="tabnav" aria-label="${esc(label)}">
    ${items.map(([key, href, text]) => `<a href="${href}" class="tabnav-link" ${key === activeKey ? 'aria-current="page"' : ""}>${text}</a>`).join("")}
  </nav>`;
}

// ---- Benchmark picker (presets grouped by category + custom ticker/blend) ----

let benchmarkCatalog = null;
export async function benchmarkPresets() {
  if (!benchmarkCatalog) benchmarkCatalog = (await api("/api/benchmarks")).presets;
  return benchmarkCatalog;
}

// Renders a <select> of presets with a "Custom…" option that reveals a text field accepting
// any ticker (QQQ, ^GSPC) or a blend like "SPY:60,AGG:40". Read the value with readBenchmark().
export function benchmarkPicker(id, current, presets, { label = "Benchmark", disabled = false } = {}) {
  const known = presets.some((g) => g.items.some((i) => i.value === current));
  return `
    <div class="bench-picker" id="${id}">
      <label for="${id}-select">${esc(label)}</label>
      <select id="${id}-select" ${disabled ? "disabled" : ""}>
        ${presets.map((g) => `<optgroup label="${esc(g.group)}">${g.items.map((i) => `<option value="${esc(i.value)}" ${i.value === current ? "selected" : ""}>${esc(i.name)} (${esc(i.value)})</option>`).join("")}</optgroup>`).join("")}
        <option value="__custom" ${known ? "" : "selected"}>Custom ticker or blend…</option>
      </select>
      <input id="${id}-custom" class="${known ? "hidden" : ""}" value="${known ? "" : esc(current)}" placeholder="e.g. VTI or SPY:60,AGG:40" aria-label="Custom benchmark ticker or blend" ${disabled ? "disabled" : ""} />
    </div>`;
}

export function wireBenchmarkPicker(id, onChange) {
  const sel = el(`${id}-select`), input = el(`${id}-custom`);
  if (!sel) return;
  sel.addEventListener("change", () => {
    const custom = sel.value === "__custom";
    input.classList.toggle("hidden", !custom);
    if (custom) input.focus();
    else onChange?.(sel.value);
  });
  input.addEventListener("change", () => input.value.trim() && onChange?.(input.value.trim().toUpperCase()));
}

export function readBenchmark(id) {
  const sel = el(`${id}-select`);
  return sel.value === "__custom" ? el(`${id}-custom`).value.trim().toUpperCase() : sel.value;
}
