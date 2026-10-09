import { mountMyAlerts } from "../myAlerts.js";
import { el, esc, api, toast, currentMember, setSession, pageHead, lockedHint, getPref, setPref, benchmarkPresets, benchmarkPicker, wireBenchmarkPicker } from "../shared.js";

export const title = "Account";

export async function mount(container) {
  const m = currentMember();
  if (!m) {
    container.innerHTML = pageHead("Account") + `<div class="toolbar">${lockedHint("Sign in to see your account.")}</div>`;
    return;
  }
  const [presets, settings] = await Promise.all([benchmarkPresets(), api("/api/settings").catch(() => ({}))]);
  const access = [m.isAdmin ? "Admin: manages members and fund policy" : "", m.canTrade ? "Can trade: changes the real fund's holdings, trades, cash and dividends" : "", "Member: notes, chat, pitches, theses, votes and paper trading"].filter(Boolean);
  container.innerHTML = `
    ${pageHead("Account & preferences", "Your sign-in, access and personal settings.")}
    <div class="tab-grid">
      <section class="panel span-full" aria-labelledby="pref-h">
        <h3 id="pref-h">Preferences</h3>
        <div class="pref-grid" id="prefs"></div>
      </section>
      <section class="panel" aria-labelledby="notify-h" id="notify">
        <h3 id="notify-h">Notifications</h3>
        <p class="small">What shows up under 🔔. Everything is on unless you turn it off.</p>
        <div class="check-grid check-col" id="notifyPrefs"></div>
      </section>
      <section class="panel" aria-labelledby="ma-h">
        <h3 id="ma-h">My price alerts</h3>
        <div id="myAlerts"></div>
      </section>
      <section class="panel" aria-labelledby="me-h">
        <h3 id="me-h">You</h3>
        <dl class="facts">
          <dt>Name</dt><dd>${esc(m.name)}</dd>
          <dt>Email</dt><dd>${esc(m.email || "—")}</dd>
          <dt>Title</dt><dd>${esc(m.title || "—")}</dd>
        </dl>
        <p class="pf-sub">What you can do</p>
        <ul class="link-list small">${access.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>
        <p class="muted small">Name, title and access are set by an admin.</p>
      </section>
      <section class="panel" aria-labelledby="pw-h">
        <h3 id="pw-h">Change password</h3>
        <form id="pwForm" class="stack-form">
          <label>Current password <input name="currentPassword" type="password" required autocomplete="current-password" /></label>
          <label>New password (10+ characters) <input name="newPassword" type="password" required minlength="10" autocomplete="new-password" /></label>
          <button class="btn btn-primary">Change password</button>
        </form>
        <p class="muted small">Changing your password signs you out on every other device.</p>
      </section>
      <section class="panel" aria-labelledby="dev-h">
        <h3 id="dev-h">Devices</h3>
        <p class="small">Signed in somewhere you shouldn't be, like a library computer?</p>
        <button type="button" class="btn btn-ghost" id="logoutAll">Sign out everywhere</button>
      </section>
    </div>`;
  renderPrefs(presets, settings);
  renderNotifyPrefs();
  mountMyAlerts(el("myAlerts"));
  if (location.hash.endsWith("/notify")) el("notify").scrollIntoView();
  el("pwForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    try {
      await api("/api/auth/password", { method: "POST", body: JSON.stringify(body) });
      e.target.reset();
      toast("Password changed. Other devices were signed out.", { type: "success" });
    } catch (err) { toast(err.message, { type: "error" }); }
  });
  el("logoutAll").addEventListener("click", async () => {
    try { await api("/api/auth/logout-all", { method: "POST" }); } catch { /* signed out anyway */ }
    setSession({ member: null });
    toast("Signed out on every device.");
    location.hash = "#/today";
  });
}

const NOTIFY_TYPES = [["pitchVoting", "A pitch opens for voting"], ["pitchResult", "Results of pitches you wrote or voted on"], ["fundTrade", "Trades in the real fund"], ["priceAlert", "Your price alerts"], ["paperOrder", "Your paper orders filling or being cancelled"], ["mention", "Mentions in the club chat"]];
function renderNotifyPrefs() {
  const box = el("notifyPrefs");
  const off = getPref("notifyOff", []);
  box.innerHTML = NOTIFY_TYPES.map(([k, l]) => `<label class="check"><input type="checkbox" data-notify="${k}" ${off.includes(k) ? "" : "checked"} /> ${esc(l)}</label>`).join("");
  box.addEventListener("change", () => setPref("notifyOff", [...box.querySelectorAll("[data-notify]")].filter((x) => !x.checked).map((x) => x.dataset.notify)));
}

const TODAY_SECTIONS = [["read", "30-second read"], ["markets", "Market tiles"], ["foryou", "For you"], ["recap", "AI summary"], ["stories", "Top stories"], ["holdingsNews", "Holdings in the news"], ["portfolio", "Our portfolio"], ["deck", "On deck"], ["sectors", "Sectors"], ["movers", "Biggest movers"]];
const PERIODS = [["1d", "1D"], ["5d", "5D"], ["1m", "1M"], ["3m", "3M"], ["ytd", "YTD"], ["1y", "1Y"], ["all", "All (since purchase)"]];
const seg = (name, options, current) => `<div class="seg seg-sm" role="group" aria-label="${esc(name)}">${options.map(([v, l]) => `<button type="button" class="seg-btn" data-pref="${name}" data-value="${v}" aria-pressed="${v === current}">${esc(l)}</button>`).join("")}</div>`;

// Every control saves immediately (to your account), so there's no Save button to forget.
function renderPrefs(presets, settings) {
  const box = el("prefs");
  if (!box) return;
  const hidden = getPref("todayHidden", []);
  const tickers = getPref("myTickers", []);
  box.innerHTML = `
    <div class="pref-item">
      ${benchmarkPicker("prefBench", getPref("benchmark") || settings.benchmark || "SPY", presets, { label: "Compare with (your \"model fund\")" })}
      <p class="field-hint">Used on Performance, Allocation, Research → Risk, the Backtester and Paper trading. ${getPref("benchmark") ? `<button type="button" class="btn-link small" id="prefBenchReset">Use the fund's (${esc(settings.benchmarkLabel || settings.benchmark || "")})</button>` : `Currently the fund's official benchmark.`}</p>
    </div>
    <div class="pref-item"><span class="pref-label">Theme</span>${seg("theme", [["system", "Match device"], ["light", "Light"], ["dark", "Dark"]], getPref("theme", "system"))}</div>
    <div class="pref-item"><span class="pref-label">Start page</span>${seg("startPage", [["holdings", "Holdings"], ["today", "Today"]], getPref("startPage", "holdings"))}</div>
    <div class="pref-item"><label class="pref-label" for="prefPeriod">Holdings gains default</label>
      <select id="prefPeriod">${PERIODS.map(([v, l]) => `<option value="${v}" ${v === getPref("holdingsPeriod", "all") ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>
    <div class="pref-item span-pref">
      <span class="pref-label">Tickers you follow</span>
      <div class="chip-list">${tickers.length ? tickers.map((t) => `<span class="chip"><a href="#/research/${encodeURIComponent(t)}">${esc(t)}</a><button type="button" class="chip-x" data-unfollow="${esc(t)}" aria-label="Stop following ${esc(t)}">×</button></span>`).join("") : `<span class="muted small">None yet. Use ☆ Follow on any company's research page, or add one here.</span>`}</div>
      <form id="followForm" class="inline-form"><label class="sr-only" for="followInput">Ticker to follow</label><input id="followInput" placeholder="Ticker" maxlength="12" autocomplete="off" /><button class="btn btn-ghost btn-sm">Follow</button></form>
    </div>
    <div class="pref-item span-pref">
      <span class="pref-label">Show on Today</span>
      <div class="check-grid">${TODAY_SECTIONS.map(([k, l]) => `<label class="check"><input type="checkbox" data-today="${k}" ${hidden.includes(k) ? "" : "checked"} /> ${esc(l)}</label>`).join("")}</div>
    </div>`;
  const rerender = () => renderPrefs(presets, settings);
  wireBenchmarkPicker("prefBench", async (v) => { await setPref("benchmark", v); toast("Compare-with saved."); rerender(); });
  el("prefBenchReset")?.addEventListener("click", async () => { await setPref("benchmark", null); rerender(); });
  box.querySelectorAll("[data-pref]").forEach((b) => b.addEventListener("click", async () => { await setPref(b.dataset.pref, b.dataset.value); rerender(); }));
  el("prefPeriod").addEventListener("change", (e) => setPref("holdingsPeriod", e.target.value));
  box.querySelectorAll("[data-unfollow]").forEach((b) => b.addEventListener("click", async () => { await setPref("myTickers", getPref("myTickers", []).filter((t) => t !== b.dataset.unfollow)); rerender(); }));
  el("followForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const t = el("followInput").value.trim().toUpperCase();
    if (!/^[A-Z0-9.\-^=]{1,12}$/.test(t)) { toast("Enter a ticker like AAPL or BRK-B.", { type: "error" }); return; }
    await setPref("myTickers", [...new Set([...getPref("myTickers", []), t])]);
    rerender();
  });
  box.querySelectorAll("[data-today]").forEach((c) => c.addEventListener("change", () => {
    const off = [...box.querySelectorAll("[data-today]")].filter((x) => !x.checked).map((x) => x.dataset.today);
    setPref("todayHidden", off);
  }));
}
