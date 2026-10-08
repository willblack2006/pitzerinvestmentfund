// Pure helpers for the Today page: filtering wire headlines down to market news, matching
// headlines to holdings, parsing the Fed's calendar and press RSS, and building / validating
// the daily AI recap. No I/O here, so it's all unit-testable.

// Market snapshot: what shows in the strip, and whether "up" is good for a long-only fund.
// `tone: "market"` colors up green / down red; `tone: "neutral"` shows the arrow only, since a
// rising VIX, yield, oil price or dollar isn't simply good or bad.
const INSTRUMENTS = [
  { symbol: "^GSPC", label: "S&P 500", tone: "market" },
  { symbol: "^IXIC", label: "Nasdaq", tone: "market" },
  { symbol: "^DJI", label: "Dow", tone: "market" },
  { symbol: "^RUT", label: "Russell 2000", tone: "market" },
  { symbol: "^VIX", label: "VIX", tone: "neutral", term: "vix" },
  { symbol: "^TNX", label: "10-yr yield", tone: "neutral", term: "tenYearYield", unit: "%" },
  { symbol: "CL=F", label: "Oil (WTI)", tone: "neutral", unit: "$" },
  { symbol: "GC=F", label: "Gold", tone: "neutral", unit: "$" },
  { symbol: "DX-Y.NYB", label: "Dollar index", tone: "neutral" },
  { symbol: "BTC-USD", label: "Bitcoin", tone: "neutral", unit: "$" },
];

const SECTORS = [
  ["XLK", "Technology"], ["XLF", "Financials"], ["XLV", "Health care"], ["XLE", "Energy"],
  ["XLY", "Consumer discretionary"], ["XLP", "Consumer staples"], ["XLI", "Industrials"],
  ["XLB", "Materials"], ["XLU", "Utilities"], ["XLRE", "Real estate"], ["XLC", "Communication services"],
];

// Finnhub's "general" feed mixes world and political news in with markets. Keep a headline
// if its title or summary mentions any of these (whole words, case-insensitive).
const MARKET_WORDS = [
  "stock", "stocks", "shares", "market", "markets", "wall street", "s&p", "nasdaq", "dow", "index",
  "fed", "federal reserve", "rate", "rates", "inflation", "cpi", "jobs", "payrolls", "unemployment", "gdp",
  "economy", "economic", "recession", "treasury", "treasuries", "yield", "yields", "bond", "bonds",
  "earnings", "profit", "revenue", "sales", "forecast", "guidance", "outlook", "quarter",
  "oil", "opec", "crude", "gold", "dollar", "currency", "yen", "euro", "bitcoin", "crypto",
  "tariff", "tariffs", "trade", "merger", "acquisition", "acquire", "deal", "ipo", "buyback", "dividend",
  "bank", "banks", "investor", "investors", "fund", "funds", "ceo", "company", "billion", "debt", "credit",
];
const WORD_RE = new RegExp(`(^|[^a-z0-9&])(${MARKET_WORDS.map((w) => w.replace(/[&]/g, "\\&")).join("|")})(?=$|[^a-z0-9&])`, "i");

const normHeadline = (h) => String(h || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

function isMarketNews(item) {
  return WORD_RE.test(`${item.headline || ""} ${item.summary || ""}`);
}

// A news item's image only if it's an actual article photo: Finnhub sends the outlet's logo
// for Reuters and Bloomberg stories and Yahoo's logo for many company stories.
function realImage(url) {
  const u = String(url || "");
  if (!/^https:\/\//.test(u)) return null;
  if (/finnhub\.io\/file\/finnhub\/logo|yahoo_finance_en-US|\/logo[s]?[/_.-]/i.test(u)) return null;
  return u;
}

// Drop the " - Reuters" suffix (the source is shown separately) and a summary that only
// repeats the headline, which is how Reuters items arrive from Finnhub.
function tidyItem(n) {
  let headline = String(n.headline || "").trim();
  if (n.source && headline.toLowerCase().endsWith(` - ${String(n.source).toLowerCase()}`)) headline = headline.slice(0, -(n.source.length + 3)).trim();
  const h = normHeadline(headline), s = normHeadline(n.summary);
  const summary = !s || s.startsWith(h) || h.startsWith(s) ? "" : String(n.summary).trim();
  return { ...n, headline, summary, image: realImage(n.image) };
}

// Valid items, tidied, with the same headline from two outlets collapsed, newest first.
function dedupeNews(items = []) {
  const seen = new Set();
  return items
    .filter((n) => n && n.headline && n.url)
    .map(tidyItem)
    .filter((n) => { const k = normHeadline(n.headline); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => String(b.datetime || "").localeCompare(String(a.datetime || "")));
}

// Market-relevant subset of dedupeNews.
function filterMarketNews(items = []) {
  return dedupeNews(items).filter(isMarketNews);
}

// Short company name for matching: "Apollo Global Management, Inc." -> "apollo global management".
function shortName(name) {
  return String(name || "").toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\b(inc|corp|corporation|co|company|ltd|plc|holdings|group|the|class [a-z]|sa|nv|ag|se)\b/g, " ")
    .replace(/\s+/g, " ").trim();
}

// Which holdings a headline mentions, by ticker in "(TSLA)" / "$TSLA" form or by company
// name. Bare tickers are not matched as words (too many collide with English: "ON", "ALL").
function mentionedHoldings(item, holdings = []) {
  const text = `${item.headline || ""} ${item.summary || ""}`;
  const lower = ` ${text.toLowerCase().replace(/[^a-z0-9&$() ]/g, " ")} `;
  return holdings.filter((h) => {
    const sym = h.symbol.toUpperCase();
    if (text.includes(`(${sym})`) || text.includes(`$${sym} `) || text.includes(`NASDAQ:${sym}`) || text.includes(`NYSE:${sym}`)) return true;
    const n = shortName(h.name);
    return n.length >= 4 && lower.includes(` ${n} `);
  }).map((h) => h.symbol);
}

// Does this item really talk about the company? Finnhub's per-company feed includes loosely
// related stories (an APO search returned a SpaceX borrowing story). Keep an item only if it
// names the company, or carries the ticker in capitals (3+ letters, so "ON" or "A" can't match).
function aboutCompany(item, holding) {
  if (mentionedHoldings(item, [holding]).length) return true;
  const sym = holding.symbol.toUpperCase();
  return sym.length >= 3 && new RegExp(`(^|[^A-Za-z0-9])${sym.replace(/[.^$]/g, "\\$&")}([^A-Za-z0-9]|$)`).test(`${item.headline || ""} ${item.summary || ""}`);
}

// Per-holding latest headlines within `withinHours`, at most `perSymbol` each, newest first.
// `names` maps symbol -> company name for the relevance check.
function recentHoldingNews(newsBySymbol = {}, { now = Date.now(), withinHours = 36, perSymbol = 2, names = {} } = {}) {
  const cutoff = now - withinHours * 3600 * 1000;
  const out = [];
  for (const [symbol, items] of Object.entries(newsBySymbol)) {
    const holding = { symbol, name: names[symbol] || "" };
    const recent = (items || [])
      .filter((n) => n?.headline && n.datetime && new Date(n.datetime).getTime() >= cutoff && aboutCompany(n, holding))
      .map(tidyItem)
      .sort((a, b) => b.datetime.localeCompare(a.datetime))
      .slice(0, perSymbol);
    if (recent.length) out.push({ symbol, items: recent });
  }
  return out.sort((a, b) => b.items[0].datetime.localeCompare(a.items[0].datetime));
}

// ---- Federal Reserve ----

const decodeEntities = (s) => String(s || "")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&#10;/g, "\n").replace(/&amp;/g, "&");
const stripTags = (s) => decodeEntities(s).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

// federalreserve.gov/json/calendar.json -> upcoming/recent FOMC meetings and minutes.
// Each meeting record is dated on its final (decision) day; the description holds the range.
function parseFedCalendar(json, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const events = (json?.events || []).filter((e) => e?.type === "FOMC" && /^\d{4}-\d{2}$/.test(e.month || "") && /^\d{1,2}$/.test(String(e.days || "")));
  const rows = events.map((e) => ({
    date: `${e.month}-${String(e.days).padStart(2, "0")}`,
    kind: /minutes/i.test(e.title) ? "minutes" : /press/i.test(e.title) ? "press" : /meeting/i.test(e.title) ? "meeting" : "other",
    title: String(e.title || "").trim(),
    detail: stripTags(e.description || ""),
    time: e.time || null,
  })).filter((r) => r.kind !== "other");
  rows.sort((a, b) => a.date.localeCompare(b.date));
  const meetings = rows.filter((r) => r.kind === "meeting");
  return {
    nextMeeting: meetings.find((m) => m.date >= today) || null,
    lastMeeting: [...meetings].reverse().find((m) => m.date < today) || null,
    nextMinutes: rows.find((r) => r.kind === "minutes" && r.date >= today) || null,
    meetingDates: meetings.map((m) => m.date),
  };
}

// Minimal RSS 2.0 parse (the Fed's feeds): [{ title, link, date }], newest first.
function parseRss(xml, limit = 10) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  const field = (block, tag) => {
    const f = block.match(new RegExp(`<${tag}>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*</${tag}>`));
    return f ? decodeEntities(f[1]).trim() : "";
  };
  while ((m = re.exec(String(xml || ""))) && items.length < limit) {
    const title = field(m[1], "title"), link = field(m[1], "link"), pub = field(m[1], "pubDate");
    const d = new Date(pub);
    if (title && /^https?:\/\//.test(link)) items.push({ title, link, date: Number.isNaN(d.getTime()) ? null : d.toISOString() });
  }
  return items.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

// ---- AI recap ----

const RECAP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["bullets", "forUs"],
  properties: {
    bullets: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["text", "sources"],
        properties: { text: { type: "string" }, sources: { type: "array", items: { type: "integer" } } },
      },
    },
    forUs: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["text", "sources"],
        properties: { text: { type: "string" }, sources: { type: "array", items: { type: "integer" } } },
      },
    },
  },
};

const pctStr = (v) => (Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` : "n/a");

// The recap's whole input as one text block, with every headline numbered so the model can
// cite them. Returns { text, sources } where sources[i - 1] is headline number i.
function buildRecapInput({ date, edition = "", marketState = null, snapshot = [], sectors = [], headlines = [], holdingNews = [], holdings = [] }) {
  const sources = [];
  const add = (h, tag = "") => { sources.push({ headline: h.headline, url: h.url, source: h.source || "", symbol: tag || null }); return sources.length; };
  // Before the open and after the close, Yahoo's "day change" is the last full session's;
  // say so, or a premarket recap would describe yesterday's moves as today's.
  const live = marketState === "REGULAR";
  const lines = [`Date: ${date}${edition ? `, ${edition} edition` : ""}`];
  if (marketState) lines.push(`US market status: ${live ? "open; changes are so far today" : "not in regular trading; changes are from the most recent completed session"}`);
  lines.push("", "Market snapshot (day change):");
  for (const s of snapshot) lines.push(`- ${s.label}: ${Number.isFinite(s.price) ? s.price.toFixed(2) : "n/a"} (${pctStr(s.changePct)})`);
  if (sectors.length) {
    lines.push("", "Sector ETFs (day change):");
    lines.push(sectors.map((s) => `${s.label} ${pctStr(s.changePct)}`).join("; "));
  }
  lines.push("", `Fund holdings: ${holdings.join(", ") || "none"}`, "", "Market headlines:");
  for (const h of headlines) lines.push(`[${add(h)}] ${h.headline}${h.summary ? ` (${String(h.summary).replace(/\s+/g, " ").slice(0, 200)})` : ""} (${h.source || "unknown source"})`);
  if (holdingNews.length) {
    lines.push("", "Headlines about fund holdings:");
    for (const g of holdingNews) for (const h of g.items) lines.push(`[${add(h, g.symbol)}] ${g.symbol}: ${h.headline} (${h.source || "unknown source"})`);
  }
  return { text: lines.join("\n"), sources };
}

const RECAP_SYSTEM = `You write a market recap for a student-run investment fund. The edition is premarket, midday or after the close; say what has happened so far in that window.
Use ONLY the headlines and numbers provided. Do not add facts, numbers, causes or forecasts that are not in them.
Write:
- "bullets": 4 to 6 short bullets on what moved markets and why, most important first. Attribute causes to the reports ("Reuters reports...", "according to CNBC...") rather than stating them as fact.
- "forUs": up to 3 bullets on news that touches the fund's holdings (name the ticker). Empty array if nothing relevant.
Every bullet cites the numbers of the headlines it relies on in "sources". If the headlines don't explain a move, say the reason isn't clear from today's coverage.
Never give buy, sell or hold advice and never predict prices. Plain language a second-year student can follow; no hype.`;

// Validate the model's JSON against what was sent: keep only bullets with text, drop any
// cited source number that doesn't exist, cap bullet counts.
function parseRecap(raw, sourceCount) {
  let obj = raw;
  if (typeof raw === "string") {
    try { obj = JSON.parse(raw); } catch { return null; }
  }
  if (!obj || typeof obj !== "object") return null;
  const clean = (arr, max) => (Array.isArray(arr) ? arr : [])
    .filter((b) => b && typeof b.text === "string" && b.text.trim())
    .slice(0, max)
    .map((b) => {
      const sources = [...new Set((Array.isArray(b.sources) ? b.sources : []).filter((n) => Number.isInteger(n) && n >= 1 && n <= sourceCount))];
      // Inline "[38]" or "(15, 18)" markers duplicate the source chips the page draws. Only
      // strip parentheses whose numbers are all cited sources, so "(2027)" survives.
      const text = b.text
        .replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, "")
        .replace(/\s*\((\d+(?:\s*,\s*\d+)*)\)/g, (m, nums) => (nums.split(",").every((n) => sources.includes(Number(n))) ? "" : m));
      return { text: text.trim().slice(0, 500), sources };
    });
  const bullets = clean(obj.bullets, 6);
  if (!bullets.length) return null;
  return { bullets, forUs: clean(obj.forUs, 3) };
}

// The "30-second read": two or three plain sentences from the numbers alone, so the page
// says what happened even without an AI recap. Facts only, no advice.
function briefingLines({ snapshot = [], portfolio = null, marketState = null } = {}) {
  const by = Object.fromEntries(snapshot.map((r) => [r.symbol, r]));
  const when = marketState === "REGULAR" ? "so far today" : "in the last session";
  const mv = (v, plural = false) => `${v > 0 ? "rose" : v < 0 ? "fell" : plural ? "were flat" : "was flat"}${v ? ` ${Math.abs(v).toFixed(2)}%` : ""}`;
  const lines = [];
  const spx = by["^GSPC"];
  if (Number.isFinite(spx?.changePct)) {
    const others = ["^IXIC", "^RUT"].map((s) => by[s]).filter((r) => Number.isFinite(r?.changePct));
    lines.push(`The S&P 500 ${mv(spx.changePct)} ${when}${others.length ? `; ${others.map((r) => `the ${r.label} ${mv(r.changePct)}`).join(" and ")}` : ""}.`);
  }
  // Biggest mover among everything else on the strip, if it's notable.
  const rest = snapshot.filter((r) => !["^GSPC", "^IXIC", "^DJI", "^RUT"].includes(r.symbol) && Number.isFinite(r.changePct));
  const big = rest.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))[0];
  if (big && Math.abs(big.changePct) >= 1) lines.push(`${big.label} ${mv(big.changePct)}, the biggest move among the markets tracked here.`);
  if (portfolio && Number.isFinite(portfolio.dayPct)) {
    lines.push(`Our holdings ${mv(portfolio.dayPct, true)} (${portfolio.dayChange >= 0 ? "+" : "−"}$${Math.abs(Math.round(portfolio.dayChange)).toLocaleString("en-US")}): ${portfolio.up} up, ${portfolio.down} down.`);
  }
  return lines;
}

// Day change for the fund from live quotes: totals plus the biggest movers either way.
function portfolioDay(positions = [], quotes = {}) {
  const rows = positions.map((p) => {
    const q = quotes[p.symbol];
    if (!q || !Number.isFinite(q.change) || !Number.isFinite(q.previousClose)) return null;
    return { symbol: p.symbol, name: q.name || null, changePct: q.changePct, dayChange: q.change * p.shares, prevValue: q.previousClose * p.shares };
  }).filter(Boolean);
  if (!rows.length) return null;
  const dayChange = rows.reduce((s, r) => s + r.dayChange, 0);
  const prev = rows.reduce((s, r) => s + r.prevValue, 0);
  const sorted = [...rows].sort((a, b) => b.changePct - a.changePct);
  return {
    dayChange, dayPct: prev ? (dayChange / prev) * 100 : null,
    up: rows.filter((r) => r.changePct > 0).length, down: rows.filter((r) => r.changePct < 0).length,
    best: sorted.slice(0, 3).filter((r) => r.changePct > 0),
    worst: sorted.slice(-3).reverse().filter((r) => r.changePct < 0),
    covered: rows.length, total: positions.length,
  };
}

// Downsample a price series to at most `n` closes for a sparkline (keeps first and last).
function sparkPoints(bars = [], n = 80) {
  const closes = bars.map((b) => b.close).filter(Number.isFinite);
  if (closes.length <= n) return closes;
  const step = (closes.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => closes[Math.round(i * step)]);
}

// Wall-clock parts in New York time, for edition scheduling.
function nyTime(d = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short" })
    .formatToParts(d).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24, minute: Number(parts.minute), weekday: parts.weekday };
}

// Three editions per weekday, New York time. A slot is captured only inside its own window
// (from its start until the next slot starts, or 23:59 for postmarket), so a late server
// start never files afternoon news under "premarket".
const SLOTS = [
  { key: "premarket", label: "Premarket", start: 8 * 60 },
  { key: "midday", label: "Midday", start: 12 * 60 + 30 },
  { key: "postmarket", label: "Postmarket", start: 16 * 60 + 30 },
];

const isWeekday = (weekday) => !["Sat", "Sun"].includes(weekday);

// The slot that should be captured right now, or null (weekend, before 8 AM, or already done).
function dueSlot(now = new Date(), capturedToday = []) {
  const t = nyTime(now);
  if (!isWeekday(t.weekday)) return null;
  const mins = t.hour * 60 + t.minute;
  let current = null;
  for (const s of SLOTS) if (mins >= s.start) current = s;
  return current && !capturedToday.includes(current.key) ? { date: t.date, slot: current.key } : null;
}

// Which slots have started by `now` on `date` (for greying out future editions).
function slotsStarted(date, now = new Date()) {
  const t = nyTime(now);
  if (date < t.date) return SLOTS.map((s) => s.key);
  if (date > t.date) return [];
  const mins = t.hour * 60 + t.minute;
  return SLOTS.filter((s) => mins >= s.start).map((s) => s.key);
}

// Today plus the previous `back` weekdays, newest first (ISO dates, New York calendar).
function recentWeekdays(now = new Date(), back = 3) {
  const out = [];
  let d = new Date(`${nyTime(now).date}T12:00:00Z`);
  while (out.length < back + 1) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() - 864e5);
  }
  return out;
}

module.exports = {
  INSTRUMENTS, SECTORS, RECAP_SCHEMA, RECAP_SYSTEM,
  isMarketNews, realImage, briefingLines, portfolioDay, sparkPoints, tidyItem, dedupeNews, filterMarketNews, mentionedHoldings, aboutCompany, recentHoldingNews, shortName,
  parseFedCalendar, parseRss, buildRecapInput, parseRecap, nyTime, SLOTS, dueSlot, slotsStarted, recentWeekdays,
};
