import { el, esc, api, safeUrl, loading, errorBox, getPref, can, currentMember } from "../shared.js";
import { openChat } from "../chat.js";
import { term } from "../glossary.js";

export const title = "Today";

// Selected edition; null date/slot = the latest captured edition.
const state = { date: null, slot: null, showAll: false, movers: "gainers" };
let live = null;     // /api/today/live (not stored; refreshed per visit)
let current = null;  // last /api/today/editions response
let forYou = null;   // /api/today/foryou (signed in only)

const EDITION_TITLE = { premarket: "Morning briefing", midday: "Midday update", postmarket: "Evening wrap" };
const TILE_TERMS = { "^VIX": "vix", "^TNX": "tenYearYield" };

// ---- Small formatting helpers ----

const ny = (d = new Date()) => Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })
  .formatToParts(d).map((p) => [p.type, p.value]));
const dayLabel = (iso, todayIso) => (iso === todayIso ? "Today" : new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }));
const longDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
const clock = (iso) => (iso ? `${new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} ET` : "");
const ago = (iso) => {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};
const nyToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const daysUntil = (iso) => Math.round((new Date(`${iso}T12:00:00Z`) - new Date(`${nyToday()}T12:00:00Z`)) / 864e5);
const ext = (url, html, cls = "") => `<a ${cls ? `class="${cls}" ` : ""}href="${safeUrl(url)}" target="_blank" rel="noopener">${html}<span class="sr-only"> (opens in new tab)</span></a>`;

// Day change with an arrow. Only broad indices and our own holdings get green/red (up is
// good for a long-only fund); VIX, yields, oil, gold, dollar, bitcoin and sectors stay neutral.
function change(v, tone = "neutral") {
  if (!Number.isFinite(v)) return `<span class="muted">—</span>`;
  const cls = tone === "market" ? (v > 0 ? "gain-pos" : v < 0 ? "gain-neg" : "") : "";
  const arrow = v > 0 ? "▲" : v < 0 ? "▼" : "";
  return `<span class="${cls}">${arrow ? `<span aria-hidden="true">${arrow} </span><span class="sr-only">${v > 0 ? "up" : "down"} </span>` : ""}${Math.abs(v).toFixed(2)}%</span>`;
}
const price = (row) => {
  if (!Number.isFinite(row.price)) return "—";
  const digits = row.price >= 1000 ? 0 : 2;
  const n = row.price.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return row.unit === "$" ? `$${n}` : row.unit === "%" ? `${row.price.toFixed(2)}%` : n;
};
const money = (v) => `${v >= 0 ? "+" : "−"}$${Math.abs(Math.round(v)).toLocaleString("en-US")}`;

// CNBC's image service resizes on request; ask for card-sized images instead of 1920px.
function sized(url, w, h) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname === "image.cnbcfm.com") { u.searchParams.set("w", w); u.searchParams.set("h", h); }
    return u.toString();
  } catch { return null; }
}
const placeholder = (source) => `<span class="story-ph"><span>${esc(source || "News")}</span></span>`;
// Article photo, or (no photo / failed load) a placeholder with the outlet's name.
function storyImage(h, w, hgt, cls, eager = false) {
  const src = sized(h.image, w, hgt);
  if (!src) return `<div class="${cls}">${placeholder(h.source)}</div>`;
  return `<div class="${cls}"><img src="${esc(src)}" alt="" loading="${eager ? "eager" : "lazy"}" decoding="async" referrerpolicy="no-referrer" data-fallback="${esc(h.source || "News")}"></div>`;
}
function logo(symbol, size = 28) {
  const url = live?.logos?.[symbol];
  const mono = `<span class="logo logo-mono" style="--s:${size}px" aria-hidden="true">${esc(symbol.slice(0, 2))}</span>`;
  return url ? `<img class="logo" style="--s:${size}px" src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-mono="${esc(symbol.slice(0, 2))}">` : mono;
}
// Broken images: swap in the placeholder / monogram (wired after each render; no inline handlers).
function wireImageFallbacks(root) {
  root.querySelectorAll("img[data-fallback], img[data-mono]").forEach((img) => img.addEventListener("error", () => {
    const span = document.createElement("span");
    if (img.dataset.fallback) { span.className = "story-ph"; span.innerHTML = `<span>${esc(img.dataset.fallback)}</span>`; }
    else { span.className = "logo logo-mono"; span.style.cssText = img.style.cssText; span.setAttribute("aria-hidden", "true"); span.textContent = img.dataset.mono; }
    img.replaceWith(span);
  }, { once: true }));
}

// ---- Market clock (regular session 9:30–16:00 ET, weekdays; Yahoo's state catches holidays) ----

function marketClock() {
  const t = ny();
  const mins = (Number(t.hour) % 24) * 60 + Number(t.minute);
  const weekend = ["Sat", "Sun"].includes(t.weekday);
  const fmt = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);
  if (live?.marketState === "REGULAR") return { open: true, text: `Market open · closes in ${fmt(Math.max(0, 960 - mins))}` };
  if (!weekend && mins < 570) return { open: false, text: `Market opens in ${fmt(570 - mins)}` };
  if (!weekend && mins < 960) return { open: false, text: "Market closed today" };
  return { open: false, text: weekend || t.weekday === "Fri" ? "Market closed · opens Monday 9:30 AM ET" : "Market closed · opens tomorrow 9:30 AM ET" };
}
function greeting() {
  const h = Number(ny().hour) % 24;
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

// ---- Edition picker: ‹ day › and Premarket | Midday | Postmarket ----

function picker(r, cur) {
  const days = r.editions;
  const todayIso = days[0]?.date;
  const idx = Math.max(0, days.findIndex((d) => d.date === cur.date));
  const day = days[idx];
  const why = { upcoming: "Not published yet", missed: "Not captured (server was offline or it was a market holiday)" };
  return `
    <div class="today-picker" role="group" aria-label="Choose a news edition">
      <div class="today-day">
        <button type="button" class="btn btn-ghost btn-sm" data-day="${idx + 1}" ${idx >= days.length - 1 ? "disabled" : ""} aria-label="Earlier day">‹</button>
        <strong aria-live="polite">${esc(dayLabel(day.date, todayIso))}</strong>
        <button type="button" class="btn btn-ghost btn-sm" data-day="${idx - 1}" ${idx <= 0 ? "disabled" : ""} aria-label="Later day">›</button>
      </div>
      <div class="seg seg-sm" role="group" aria-label="Edition">
        ${day.slots.map((s) => `<button type="button" class="seg-btn" data-slot="${s.key}" aria-pressed="${s.key === cur.slot && s.status === "ready"}" ${s.status === "ready" ? "" : `disabled title="${esc(why[s.status])}"`}>${esc(s.label)}</button>`).join("")}
      </div>
    </div>`;
}

// ---- Sparkline: one series, 2px line, no axes; hover shows the value at that point ----

function sparkline(points, label) {
  if (!points || points.length < 2) return `<div class="spark spark-empty" aria-hidden="true"></div>`;
  const min = Math.min(...points), max = Math.max(...points), span = max - min || 1;
  const W = 120, H = 36, pad = 3;
  const xy = points.map((v, i) => [(i / (points.length - 1)) * W, pad + (1 - (v - min) / span) * (H - pad * 2)]);
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const first = points[0], last = points.at(-1);
  const summary = `${label}, last 5 days: from ${first.toFixed(2)} to ${last.toFixed(2)}, range ${min.toFixed(2)} to ${max.toFixed(2)}.`;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(summary)}" data-points="${points.map((v) => v.toFixed(2)).join(",")}">
      <polygon class="spark-fill" points="0,${H} ${line} ${W},${H}"/>
      <polyline class="spark-line" points="${line}" vector-effect="non-scaling-stroke"/>
      <line class="spark-x" x1="0" x2="0" y1="0" y2="${H}" vector-effect="non-scaling-stroke"/>
    </svg>`;
}
function wireSparks(root) {
  root.querySelectorAll("svg.spark[data-points]").forEach((svg) => {
    const pts = svg.dataset.points.split(",").map(Number);
    const tip = svg.closest(".tile")?.querySelector(".tile-hover");
    const x = svg.querySelector(".spark-x");
    svg.addEventListener("pointermove", (e) => {
      const r = svg.getBoundingClientRect();
      const i = Math.max(0, Math.min(pts.length - 1, Math.round(((e.clientX - r.left) / r.width) * (pts.length - 1))));
      const px = (i / (pts.length - 1)) * 120;
      x.setAttribute("x1", px); x.setAttribute("x2", px);
      svg.classList.add("hovering");
      const back = Math.round((1 - i / (pts.length - 1)) * 50) / 10;
      if (tip) tip.textContent = `${pts[i].toLocaleString("en-US", { maximumFractionDigits: 2 })}${back ? ` · ~${back} sessions ago` : " · latest"}`;
    });
    svg.addEventListener("pointerleave", () => { svg.classList.remove("hovering"); if (tip) tip.textContent = ""; });
  });
}

// ---- Sections ----

function readSection(lines, ed) {
  if (!lines?.length) return "";
  return `<section class="brief-read" aria-label="The 30-second read">
      <p class="brief-label">The 30-second read${ed ? ` · as of ${esc(clock(ed.capturedAt))}` : ""}</p>
      ${lines.map((l, i) => `<p class="${i === 0 ? "brief-lead" : "brief-line"}">${esc(l)}</p>`).join("")}
    </section>`;
}

function tilesSection() {
  if (!live) return `<section class="tiles-wrap">${loading("Loading markets…")}</section>`;
  const by = Object.fromEntries(live.snapshot.map((r) => [r.symbol, r]));
  const tiles = ["^GSPC", "^IXIC", "^DJI", "^RUT", "^VIX", "^TNX"].map((s) => by[s]).filter(Boolean);
  const chips = live.snapshot.filter((r) => !tiles.includes(r));
  const status = live.marketState === "REGULAR" ? "Live" : live.marketState === "PRE" ? "Premarket · changes from last close" : "Last close";
  return `<section class="tiles-wrap" aria-labelledby="mk-h">
      <div class="panel-head"><h3 id="mk-h" class="sec-title">Markets</h3><span class="muted small">${status}${live.quotesAsOf ? ` · ${esc(clock(live.quotesAsOf))}` : ""} · lines show 5 days</span></div>
      <div class="tiles">
        ${tiles.map((r) => `<div class="tile">
          <div class="tile-top"><span class="tile-name">${TILE_TERMS[r.symbol] ? term(TILE_TERMS[r.symbol], r.label) : esc(r.label)}</span><span class="tile-chg">${change(r.changePct, r.tone)}</span></div>
          <div class="tile-price">${price(r)}</div>
          ${sparkline(live.sparks?.[r.symbol], r.label)}
          <div class="tile-hover muted small" aria-hidden="true"></div>
        </div>`).join("")}
      </div>
      <div class="chips">${chips.map((r) => `<span class="chip"><span class="muted">${esc(r.label)}</span> <strong>${price(r)}</strong> ${change(r.changePct, r.tone)}</span>`).join("")}</div>
    </section>`;
}

function recapSection(ed, aiEnabled) {
  const r = ed?.recap;
  if (!r) {
    const msg = !ed ? "" : ed.recapError === "disabled" || !aiEnabled ? "AI summary of the news: coming soon." : "The AI summary couldn't be written for this edition. The stories below are complete.";
    return msg ? `<p class="muted small recap-note">${msg}</p>` : "";
  }
  const cite = (nums) => nums.map((n) => {
    const s = r.sources[n - 1];
    return s ? `<a class="cite" href="${safeUrl(s.url)}" target="_blank" rel="noopener" title="${esc(`${s.headline} (${s.source})`)}">${n}<span class="sr-only">: source, ${esc(s.headline)} (opens in new tab)</span></a>` : "";
  }).join("");
  return `
    <section class="panel need-know" aria-labelledby="nk-h">
      <h3 id="nk-h" class="sec-title">What you need to know</h3>
      <ol class="nk-list">${r.bullets.map((b) => `<li><span>${esc(b.text)}</span> ${cite(b.sources)}</li>`).join("")}</ol>
      ${r.forUs.length ? `<h4 class="recap-sub">For our holdings</h4><ul class="nk-us">${r.forUs.map((b) => `<li>${esc(b.text)} ${cite(b.sources)}</li>`).join("")}</ul>` : ""}
      <p class="muted small recap-foot">Written by AI (${esc(r.model)}) from ${r.sources.length} headlines, using only those headlines. Numbers link to the source; check them before repeating anything.${Number.isFinite(r.costUsd) ? ` Est. cost $${r.costUsd.toFixed(4)}.` : ""}</p>
    </section>`;
}

function storiesSection(list, ed) {
  if (!list.length) return `<section class="panel"><h3 class="sec-title">Top stories</h3><p class="muted">No market headlines available.${ed?.newsError ? ` (${esc(ed.newsError)})` : ""}</p></section>`;
  // Lead = the newest of the first 8 stories that has a real photo (else the newest story).
  const leadIdx = Math.max(0, list.slice(0, 8).findIndex((h) => h.image));
  const lead = list[leadIdx];
  const rest = list.filter((_, i) => i !== leadIdx);
  // Card grid: recent stories with photos first (Reuters and Bloomberg send no photos), then
  // fill with text cards; everything else goes in the list below, still newest first.
  const pool = rest.slice(0, 16);
  const grid = [...pool.filter((h) => h.image), ...pool.filter((h) => !h.image)].slice(0, 6);
  const more = rest.filter((h) => !grid.includes(h));
  const shownMore = state.showAll ? more : more.slice(0, 8);
  const meta = (h) => `<span class="story-meta">${esc(h.source || "")}${h.datetime ? ` · ${esc(ago(h.datetime))}` : ""}${(h.holdings || []).map((s) => ` <span class="badge badge-owned">${esc(s)}</span>`).join("")}</span>`;
  return `
    <section aria-labelledby="ts-h">
      <div class="panel-head"><h3 id="ts-h" class="sec-title">Top stories</h3><span class="muted small">Reuters, CNBC, Bloomberg via Finnhub${ed ? ` · as of ${esc(clock(ed.capturedAt))}` : " · live"}</span></div>
      <article class="story-lead panel">
        ${storyImage(lead, 960, 540, "story-lead-img", true)}
        <div class="story-lead-body">
          ${meta(lead)}
          <h4>${ext(lead.url, esc(lead.headline))}</h4>
          ${lead.summary ? `<p class="muted">${esc(lead.summary)}</p>` : ""}
        </div>
      </article>
      <div class="story-grid">
        ${grid.map((h) => h.image ? `<article class="story-card panel">
          ${storyImage(h, 480, 270, "story-card-img")}
          <div class="story-card-body">${meta(h)}<h4>${ext(h.url, esc(h.headline))}</h4></div>
        </article>` : `<article class="story-card story-text panel">
          <div class="story-card-body">${meta(h)}<h4>${ext(h.url, esc(h.headline))}</h4>${h.summary ? `<p class="muted small">${esc(h.summary)}</p>` : ""}</div>
        </article>`).join("")}
      </div>
      ${more.length ? `<ul class="story-list panel">${shownMore.map((h) => `<li>${ext(h.url, esc(h.headline))} ${meta(h)}</li>`).join("")}</ul>
        ${more.length > 8 ? `<button type="button" class="btn-link small" id="toggleAll">${state.showAll ? "Show fewer" : `Show all ${list.length} stories`}</button>` : ""}` : ""}
    </section>`;
}

function holdingsNewsSection(ed) {
  if (!ed?.holdingNews?.length) return "";
  return `
    <section aria-labelledby="hn-h">
      <div class="panel-head"><h3 id="hn-h" class="sec-title">Our holdings in the news</h3><span class="muted small">Last 36 hours</span></div>
      <div class="hn-grid">${ed.holdingNews.map((g) => {
        const h = g.items[0];
        return `<article class="hn-card panel">
          <div class="hn-head">${logo(g.symbol)}<a class="symbol-cell" href="#/research/${encodeURIComponent(g.symbol)}">${esc(g.symbol)}</a><span class="muted small">${esc(h.source || "")} · ${esc(ago(h.datetime))}</span></div>
          <h4>${ext(h.url, esc(h.headline))}</h4>
          ${g.items[1] ? `<p class="small">${ext(g.items[1].url, esc(g.items[1].headline), "muted-link")}</p>` : ""}
        </article>`;
      }).join("")}</div>
    </section>`;
}

function portfolioSection() {
  const p = live?.portfolio;
  if (!p) return "";
  const total = p.up + p.down || 1;
  const row = (r) => `<li>${logo(r.symbol, 22)}<a class="symbol-cell" href="#/research/${encodeURIComponent(r.symbol)}">${esc(r.symbol)}</a><span>${change(r.changePct, "market")}</span></li>`;
  return `
    <section class="panel pf-panel" aria-labelledby="pf-h">
      <div class="panel-head"><h3 id="pf-h" class="sec-title">Our portfolio</h3><a class="small" href="#/">Holdings →</a></div>
      <div class="pf-big">${change(p.dayPct, "market")}<span class="pf-dollars">${money(p.dayChange)}</span></div>
      <p class="muted small">${live.marketState === "REGULAR" ? "So far today" : "Last session"} · ${p.covered} of ${p.total} holdings priced</p>
      <div class="pf-bar" role="img" aria-label="${p.up} holdings up, ${p.down} down"><span class="pf-up" style="width:${(p.up / total) * 100}%"></span><span class="pf-down" style="width:${(p.down / total) * 100}%"></span></div>
      <div class="pf-bar-legend small"><span>${p.up} up</span><span>${p.down} down</span></div>
      <div class="pf-movers">
        ${p.best.length ? `<div><p class="pf-sub">Best</p><ul>${p.best.map(row).join("")}</ul></div>` : ""}
        ${p.worst.length ? `<div><p class="pf-sub">Worst</p><ul>${p.worst.map(row).join("")}</ul></div>` : ""}
      </div>
    </section>`;
}

function onDeckSection() {
  if (!live) return "";
  const fed = live.fed || {};
  const todayIso = nyToday();
  const when = (iso) => { const d = daysUntil(iso); return d === 0 ? "Today" : d === 1 ? "Tomorrow" : new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }); };
  const items = live.upcoming.map((e) => ({ date: e.date, html: e.symbol ? `<a href="#/research/${encodeURIComponent(e.symbol)}">${esc(e.title)}</a>${e.detail ? ` <span class="muted">· ${esc(e.detail)}</span>` : ""}` : esc(e.title) }));
  return `
    <section class="panel" aria-labelledby="od-h">
      <div class="panel-head"><h3 id="od-h" class="sec-title">On deck</h3><a class="small" href="#/calendar">Calendar →</a></div>
      ${fed.nextMeeting ? `<div class="fed-count"><span class="fed-days">${Math.max(0, daysUntil(fed.nextMeeting.date))}</span><span>days to the next Fed rate decision<br><span class="muted small">${esc(when(fed.nextMeeting.date))}, ${esc(fed.nextMeeting.time || "")} ET${/press/i.test(fed.nextMeeting.detail) ? " · press conference" : ""}</span></span></div>` : ""}
      ${items.length ? `<ul class="deck-list">${items.map((i) => `<li><span class="deck-when ${i.date === todayIso ? "deck-today" : ""}">${esc(when(i.date))}</span><span>${i.html}</span></li>`).join("")}</ul>` : `<p class="muted small">No holding earnings or CPI/jobs releases in the next week.</p>`}
      ${live.earningsPending ? `<p class="muted small">Holding earnings dates are still loading; refresh in a minute.</p>` : ""}
      ${fed.press?.length ? `<p class="pf-sub">Latest from the Fed</p><ul class="link-list small">${fed.press.slice(0, 2).map((p) => `<li>${ext(p.link, esc(p.title))} <span class="muted">${p.date ? esc(p.date.slice(5, 10)) : ""}</span></li>`).join("")}</ul>` : ""}
    </section>`;
}

function sectorsSection() {
  if (!live) return "";
  const maxSector = Math.max(0.01, ...live.sectors.map((s) => Math.abs(s.changePct ?? 0)));
  return `
    <section class="panel" aria-labelledby="sec-h">
      <h3 id="sec-h" class="sec-title">${term("sectorEtf", "Sectors")}</h3>
      <ul class="sector-bars">${live.sectors.map((s) => `<li><span class="sector-name">${esc(s.label)}</span><span class="sector-track" aria-hidden="true"><span class="sector-bar ${(s.changePct ?? 0) < 0 ? "neg" : ""}" style="width:${Math.round((Math.abs(s.changePct ?? 0) / maxSector) * 50)}%"></span></span><span class="num small">${change(s.changePct)}</span></li>`).join("")}</ul>
    </section>`;
}

function moversSection() {
  if (!live) return "";
  const list = live.movers[state.movers] || [];
  return `
    <section class="panel" aria-labelledby="mv-h">
      <div class="panel-head"><h3 id="mv-h" class="sec-title">Biggest movers</h3>
        <div class="seg seg-sm" role="group" aria-label="Which movers">${[["gainers", "Up"], ["losers", "Down"], ["active", "Active"]].map(([k, l]) => `<button type="button" class="seg-btn" data-movers="${k}" aria-pressed="${state.movers === k}">${l}</button>`).join("")}</div>
      </div>
      ${list.length ? `<table class="mini-table"><caption class="sr-only">Top ${state.movers}, whole US market</caption><tbody>${list.map((m) => `<tr><th scope="row" class="left"><a class="symbol-cell" href="#/research/${encodeURIComponent(m.symbol)}">${esc(m.symbol)}</a>${m.owned ? ` <span class="badge badge-owned">Owned</span>` : ""}<div class="muted small cell-note">${esc(m.name || "")}</div></th><td class="num">${change(m.changePct)}</td></tr>`).join("")}</tbody></table>` : `<p class="muted small">Movers unavailable right now.</p>`}
    </section>`;
}

// Signed-in members: what's theirs today. Every part is skipped when empty; a brand-new
// account sees a short "how to make this yours" line instead.
function forYouSection() {
  if (!can("member")) return "";
  if (!forYou) return `<section class="panel foryou" aria-labelledby="fy-h"><h3 id="fy-h" class="sec-title">For you</h3><p class="muted small">Loading…</p></section>`;
  const f = forYou;
  const first = currentMember()?.name.split(/\s+/)[0] || "";
  const parts = [];
  if (f.chat.mentions.length || f.chat.unread) {
    parts.push(`<div class="fy-block"><p class="pf-sub">Club chat</p>
      ${f.chat.mentions.map((m) => `<p class="small"><strong>${esc(m.by)}</strong> mentioned you: ${esc(m.body)}</p>`).join("")}
      <button type="button" class="btn btn-ghost btn-sm" data-open-chat>${f.chat.unread ? `${f.chat.unread} unread message${f.chat.unread === 1 ? "" : "s"}` : "Open chat"} →</button></div>`);
  }
  if (f.toVote.length) {
    parts.push(`<div class="fy-block"><p class="pf-sub">Waiting for your vote</p><ul class="link-list small">${f.toVote.map((p) => `<li><a href="#/pitches/${p.id}">${esc(p.direction[0].toUpperCase() + p.direction.slice(1))} ${esc(p.symbol)}</a>${p.title ? ` <span class="muted">· ${esc(p.title)}</span>` : ""}</li>`).join("")}</ul></div>`);
  }
  if (f.tickers.length) {
    parts.push(`<div class="fy-block fy-tickers"><p class="pf-sub">Tickers you follow</p><ul class="fy-list">${f.tickers.map((t) => `<li>
      <div class="fy-row">${logo(t.symbol, 22)}<a class="symbol-cell" href="#/research/${encodeURIComponent(t.symbol)}">${esc(t.symbol)}</a><span class="num">${change(t.changePct, "market")}</span></div>
      ${t.news ? `<p class="small fy-news">${ext(t.news.url, esc(t.news.headline), "muted-link")} <span class="muted">${esc(t.news.source || "")}${t.news.datetime ? ` · ${esc(ago(t.news.datetime))}` : ""}</span></p>` : ""}
    </li>`).join("")}</ul></div>`);
  }
  if (f.paper) {
    parts.push(`<div class="fy-block"><p class="pf-sub">Your paper portfolio · ${esc(f.paper.season)}</p>
      <p><strong>$${Math.round(f.paper.totalValue).toLocaleString("en-US")}</strong> <span class="small">${change((f.paper.returnPct ?? 0) * 100, "market")} this season</span></p>
      <p class="small muted">${money(f.paper.dayChange)} today · ${f.paper.positions} position${f.paper.positions === 1 ? "" : "s"} · <a href="#/paper">Paper trading →</a></p></div>`);
  }
  if (f.notes.length) {
    parts.push(`<div class="fy-block"><p class="pf-sub">Your latest notes</p><ul class="link-list small">${f.notes.map((n) => `<li>${n.symbol ? `<a class="symbol-cell" href="#/research/${encodeURIComponent(n.symbol)}">${esc(n.symbol)}</a> ` : ""}${esc(n.body || n.quote)}</li>`).join("")}</ul><a class="small" href="#/notes">All notes →</a></div>`);
  }
  const empty = !parts.length;
  return `<section class="panel foryou" aria-labelledby="fy-h">
    <div class="panel-head"><h3 id="fy-h" class="sec-title">For you${first ? `, ${esc(first)}` : ""}</h3><a class="small" href="#/account">Personalize →</a></div>
    ${empty ? `<p class="muted small">Follow tickers from any Research page (the Follow button) and they'll show up here with their moves and news. Your notes, chat mentions and pitches waiting for your vote appear here too.</p>` : `<div class="fy-grid">${parts.join("")}</div>`}
  </section>`;
}

// ---- Render ----

// Sections someone turned off in Account & preferences.
const show = (key) => !getPref("todayHidden", []).includes(key);

function render(container) {
  const r = current;
  // A slow load finishing after the user has moved to another page must not draw over it.
  if (!r || !location.hash.startsWith("#/today")) return;
  const ed = r.edition;
  const cur = ed ? { date: ed.date, slot: ed.slot } : { date: state.date || r.editions[0].date, slot: state.slot };
  const missing = !ed && state.date;
  const g = greeting();
  const heading = ed ? EDITION_TITLE[ed.slot] : g === "Good evening" ? "Evening wrap" : g === "Good afternoon" ? "Midday update" : "Morning briefing";
  const mc = marketClock();
  const list = ed ? ed.headlines : r.liveHeadlines || [];
  const slotInfo = r.editions.find((d) => d.date === cur.date)?.slots.find((x) => x.key === cur.slot);
  const useEdBriefing = ed?.briefing?.length;

  container.innerHTML = `
    <header class="brief-head">
      <div>
        <p class="brief-kicker">${esc(g)} · ${esc(longDate(cur.date))}</p>
        <h2 tabindex="-1">${esc(heading)}</h2>
        <p class="market-clock"><span class="live-dot ${mc.open ? "on" : ""}" aria-hidden="true"></span>${esc(mc.text)}</p>
      </div>
      ${picker(r, cur)}
    </header>
    ${missing ? `<p class="muted page-pad">${slotInfo?.status === "upcoming" ? "This edition isn't out yet. Editions are saved at about 8:00 AM, 12:30 PM and 4:30 PM ET." : `No edition was captured for ${esc(dayLabel(cur.date, r.editions[0].date))}${slotInfo ? ` (${esc(slotInfo.label.toLowerCase())})` : ""}.`}</p>` : `
    ${show("read") ? readSection(useEdBriefing ? ed.briefing : live?.briefing, useEdBriefing ? ed : null) : ""}
    ${show("markets") ? tilesSection() : ""}
    ${show("foryou") ? forYouSection() : ""}
    <div class="brief-grid">
      <div class="brief-main">
        ${!ed ? `<p class="notice small">No edition saved yet today. Editions are saved each weekday at about 8:00 AM, 12:30 PM and 4:30 PM ET; these are live headlines.</p>` : ""}
        <div class="ord-recap">${show("recap") ? recapSection(ed, r.aiEnabled) : ""}</div>
        <div class="ord-stories">${show("stories") ? storiesSection(list, ed) : ""}</div>
        <div class="ord-hn">${show("holdingsNews") ? holdingsNewsSection(ed) : ""}</div>
      </div>
      <aside class="brief-side" aria-label="Portfolio and calendar">
        <div class="ord-pf">${show("portfolio") ? portfolioSection() : ""}</div>
        <div class="ord-deck">${show("deck") ? onDeckSection() : ""}</div>
        <div class="ord-sec">${show("sectors") ? sectorsSection() : ""}</div>
        <div class="ord-mv">${show("movers") ? moversSection() : ""}</div>
      </aside>
    </div>`}`;

  wireSparks(container);
  wireImageFallbacks(container);
  container.querySelectorAll("[data-open-chat]").forEach((b) => b.addEventListener("click", openChat));
  el("toggleAll")?.addEventListener("click", () => { state.showAll = !state.showAll; render(container); });
  container.querySelectorAll("[data-movers]").forEach((b) => b.addEventListener("click", () => { state.movers = b.dataset.movers; render(container); }));
  container.querySelectorAll("[data-slot]").forEach((b) => b.addEventListener("click", () => {
    state.date = cur.date; state.slot = b.dataset.slot; state.showAll = false; loadEdition(container);
  }));
  container.querySelectorAll("[data-day]").forEach((b) => b.addEventListener("click", () => {
    const day = r.editions[Number(b.dataset.day)];
    if (!day) return;
    state.date = day.date;
    state.slot = [...day.slots].reverse().find((x) => x.status === "ready")?.key || "premarket";
    state.showAll = false;
    loadEdition(container);
  }));
}

async function loadEdition(container) {
  try {
    const q = state.date && state.slot ? `?date=${state.date}&slot=${state.slot}` : "";
    current = await api(`/api/today/editions${q}`);
  } catch (err) {
    container.innerHTML = errorBox(`Could not load the news: ${err.message}`);
    return;
  }
  render(container);
}

export async function mount(container) {
  live = null; current = null; forYou = null;
  container.innerHTML = loading("Loading your briefing…");
  const livePromise = api("/api/today/live").then((d) => { live = d; }).catch(() => { live = null; });
  const forYouPromise = can("member") && !getPref("todayHidden", []).includes("foryou")
    ? api("/api/today/foryou").then((d) => { forYou = d; }).catch(() => { forYou = { tickers: [], notes: [], chat: { unread: 0, mentions: [] }, toVote: [], paper: null }; })
    : Promise.resolve();
  // "For you" can be slow on a cold start (prices + news); draw it in place when it lands.
  forYouPromise.then(() => {
    const node = container.querySelector(".foryou");
    if (!node || !forYou) return;
    node.outerHTML = forYouSection();
    container.querySelectorAll(".foryou [data-open-chat]").forEach((b) => b.addEventListener("click", openChat));
    wireImageFallbacks(container.querySelector(".foryou"));
  });
  await loadEdition(container);
  await livePromise;
  if (container.isConnected && current) render(container);
}
