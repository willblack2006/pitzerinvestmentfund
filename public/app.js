import { el, esc, api, toast, fundContext, currentMember, sessionInfo, setSession, sessionReady, invalidateContext } from "./shared.js";
import { initRouter } from "./router.js";
import { initNotes } from "./notes.js";
import { initSelection } from "./selection.js";
import { initChat } from "./chat.js";
import { initInbox, setFundAlertCount } from "./inbox.js";

// Each page's code only downloads when the user actually navigates there, instead of every
// view in the app loading up front (the old eager imports were the biggest contributor to
// slow first loads, especially on phones).
const router = initRouter({
  "/": () => import("./views/holdings.js"),
  "/today": () => import("./views/today.js"),
  "/performance": () => import("./views/performance.js"),
  "/allocation": () => import("./views/allocation.js"),
  "/transactions": () => import("./views/transactions.js"),
  "/dividends": () => import("./views/dividends.js"),
  "/alerts": () => import("./views/alerts.js"),
  "/factors": () => import("./views/factors.js"),
  "/research": () => import("./views/researchHome.js"),
  "/research/:symbol": () => import("./views/research.js"),
  "/research/:symbol/:tab": () => import("./views/research.js"),
  "/screener": () => import("./views/screener.js"),
  "/watchlist": () => import("./views/watchlist.js"),
  "/watchlist/:key": () => import("./views/watchlist.js"),
  "/pitches": () => import("./views/pitches.js"),
  "/pitches/new": () => import("./views/pitch.js"),
  "/pitches/new/:symbol": () => import("./views/pitch.js"),
  "/pitches/:id": () => import("./views/pitch.js"),
  "/track-record": () => import("./views/trackRecord.js"),
  "/forced-sellers": () => import("./views/forcedSellers.js"),
  "/paper": () => import("./views/paper.js"),
  "/macro": () => import("./views/macro.js"),
  "/insiders": () => import("./views/insiders.js"),
  "/short-interest": () => import("./views/shortInterest.js"),
  "/backtest": () => import("./views/backtest.js"),
  "/13f": () => import("./views/thirteenF.js"),
  "/calendar": () => import("./views/calendar.js"),
  "/index-radar": () => import("./views/indexRadar.js"),
  "/congress": () => import("./views/congressTrades.js"),
  "/settings": () => import("./views/settings.js"),
  "/account": () => import("./views/account.js"),
  "/account/:section": () => import("./views/account.js"),
  "/notes": () => import("./views/notes.js"),
  "/chat": () => import("./views/chat.js"),
  "/inbox": () => import("./views/inbox.js"),
  "/members/:id": () => import("./views/profile.js"),
  "/welcome/:token": () => import("./views/welcome.js"),
  "/join/:token": () => import("./views/join.js"),
  "/glossary": () => import("./views/glossary.js"),
});

// ---- Accounts: sign in, first-admin setup, account menu ----

const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

function updateAuthUI() {
  const m = currentMember();
  el("signInBtn").classList.toggle("hidden", !!m);
  el("accountBtn").classList.toggle("hidden", !m);
  if (m) {
    el("accountInitials").textContent = initials(m.name);
    el("accountLabel").textContent = `Account menu for ${m.name}`;
    el("accountName").textContent = m.name;
    el("accountTitle").textContent = [m.title, m.isAdmin ? "Admin" : "", m.canTrade ? "Can trade" : ""].filter(Boolean).join(" · ");
    el("accountAdminLink").classList.toggle("hidden", !m.isAdmin);
  }
}

let signInReturnFocus = null;
function openDialog(id) {
  signInReturnFocus = document.activeElement;
  const d = el(id);
  d.querySelector("form")?.reset();
  d.querySelector(".error")?.classList.add("hidden");
  d.showModal();
}
// A fresh install has no accounts: the first sign-in creates the admin instead.
function openSignIn() {
  openDialog(sessionInfo().setupNeeded ? "setupDialog" : "signInDialog");
}

async function afterSignIn(member, message) {
  setSession({ member, setupNeeded: false });
  document.querySelectorAll("dialog[open]").forEach((d) => d.close());
  toast(message, { type: "success" });
  (signInReturnFocus?.isConnected && !signInReturnFocus.closest(".hidden") ? signInReturnFocus : el("accountBtn")).focus();
}

function showFormError(id, err) {
  el(id).textContent = err.message;
  el(id).classList.remove("hidden");
}

el("signInBtn").addEventListener("click", openSignIn);
document.querySelectorAll("[data-close-dialog]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));
el("confirmCancel").addEventListener("click", () => el("confirmDialog").close());

el("signInForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    const r = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email: f.get("email"), password: f.get("password") }) });
    await afterSignIn(r.member, `Welcome back, ${r.member.name.split(" ")[0]}.`);
  } catch (err) {
    showFormError("signInError", err);
    e.target.password.select();
  }
});

el("setupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target).entries());
  try {
    const r = await api("/api/auth/setup", { method: "POST", body: JSON.stringify(f) });
    await afterSignIn(r.member, "Admin account created. Invite members from Settings.");
  } catch (err) {
    showFormError("setupError", err);
  }
});

el("signOutBtn").addEventListener("click", async () => {
  el("accountMenu").hidePopover();
  try { await api("/api/auth/logout", { method: "POST" }); } catch { /* signed out anyway */ }
  setSession({ member: null });
  el("signInBtn").focus();
  toast("Signed out.");
});
el("accountMenu").addEventListener("click", (e) => { if (e.target.closest("a")) el("accountMenu").hidePopover(); });

window.addEventListener("pif:request-signin", openSignIn);
window.addEventListener("pif:session-changed", () => { updateAuthUI(); connectLive(); router.rerender(); });
window.addEventListener("pif:auth-expired", () => {
  toast("You've been signed out. Sign in again to continue.", { type: "error", action: { label: "Sign in", onClick: openSignIn } });
});
document.body.addEventListener("click", (e) => {
  if (e.target.closest("[data-signin]")) openSignIn();
});

// ---- Live updates: fund changes reach every open page (and, later, chat) ----

// Pages whose data comes from the real fund; they re-render when a portfolio manager changes it.
const FUND_PAGES = new Set(["", "today", "performance", "allocation", "transactions", "dividends", "alerts", "factors"]);
let live = null;
function connectLive() {
  live?.close();
  live = new EventSource("/api/events");
  live.addEventListener("fund.changed", (e) => {
    const d = JSON.parse(e.data);
    invalidateContext();
    window.dispatchEvent(new CustomEvent("pif:fund-changed", { detail: d }));
    if (d.by && d.by !== currentMember()?.name) toast(describeChange(d));
    const section = location.hash.replace(/^#\/?/, "").split("/")[0];
    // Don't yank a page out from under someone mid-edit.
    const busy = document.querySelector("dialog[open]") || document.activeElement?.closest("#view input, #view textarea, #view select");
    if (FUND_PAGES.has(section) && !busy) router.rerender();
  });
  // Chat and presence (members only) are handled in chat.js.
  for (const type of ["hello", "notify", "presence", "chat.message", "chat.edited", "chat.deleted", "chat.reaction", "chat.mention"]) {
    live.addEventListener(type, (e) => window.dispatchEvent(new CustomEvent("pif:live", { detail: { type, data: JSON.parse(e.data) } })));
  }
}
function describeChange({ action, detail = {}, by }) {
  const who = by || "Someone";
  const n = (v) => Number(v).toLocaleString("en-US", { maximumFractionDigits: 4 });
  switch (action) {
    case "transaction.buy": return `${who} bought ${n(detail.shares)} ${detail.symbol}.`;
    case "transaction.sell": return `${who} sold ${n(detail.shares)} ${detail.symbol}.`;
    case "transaction.dividend": case "dividend.received": return `${who} recorded a ${detail.symbol} dividend.`;
    case "position.add": return `${who} added ${detail.symbol} to the holdings.`;
    case "position.edit": return `${who} updated ${detail.symbol}.`;
    case "position.delete": return `${who} removed ${detail.symbol} from the holdings.`;
    case "settings.update": return `${who} updated the fund's cash or settings.`;
    default: return `${who} updated the fund.`;
  }
}

// ---- Alerts badge (count of items needing action) ----

async function refreshAlertBadge() {
  try {
    const { alerts: list } = await api("/api/alerts");
    const n = list.filter((a) => a.level === "action").length;
    el("alertCount").textContent = n > 9 ? "9+" : String(n);
    el("alertCount").classList.toggle("hidden", !n);
    el("alertsLink").setAttribute("aria-label", n ? `Alerts: ${n} need action` : "Alerts");
    setFundAlertCount(n);
  } catch { /* badge is best-effort */ }
}

// ---- Global ticker search ----

async function refreshTickerOptions() {
  const ctx = await fundContext();
  const opts = [
    ...ctx.positions.map((p) => [p.symbol, "Owned"]),
    ...ctx.watchlist.filter((w) => !ctx.owned.has(w.symbol)).map((w) => [w.symbol, "Watching"]),
  ];
  el("tickerOptions").innerHTML = opts.map(([s, label]) => `<option value="${esc(s)}">${label}</option>`).join("");
}
window.addEventListener("pif:context-changed", refreshTickerOptions);

el("jumpForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const symbol = el("jumpInput").value.trim().toUpperCase().replace(/[^A-Z0-9.\-^=]/g, "");
  if (!symbol) {
    el("jumpInput").focus();
    return;
  }
  location.hash = `#/research/${encodeURIComponent(symbol)}`;
  el("jumpInput").value = "";
  el("jumpInput").blur();
});

// "/" focuses search from anywhere (unless already typing in a field).
document.addEventListener("keydown", (e) => {
  if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t.closest("input, textarea, select, [contenteditable]") || document.querySelector("dialog[open]")) return;
  e.preventDefault();
  el("jumpInput").focus();
});

sessionReady().then(() => { updateAuthUI(); connectLive(); });
initNotes();
initSelection();
initChat();
initInbox();
refreshTickerOptions();
refreshAlertBadge();
setInterval(refreshAlertBadge, 10 * 60 * 1000);
