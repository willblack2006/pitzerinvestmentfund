// Event layers for the Research → Overview price chart (WS10): 8-K items, Form 4 buys and sells,
// earnings, dividends, pitches, the fund's trades, agent briefs, tripwire levels and the pitch's
// bull/base/bear prices. Data comes from GET /api/research/:symbol/annotations; this module
// turns it into lightweight-charts markers and price lines, and into readable text (the hover
// card and the "Events on this chart" list), so nothing is told by colour or shape alone.
import { api, esc, fmtUSD, fmtNum, fmtMoneyCompact, safeUrl } from "../shared.js";

// [key, label, description, default on]. Order is the order in the Layers menu and the legend.
export const LAYERS = [
  ["trades", "Fund trades", "The fund's own buys and sells", true],
  ["earnings", "Earnings", "Results releases (8-K Item 2.02) with beat or miss, and the next date", true],
  ["filings", "8-K filings", "Material events: agreements, officer changes, restatements…", true],
  ["insiders", "Insider trades", "Form 4 open-market buys and sales; clusters flagged", true],
  ["dividends", "Dividends", "Ex-dividend dates and amounts", false],
  ["pitches", "Pitches", "When a pitch was opened, and its status", true],
  ["agents", "Agent briefs", "Finished agent runs about this company", true],
  ["levels", "Price levels", "Average cost, thesis target, your price alerts", true],
  ["tripwires", "Tripwires", "Exit tripwire prices written down in advance", true],
  ["scenarios", "Bull / base / bear", "Case prices from the newest live pitch", true],
];
export const defaultLayers = () => Object.fromEntries(LAYERS.map(([k, , , on]) => [k, on]));

// One letter per layer inside the marker, so shape + letter identify it without colour.
const GLYPH = { earnings: "E", filings: "8K", insiders: "", dividends: "D", pitches: "P", agents: "AI" };

const cache = new Map(); // symbol → Promise<annotations>
export function loadAnnotations(symbol) {
  if (!cache.has(symbol)) {
    cache.set(symbol, api(`/api/research/${encodeURIComponent(symbol)}/annotations`).catch((e) => { cache.delete(symbol); return { layers: {}, error: e.message }; }));
    setTimeout(() => cache.delete(symbol), 5 * 60 * 1000); // fresh agent briefs and filings after a while
  }
  return cache.get(symbol);
}

// Every event as { layer, date, title, detail, url?, href?, tone }, newest last.
export function flatten(ann, layers) {
  const L = ann?.layers || {};
  const out = [];
  const on = (k) => layers[k] !== false;
  if (on("earnings")) for (const e of L.earnings || []) {
    const beat = e.surprisePct == null ? "" : e.surprisePct >= 0 ? `beat by ${(e.surprisePct * 100).toFixed(1)}%` : `missed by ${Math.abs(e.surprisePct * 100).toFixed(1)}%`;
    out.push({ layer: "earnings", date: e.date, title: e.upcoming ? "Next earnings (scheduled)" : "Earnings released", detail: e.upcoming ? "" : [beat, e.actual != null ? `EPS $${e.actual.toFixed(2)}${e.estimate != null ? ` vs $${e.estimate.toFixed(2)} expected` : ""}` : ""].filter(Boolean).join(" · "), tone: e.surprisePct == null ? "" : e.surprisePct >= 0 ? "good" : "bad", upcoming: !!e.upcoming });
  }
  if (on("filings")) for (const f of L.filings || []) {
    out.push({ layer: "filings", date: f.date, title: f.form === "8-K" ? `8-K: ${f.label}` : `${f.form}: ${f.label}`, detail: f.items?.length ? `Item ${f.items.join(", ")}` : "", url: f.url, tone: f.serious ? "warn" : "", serious: f.serious });
  }
  if (on("insiders")) for (const t of L.insiders || []) {
    const who = t.names.length > 2 ? `${t.names.slice(0, 2).join(", ")} and ${t.names.length - 2} more` : t.names.join(" and ");
    out.push({ layer: "insiders", date: t.date, title: `Insider ${t.side === "buy" ? "buy" : "sale"}${t.cluster ? " (cluster)" : ""}`, detail: `${who || "Insider"}: ${fmtNum(t.shares)} shares${t.value ? `, about ${fmtMoneyCompact(t.value)}` : ""}`, tone: t.side === "buy" ? "good" : "bad", side: t.side, cluster: t.cluster });
  }
  if (on("dividends")) for (const d of L.dividends || []) out.push({ layer: "dividends", date: d.date, title: "Ex-dividend", detail: `$${d.amount.toFixed(d.amount < 0.1 ? 4 : 2)} per share` });
  if (on("pitches")) for (const p of L.pitches || []) {
    const cases = [p.bear && `bear ${fmtUSD(p.bear)}`, p.base && `base ${fmtUSD(p.base)}`, p.bull && `bull ${fmtUSD(p.bull)}`].filter(Boolean).join(", ");
    out.push({ layer: "pitches", date: p.date, title: `Pitch: ${p.direction} (${p.status})`, detail: [p.title, p.author && `by ${p.author}`, cases].filter(Boolean).join(" · "), href: `#/pitches/${p.id}` });
  }
  if (on("trades")) for (const t of L.trades || []) out.push({ layer: "trades", date: t.date, title: `Fund ${t.side === "buy" ? "bought" : "sold"} ${+t.shares.toFixed(2)} shares`, detail: Number.isFinite(t.price) && t.price > 0 ? `at ${fmtUSD(t.price)}` : "", tone: t.side === "buy" ? "good" : "bad", side: t.side });
  if (on("agents")) for (const r of L.agents || []) out.push({ layer: "agents", date: r.date, title: `Agent: ${workflowName(r.workflow)}`, detail: r.title, href: `#/agents/runs/${r.runId}` });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

const WF = { filing_flash: "Filing flash", red_team: "Red team", morning_brief: "Morning brief", earnings_preview: "Earnings preview", thesis_check: "Thesis check", engine: "Custom agent" };
const workflowName = (w) => WF[w] || String(w || "agent").replace(/_/g, " ");

// Index of the bar each event belongs to: the first bar on or after the event's date (weekly
// and monthly bars collect the days before them). Events past the last bar are dropped, except
// an upcoming earnings date, which the caller can show in the list.
export function bucket(events, bars, { intraday = false } = {}) {
  const byBar = new Map();
  if (!bars.length) return byBar;
  const first = bars[0].date, last = bars[bars.length - 1].date;
  for (const e of events) {
    if (e.date < first || e.date > last) continue;
    let lo = 0, hi = bars.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (bars[mid].date < e.date) lo = mid + 1; else hi = mid; }
    if (intraday && bars[lo].date !== e.date) continue;
    // Intraday bars share a date: put the event on that day's first bar.
    if (!byBar.has(lo)) byBar.set(lo, []);
    byBar.get(lo).push(e);
  }
  return byBar;
}

// lightweight-charts markers, at most one per layer per bar (the hover card lists them all).
// colors: { up, down, warn, s1..s5, muted }
export function toMarkers(byBar, bars, colors) {
  const out = [];
  for (const [i, evs] of byBar) {
    const t = bars[i].t;
    const seen = new Set();
    for (const e of evs) {
      const key = e.layer === "insiders" || e.layer === "trades" ? `${e.layer}-${e.side}` : e.layer;
      if (seen.has(key)) continue;
      seen.add(key);
      const sameDay = evs.filter((x) => (x.layer === "insiders" || x.layer === "trades" ? `${x.layer}-${x.side}` : x.layer) === key);
      out.push(markerFor(e, t, colors, sameDay.length));
    }
  }
  return out.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
}

function markerFor(e, time, c, n) {
  const more = n > 1 ? ` ×${n}` : "";
  switch (e.layer) {
    case "trades": return { time, position: e.side === "buy" ? "belowBar" : "aboveBar", shape: e.side === "buy" ? "arrowUp" : "arrowDown", color: e.side === "buy" ? c.up : c.down, text: `${e.side === "buy" ? "Buy" : "Sell"}${more}` };
    case "insiders": return { time, position: e.side === "buy" ? "belowBar" : "aboveBar", shape: "circle", color: e.side === "buy" ? c.s3 : c.muted, text: e.cluster ? "Insider cluster" : `${e.side === "buy" ? "Ins. buy" : "Ins. sale"}${more}`, size: e.cluster ? 1.4 : 0.8 };
    case "earnings": return { time, position: "aboveBar", shape: "square", color: e.tone === "bad" ? c.down : e.tone === "good" ? c.up : c.s2, text: e.tone === "good" ? "E beat" : e.tone === "bad" ? "E miss" : GLYPH.earnings, size: 0.9 };
    case "filings": return { time, position: "aboveBar", shape: "circle", color: e.serious ? c.warn : c.s2, text: e.serious ? "8-K!" : `${GLYPH.filings}${more}`, size: e.serious ? 1.2 : 0.6 };
    case "dividends": return { time, position: "belowBar", shape: "circle", color: c.s4, text: GLYPH.dividends, size: 0.6 };
    case "pitches": return { time, position: "belowBar", shape: "square", color: c.s1, text: GLYPH.pitches, size: 1 };
    case "agents": return { time, position: "aboveBar", shape: "circle", color: c.s5, text: `${GLYPH.agents}${more}`, size: 0.7 };
    default: return { time, position: "inBar", shape: "circle", color: c.muted, text: "" };
  }
}

// Price lines: [{ price, title, color, style: 'dashed'|'dotted'|'solid' }]
export function priceLevels(ann, layers, ctx, c) {
  const out = [];
  const ok = (x) => Number.isFinite(x) && x > 0;
  if (layers.levels !== false) {
    if (ok(ctx.position?.avgCost)) out.push({ price: ctx.position.avgCost, title: "Avg cost", color: c.s3, style: "dashed" });
    if (ok(ctx.thesis?.targetPrice)) out.push({ price: ctx.thesis.targetPrice, title: "Target", color: c.s4, style: "dashed" });
    for (const a of ctx.priceAlerts || []) if (ok(a.price)) out.push({ price: a.price, title: `Alert ${a.direction}`, color: c.warn, style: "dashed" });
  }
  if (layers.tripwires !== false) for (const t of ann?.layers?.tripwires || []) {
    out.push({ price: t.value, title: `Tripwire ${t.kind === "price_below" ? "below" : "above"}${t.status === "tripped" ? " (tripped)" : ""}`, color: c.warn, style: "dotted" });
  }
  const s = ann?.scenarios;
  if (layers.scenarios !== false && s) {
    const p = s.probabilities;
    const pct = (k) => (p && Number.isFinite(p[k]) ? ` ${Math.round(p[k] * 100)}%` : "");
    if (ok(s.bull)) out.push({ price: s.bull, title: `Bull${pct("bull")}`, color: c.up, style: "solid" });
    if (ok(s.base)) out.push({ price: s.base, title: `Base${pct("base")}`, color: c.s1, style: "solid" });
    if (ok(s.bear)) out.push({ price: s.bear, title: `Bear${pct("bear")}`, color: c.down, style: "solid" });
  }
  return out;
}

const LAYER_NAME = Object.fromEntries(LAYERS.map(([k, l]) => [k, l]));

// The hover card for one bar's events.
export function eventCardHtml(date, evs) {
  if (!evs?.length) return "";
  return `<div class="rv-evcard-date">${esc(date)}</div><ul class="rv-evlist">${evs.slice(0, 6).map(eventLi).join("")}</ul>${evs.length > 6 ? `<p class="muted small">and ${evs.length - 6} more in the list below the chart</p>` : ""}`;
}

function eventLi(e) {
  const link = e.href ? `<a href="${esc(e.href)}">${esc(e.title)}</a>` : e.url ? `<a href="${safeUrl(e.url)}" target="_blank" rel="noopener">${esc(e.title)}<span class="sr-only"> (opens in a new tab)</span></a>` : esc(e.title);
  return `<li class="rv-ev rv-ev-${esc(e.layer)}${e.tone ? ` tone-${esc(e.tone)}` : ""}"><span class="rv-ev-dot" aria-hidden="true"></span><span class="rv-ev-body"><span class="rv-ev-title">${link}</span>${e.detail ? `<span class="rv-ev-detail">${esc(e.detail)}</span>` : ""}</span></li>`;
}

// Every event in the chart's window, newest first, grouped by month: the text version of the
// markers (keyboard and screen-reader users get the same information).
export function eventListHtml(events, { from, to } = {}) {
  const inWin = events.filter((e) => (!from || e.date >= from) && (!to || e.date <= to || e.upcoming)).reverse();
  if (!inWin.length) return `<p class="muted small">No events on the chart for this timeframe.</p>`;
  const counts = {};
  for (const e of inWin) counts[e.layer] = (counts[e.layer] || 0) + 1;
  const groups = new Map();
  for (const e of inWin) {
    const m = e.date.slice(0, 7);
    if (!groups.has(m)) groups.set(m, []);
    groups.get(m).push(e);
  }
  const monthName = (m) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return `
    <p class="muted small rv-evcount">${Object.entries(counts).map(([k, n]) => `${n} ${esc(LAYER_NAME[k] || k).toLowerCase()}`).join(" · ")}</p>
    ${[...groups].map(([m, evs]) => `<h4 class="rv-evmonth">${esc(monthName(m))}</h4><ul class="rv-evlist">${evs.map((e) => eventLi({ ...e, title: `${e.date.slice(5)} · ${e.title}` })).join("")}</ul>`).join("")}`;
}
