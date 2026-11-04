import { el, esc, api, toast, icon, currentMember, sessionInfo, setSession, sessionReady, invalidateContext } from "./shared.js";
import { initRouter } from "./router.js";
import { initNotes } from "./notes.js";
import { initSelection } from "./selection.js";
import { initChat } from "./chat.js";
import { initInbox, setFundAlertCount } from "./inbox.js";
import { initTickerPicker } from "./tickerPicker.js";
import { togglePopover } from "./ui/popover.js";

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

const GUEST_ICON = icon("user", { size: 20 });
let accountPop = null;

function updateAuthUI() {
  const m = currentMember();
  // Signed in: a Sign in button on wide screens (the menu has one too). The menu button is always there.
  el("signInBtn").classList.toggle("hidden", !!m);
  const btn = el("accountBtn");
  btn.classList.toggle("is-guest", !m);
  el("accountInitials").innerHTML = m ? esc(initials(m.name)) : GUEST_ICON;
  el("accountLabel").textContent = m ? `Menu for ${m.name}` : "Menu";
  accountPop?.close({ returnFocus: false });
}

// Account menu: opens through the shared popover (a bottom sheet on phones). Chat, glossary and
// settings live here so the phone header stays on one row.
function accountMenuHtml() {
  const m = currentMember();
  const link = (name, label, href) => `<a class="account-item" href="${href}">${icon(name)}<span>${label}</span></a>`;
  const act = (name, label, key) => `<button type="button" class="account-item" data-act="${key}">${icon(name)}<span>${label}</span></button>`;
  const who = m ? `<p class="account-who"><strong>${esc(m.name)}</strong><span class="muted small">${esc([m.title, m.isAdmin ? "Admin" : "", m.canTrade ? "Can trade" : ""].filter(Boolean).join(" · "))}</span></p>` : "";
  return `<div class="account-menu-body" data-account-menu>
    ${who}
    ${m ? link("user", "My profile", "#/members/me") + link("doc", "My notes", "#/notes") + link("inbox", "Notifications", "#/inbox") : ""}
    ${act("chat", "Club chat", "chat")}
    ${link("help", "Glossary", "#/glossary")}
    ${link("gear", "Settings", "#/settings")}
    ${m ? link("sliders", "Account &amp; preferences", "#/account") + `<hr class="account-sep" />` + act("x", "Sign out", "signout") : `<hr class="account-sep" />` + act("user", "Sign in", "signin")}
  </div>`;
}

el("accountBtn").addEventListener("click", () => {
  accountPop = togglePopover({ anchor: el("accountBtn"), content: accountMenuHtml(), label: "Menu", placement: "bottom-end", width: 260, onClose: () => { accountPop = null; } });
  accountPop?.el.addEventListener("click", async (e) => {
    const target = e.target.closest("a, [data-act]");
    if (!target) return;
    const act = target.dataset.act;
    accountPop.close({ returnFocus: !!act });
    if (act === "chat") el("chatBtn").click();
    else if (act === "signin") openSignIn();
    else if (act === "signout") {
      try { await api("/api/auth/logout", { method: "POST" }); } catch { /* signed out anyway */ }
      setSession({ member: null });
      el("accountBtn").focus();
      toast("Signed out.");
    }
  });
});

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
// Wide screens show the box in the header. At 900px and under it is an icon that opens the box
// over the whole header row (back button, Esc or a pick closes it).

const topbar = document.querySelector(".topbar");
const compactHeader = window.matchMedia("(max-width: 900px)");
function setSearchOpen(open) {
  topbar.classList.toggle("searching", open);
  el("searchToggle").setAttribute("aria-expanded", String(open));
}
function openSearch() {
  if (compactHeader.matches) setSearchOpen(true);
  el("jumpInput").focus();
}
function closeSearch({ restoreFocus = false } = {}) {
  if (!topbar.classList.contains("searching")) return;
  setSearchOpen(false);
  if (restoreFocus) el("searchToggle").focus();
}
el("searchToggle").addEventListener("click", openSearch);
el("searchBack").addEventListener("click", () => closeSearch({ restoreFocus: true }));
el("jumpInput").addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return; // the picker handles the first Esc when its list is open
  if (compactHeader.matches) closeSearch({ restoreFocus: true });
  else el("jumpInput").blur();
});
el("jumpForm").addEventListener("focusout", () => {
  setTimeout(() => { if (!el("jumpForm").contains(document.activeElement)) closeSearch(); }, 150);
});
compactHeader.addEventListener("change", () => setSearchOpen(false));
window.addEventListener("hashchange", () => closeSearch());

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
  closeSearch();
});

// "/" focuses search from anywhere (unless already typing in a field).
document.addEventListener("keydown", (e) => {
  if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t.closest("input, textarea, select, [contenteditable]") || document.querySelector("dialog[open]")) return;
  e.preventDefault();
  openSearch();
});

// ---- Header height and scrolling tab bars ----

// Sticky bars under the header (.tabnav, .jump-nav) read --topbar-h so they stick right below it.
const setTopbarHeight = () => document.documentElement.style.setProperty("--topbar-h", `${topbar.offsetHeight}px`);
setTopbarHeight();
if (window.ResizeObserver) new ResizeObserver(setTopbarHeight).observe(topbar);
else window.addEventListener("resize", setTopbarHeight);

// Horizontal tab bars (.nav, .subtabs, .tabnav) fade at an edge when more is hidden past it, and
// the current tab is scrolled into view the first time a bar appears.
const TAB_BARS = ".nav, .subtabs, .tabnav";
const seenBars = new WeakSet();
function updateFades(bar) {
  const max = bar.scrollWidth - bar.clientWidth;
  bar.classList.toggle("fade-start", max > 1 && bar.scrollLeft > 1);
  bar.classList.toggle("fade-end", max > 1 && bar.scrollLeft < max - 1);
}
function syncTabBars() {
  for (const bar of document.querySelectorAll(TAB_BARS)) {
    bar.classList.add("scroll-fade");
    if (!seenBars.has(bar) && bar.clientWidth) {
      seenBars.add(bar);
      const active = bar.querySelector('[aria-current="page"], .active');
      if (active && bar.scrollWidth > bar.clientWidth) {
        bar.scrollLeft += active.getBoundingClientRect().left - bar.getBoundingClientRect().left - (bar.clientWidth - active.offsetWidth) / 2;
      }
    }
    updateFades(bar);
  }
}
let tabBarFrame = 0;
const scheduleTabBars = () => { cancelAnimationFrame(tabBarFrame); tabBarFrame = requestAnimationFrame(syncTabBars); };
document.addEventListener("scroll", (e) => { if (e.target.matches?.(TAB_BARS)) updateFades(e.target); }, true);
new MutationObserver(scheduleTabBars).observe(el("view"), { childList: true, subtree: true });
window.addEventListener("hashchange", () => {
  // A bar that is reused for the next page (the header nav) should re-center on its new current item.
  document.querySelectorAll(".nav").forEach((b) => seenBars.delete(b));
  scheduleTabBars();
});
window.addEventListener("resize", scheduleTabBars);
window.addEventListener("pif:route-rendered", scheduleTabBars);
scheduleTabBars();

sessionReady().then(() => { updateAuthUI(); connectLive(); });
initNotes();
initSelection();
initChat();
initInbox();
initTickerPicker();
refreshAlertBadge();
setInterval(refreshAlertBadge, 10 * 60 * 1000);
