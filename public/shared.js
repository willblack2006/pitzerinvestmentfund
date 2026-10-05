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
// being interpolated into innerHTML — theses, news headlines and insider names are untrusted.
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

// Only allow http(s) links from external data (blocks javascript: URLs in news feeds).
export const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? esc(u) : "#");

// Gain/loss with a shape cue (▲/▼) so it never relies on red/green alone. Missing values
// stay neutral instead of defaulting to "positive".
export function signed(value, formatted) {
  if (value === null || value === undefined || Number.isNaN(value)) return `<span class="muted">—</span>`;
  const cls = value > 0 ? "gain-pos" : value < 0 ? "gain-neg" : "";
  const icon = value > 0 ? "▲" : value < 0 ? "▼" : "";
  const word = value > 0 ? "up" : value < 0 ? "down" : "";
  return `<span class="${cls}">${icon ? `<span aria-hidden="true">${icon} </span><span class="sr-only">${word} </span>` : ""}${formatted ?? value}</span>`;
}

export function getPassword() {
  return sessionStorage.getItem("pif_edit_password") || "";
}
export function isUnlocked() {
  return !!getPassword();
}

// ---- Individual member session (voting, authorship) ----
export function getMember() {
  try { return JSON.parse(localStorage.getItem("pif_member") || "null"); } catch { return null; }
}
export function setMember(session) {
  try {
    if (session) localStorage.setItem("pif_member", JSON.stringify(session));
    else localStorage.removeItem("pif_member");
  } catch { /* storage unavailable */ }
  window.dispatchEvent(new CustomEvent("pif:member-changed"));
}

export async function api(path, options = {}) {
  const headers = Object.assign({ "Content-Type": "application/json" }, options.headers || {});
  if (isUnlocked()) headers["x-edit-password"] = getPassword();
  const member = getMember();
  if (member?.token) headers["x-member-token"] = member.token;
  const res = await fetch(path, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // A stale/changed password: re-lock so the UI stops pretending editing works.
    if (res.status === 401 && isUnlocked()) {
      sessionStorage.removeItem("pif_edit_password");
      window.dispatchEvent(new CustomEvent("pif:auth-expired"));
    }
    if (body.code === "member_required" && member?.token) setMember(null); // session revoked
    throw Object.assign(new Error(body.error || `Request failed (${res.status})`), { code: body.code, status: res.status });
  }
  return res.status === 204 ? null : res.json();
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

export function requestMemberSignIn() {
  window.dispatchEvent(new CustomEvent("pif:request-member"));
}

export function requestUnlock() {
  window.dispatchEvent(new CustomEvent("pif:request-unlock"));
}

// Inline prompt shown in place of edit controls while locked, so members know editing exists.
export function lockedHint(text) {
  return `<p class="locked-hint"><span aria-hidden="true">🔒</span> ${esc(text)}
    <button type="button" class="btn-link" data-unlock>Unlock editing</button></p>`;
}

// ---- Sortable tables: real <button>s inside <th> with aria-sort ----

export function sortHeader(key, label, sortState, { align = "" } = {}) {
  const active = sortState.key === key;
  const ariaSort = active ? (sortState.dir === 1 ? "ascending" : "descending") : "none";
  const arrow = active ? (sortState.dir === 1 ? "↑" : "↓") : "↕";
  return `<th scope="col" aria-sort="${ariaSort}" class="${align}">
    <button type="button" class="sort-btn" data-sort="${key}">${label}<span class="sort-arrow" aria-hidden="true">${arrow}</span></button>
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
  } catch { /* storage unavailable — fine */ }
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

// Shown at the top of grouped sections (Ideas, Market) so related pages read as one area.
export function subTabs(items, activeHref) {
  return `<nav class="subtabs" aria-label="Section">
    ${items.map(([href, label]) => `<a href="${href}" class="subtab" ${href === activeHref ? 'aria-current="page"' : ""}>${label}</a>`).join("")}
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
