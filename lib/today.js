// Today page: captures the three daily news editions (premarket / midday / postmarket) into
// the news_editions table, and gathers the live side-column data. Pure logic lives in
// lib/marketNews.js; this file does the I/O.
const db = require("../db");
const finnhub = require("./sources/finnhub");
const yahoo = require("./sources/yahoo");
const fred = require("./sources/fred");
const fed = require("./sources/fed");
const claude = require("./sources/claude");
const openai = require("./sources/openai");
const mn = require("./marketNews");

// Which AI writes the recap: OpenAI if OPENAI_API_KEY is set, else Claude Haiku 5.5 if
// ANTHROPIC_API_KEY is set, else none. Prices are per million tokens, used for the cost
// estimate on each edition (from the API's own token counts, not a bill).
const CLAUDE_RECAP_PRICE = { input: 0.10, output: 0.50 };
function recapProvider() {
  if (openai.configured()) return { name: "openai", run: openai.marketRecap, price: (model) => openai.priceFor(model) };
  if (claude.configured()) return { name: "anthropic", run: claude.marketRecap, price: () => CLAUDE_RECAP_PRICE };
  return null;
}
const recapEnabled = () => !!recapProvider();
const KEEP_DAYS = 12;

// Resolve to `fallback` if `promise` takes longer than `ms` (the promise keeps running and
// still fills its cache for the next page load).
const withTimeout = (promise, ms, fallback) => Promise.race([promise, new Promise((r) => setTimeout(() => r(fallback), ms))]);

async function quotesFor(symbols) {
  try { return await yahoo.getQuotes(symbols); } catch { return {}; }
}

function snapshotRows(quotes) {
  return mn.INSTRUMENTS.map((i) => ({ ...i, price: quotes[i.symbol]?.price ?? null, changePct: quotes[i.symbol]?.changePct ?? null }));
}
function sectorRows(quotes) {
  return mn.SECTORS.map(([symbol, label]) => ({ symbol, label, changePct: quotes[symbol]?.changePct ?? null }))
    .sort((a, b) => (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity));
}

// One edition: headlines, holdings news, market numbers, and (if a key is set) the AI recap.
async function captureEdition(date, slot) {
  const positions = db.prepare("SELECT symbol, shares FROM positions ORDER BY symbol").all();
  const holdings = positions.map((p) => p.symbol);
  const quotes = await quotesFor([...mn.INSTRUMENTS.map((i) => i.symbol), ...mn.SECTORS.map(([s]) => s), ...holdings]);
  const named = holdings.map((symbol) => ({ symbol, name: quotes[symbol]?.name || "" }));

  let wire = [], newsError = null;
  try { wire = finnhub.apiKey() ? await finnhub.getMarketNews("general") : []; } catch (err) { newsError = err.message; }
  const headlines = mn.filterMarketNews(wire).slice(0, 40).map((h) => ({ ...h, holdings: mn.mentionedHoldings(h, named) }));

  const bySymbol = {};
  if (finnhub.apiKey()) {
    const results = await Promise.allSettled(holdings.map((s) => finnhub.getCompanyNews(s)));
    results.forEach((r, i) => { if (r.status === "fulfilled") bySymbol[holdings[i]] = r.value; });
  }
  const holdingNews = mn.recentHoldingNews(bySymbol, { withinHours: 36, perSymbol: 2, names: Object.fromEntries(named.map((h) => [h.symbol, h.name])) });

  const snapshot = snapshotRows(quotes), sectors = sectorRows(quotes);
  const slotLabel = mn.SLOTS.find((s) => s.key === slot)?.label || slot;
  let recap = null, recapError = null;
  const provider = recapProvider();
  if (!provider) recapError = "disabled";
  else if (wire.length) {
    try {
      // The recap reads every wire headline, not just the filtered list: world news (shipping,
      // conflicts) often explains oil or index moves and the filter would drop it.
      const all = mn.dedupeNews(wire);
      const input = mn.buildRecapInput({ date, edition: slotLabel, marketState: quotes["^GSPC"]?.marketState || null, snapshot, sectors, headlines: all.slice(0, 100), holdingNews, holdings });
      const out = await provider.run(input.text);
      const parsed = mn.parseRecap(out.text, input.sources.length);
      if (!parsed) throw new Error("The recap came back empty or malformed.");
      recap = {
        ...parsed,
        sources: input.sources,
        model: out.model,
        usage: out.usage,
        costUsd: (() => { const pr = provider.price(out.model); return pr ? (out.usage.input * pr.input + out.usage.output * pr.output) / 1e6 : null; })(),
      };
      console.log(`[today] ${date} ${slot} recap (${out.model}): ${out.usage.input} in / ${out.usage.output} out tokens${recap.costUsd != null ? `, ~$${recap.costUsd.toFixed(4)}` : ""}`);
    } catch (err) {
      recapError = err.message;
      console.error(`[today] recap failed for ${date} ${slot}:`, err.message);
    }
  }

  const portfolio = mn.portfolioDay(positions, quotes);
  const briefing = mn.briefingLines({ snapshot, portfolio, marketState: quotes["^GSPC"]?.marketState || null });
  const payload = { date, slot, capturedAt: new Date().toISOString(), snapshot, sectors, briefing, portfolio, headlines, holdingNews, recap, recapError, newsError };
  db.prepare("INSERT OR REPLACE INTO news_editions (date, slot, payload, created_at) VALUES (?, ?, ?, ?)").run(date, slot, JSON.stringify(payload), payload.capturedAt);
  const cutoff = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString().slice(0, 10);
  db.prepare("DELETE FROM news_editions WHERE date < ?").run(cutoff);
  return payload;
}

let capturing = false;
// Called from the scheduler every tick: captures the current slot if it hasn't been yet.
async function maybeCapture(now = new Date()) {
  if (capturing) return null;
  const today = mn.nyTime(now).date;
  const done = db.prepare("SELECT slot FROM news_editions WHERE date = ?").all(today).map((r) => r.slot);
  const due = mn.dueSlot(now, done);
  if (!due) return null;
  capturing = true;
  try {
    const p = await captureEdition(due.date, due.slot);
    console.log(`[today] captured ${due.date} ${due.slot} (${p.headlines.length} headlines)`);
    return p;
  } finally {
    capturing = false;
  }
}

// The toggle's options: today plus the previous 3 weekdays, each with three slots marked
// captured / not yet started / missed.
function listEditions(now = new Date()) {
  const dates = mn.recentWeekdays(now, 3);
  const rows = db.prepare(`SELECT date, slot FROM news_editions WHERE date IN (${dates.map(() => "?").join(",")})`).all(...dates);
  const have = new Set(rows.map((r) => `${r.date}|${r.slot}`));
  return dates.map((date) => {
    const started = mn.slotsStarted(date, now);
    return {
      date,
      slots: mn.SLOTS.map((s) => ({
        key: s.key, label: s.label,
        status: have.has(`${date}|${s.key}`) ? "ready" : started.includes(s.key) ? "missed" : "upcoming",
      })),
    };
  });
}

function getEdition(date, slot) {
  const row = db.prepare("SELECT payload FROM news_editions WHERE date = ? AND slot = ?").get(date, slot);
  return row ? JSON.parse(row.payload) : null;
}

function latestEdition(now = new Date()) {
  const dates = mn.recentWeekdays(now, 3);
  const row = db.prepare(`SELECT payload FROM news_editions WHERE date IN (${dates.map(() => "?").join(",")}) ORDER BY date DESC, CASE slot WHEN 'postmarket' THEN 0 WHEN 'midday' THEN 1 ELSE 2 END LIMIT 1`).get(...dates);
  return row ? JSON.parse(row.payload) : null;
}

// Live side column (not stored): market numbers, sectors, movers, Fed, this week's events.
// Index tiles with a 5-day sparkline (15-minute bars, cached 15 min per symbol).
const TILE_SYMBOLS = ["^GSPC", "^IXIC", "^DJI", "^RUT", "^VIX", "^TNX"];

async function sparklines() {
  const out = {};
  await Promise.all(TILE_SYMBOLS.map(async (s) => {
    try { out[s] = mn.sparkPoints(await yahoo.getChart(s, "5d", "15m"), 80); } catch { /* tile shows no line */ }
  }));
  return out;
}

// Company logos for holdings (cached a month). A cold cache shouldn't hold up the page:
// whatever isn't back within the timeout falls back to a monogram and fills in next load.
async function logos(symbols) {
  if (!finnhub.apiKey()) return {};
  const out = {};
  await withTimeout(Promise.all(symbols.map(async (s) => { try { out[s] = await finnhub.getLogo(s); } catch { /* monogram */ } })), 3000, null);
  return out;
}

async function liveSide() {
  const positions = db.prepare("SELECT symbol, shares FROM positions ORDER BY symbol").all();
  const holdings = positions.map((p) => p.symbol);
  const today = new Date().toISOString().slice(0, 10);
  const weekOut = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const [quotesR, gainersR, losersR, activeR, fomcR, pressR, earningsR, cpiR, jobsR, sparkR, logosR] = await Promise.allSettled([
    quotesFor([...mn.INSTRUMENTS.map((i) => i.symbol), ...mn.SECTORS.map(([s]) => s), ...holdings]),
    yahoo.getMovers("day_gainers", 6),
    yahoo.getMovers("day_losers", 6),
    yahoo.getMovers("most_actives", 6),
    fed.getFomcCalendar(),
    fed.getFedPress(3),
    // Per-holding earnings share Finnhub's 60-calls/minute limit with the background jobs;
    // don't let a queue there hold up the page. Cached 12h once fetched.
    finnhub.apiKey() ? withTimeout(finnhub.getEarningsCalendar(holdings, today, weekOut), 4000, null) : Promise.resolve([]),
    fred.getReleaseDates("cpi", { months: 1 }),
    fred.getReleaseDates("jobs", { months: 1 }),
    sparklines(),
    logos(holdings),
  ]);
  const val = (r, fallback) => (r.status === "fulfilled" ? r.value : fallback);
  const quotes = val(quotesR, {});
  const snapshot = snapshotRows(quotes);
  const marketState = quotes["^GSPC"]?.marketState || null;
  const portfolio = mn.portfolioDay(positions, quotes);
  const owned = new Set(holdings);
  const flag = (rows) => rows.map((m) => ({ ...m, owned: owned.has(m.symbol) }));
  const earnings = val(earningsR, []);
  const upcoming = [
    ...(earnings || []).map((e) => ({ date: e.date, type: "earnings", title: `${e.symbol} earnings`, symbol: e.symbol, detail: e.hour === "bmo" ? "Before the open" : e.hour === "amc" ? "After the close" : "" })),
    ...val(cpiR, []).filter((d) => d >= today && d <= weekOut).map((d) => ({ date: d, type: "macro", title: "CPI release" })),
    ...val(jobsR, []).filter((d) => d >= today && d <= weekOut).map((d) => ({ date: d, type: "macro", title: "Jobs report" })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const fomc = val(fomcR, null);
  return {
    snapshot,
    sectors: sectorRows(quotes),
    marketState,
    briefing: mn.briefingLines({ snapshot, portfolio, marketState }),
    portfolio,
    sparks: val(sparkR, {}),
    logos: val(logosR, {}),
    quotesAsOf: quotes["^GSPC"]?.time || null,
    movers: { gainers: flag(val(gainersR, [])), losers: flag(val(losersR, [])), active: flag(val(activeR, [])) },
    fed: fomc ? { nextMeeting: fomc.nextMeeting, lastMeeting: fomc.lastMeeting, nextMinutes: fomc.nextMinutes, press: val(pressR, []) } : { press: val(pressR, []) },
    upcoming,
    earningsPending: earnings === null,
  };
}

// Headlines right now, for when no edition has been captured yet (first deploy, weekend).
async function liveHeadlines() {
  if (!finnhub.apiKey()) return [];
  try { return mn.filterMarketNews(await finnhub.getMarketNews("general")).slice(0, 40); } catch { return []; }
}

module.exports = { recapEnabled, captureEdition, maybeCapture, listEditions, getEdition, latestEdition, liveSide, liveHeadlines };
