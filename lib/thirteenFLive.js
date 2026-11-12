// Live 13F ingest and breadth queries. The scheduler calls run() every 5 minutes:
//  1. discover: new 13F-HR filings from EDGAR's "latest filings" feed (minutes after filing),
//     plus each day's form index as a catch-up for anything the feed rolled past while the
//     server was down;
//  2. process: for each new filing, read the cover page (period, total value) and stream the
//     holdings table, keeping only the CUSIPs in lib/seed/13fCusips.json.
// Past quarters come from lib/seed/13fSeed.json.gz (SEC's quarterly data sets, built with
// scripts/build-13f-seed.js). The seed's newest quarter is also loaded into the tables, so this
// quarter's filers can be compared with what the same filers reported last quarter.
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const db = require("../db");
const sec = require("./sources/thirteenF");
const B = require("./thirteenFBreadth");
const { notify } = require("./notify");

const CUSIPS = JSON.parse(fs.readFileSync(path.join(__dirname, "seed/13fCusips.json"), "utf8"));
const SYMBOL_OF = new Map();
for (const [sym, list] of Object.entries(CUSIPS)) if (!sym.startsWith("_")) for (const c of list) SYMBOL_OF.set(c, sym);

const nyDay = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
const addDays = (date, n) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const getSetting = (key) => db.prepare("SELECT value FROM settings WHERE key = ?").get(key)?.value ?? null;
const setSetting = (key, value) => db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, String(value));

// ---- Seed (history) ----
let seedCache = null;
function seed() {
  if (!seedCache) {
    const file = path.join(__dirname, "seed/13fSeed.json.gz");
    seedCache = fs.existsSync(file) ? JSON.parse(zlib.gunzipSync(fs.readFileSync(file))) : { periods: [], history: [], season: {}, latest: null };
  }
  return seedCache;
}

// Loads the seed's newest quarter into the tables once per seed build.
function ensureSeedLoaded() {
  const s = seed();
  if (!s.latest || getSetting("13f_seed_built") === s.builtAt) return;
  const { period, filers, positions } = s.latest;
  db.transaction(() => {
    db.prepare("DELETE FROM thirteenf_positions WHERE period = ? AND cik IN (SELECT cik FROM thirteenf_filers WHERE period = ? AND accession = 'seed')").run(period, period);
    db.prepare("DELETE FROM thirteenf_filers WHERE period = ? AND accession = 'seed'").run(period);
    const f = db.prepare("INSERT OR IGNORE INTO thirteenf_filers (cik, period, accession, totalValue) VALUES (?, ?, 'seed', ?)");
    for (const [cik, total] of filers) f.run(cik, period, total);
    const p = db.prepare("INSERT OR IGNORE INTO thirteenf_positions (cik, period, cusip, shares, value) VALUES (?, ?, ?, ?, ?)");
    for (const [cik, cusip, shares, value] of positions) p.run(cik, period, cusip, shares, value);
  })();
  setSetting("13f_seed_built", s.builtAt);
  console.log(`[13f] loaded seed quarter ${period}: ${filers.length} filers, ${positions.length} positions`);
}

// ---- Discover ----
const addPending = db.prepare("INSERT OR IGNORE INTO thirteenf_filings (accession, cik, name, filedAt) VALUES (@accession, @cik, @name, @filedAt)");

async function discoverFeed() {
  let added = 0;
  for (let page = 0; page < 10; page++) {
    const entries = B.parseAtomFeed(await sec.latestFilingsFeed(page * 100));
    let known = 0;
    for (const e of entries) {
      if (e.form !== "13F-HR") continue;
      const r = addPending.run({ accession: e.accession, cik: e.cik, name: e.name, filedAt: e.filedAt.slice(0, 10) });
      if (r.changes) added++; else known++;
    }
    if (known || entries.length < 100) break; // reached filings already seen
  }
  return added;
}

// Daily indexes from the day after the last one read up to yesterday (Eastern). The first run
// starts at the current quarter's end, which back-fills this filing season.
async function discoverIndexes() {
  const today = nyDay();
  let day = getSetting("13f_index_through") || B.quarterEnd(today);
  let added = 0;
  for (let n = 0; n < 60; n++) {
    const next = addDays(day, 1);
    if (next >= today) break;
    const dow = new Date(`${next}T00:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) {
      try {
        for (const f of B.parseFormIndex(await sec.dailyFormIndex(next))) added += addPending.run(f).changes;
      } catch (err) {
        // No index for a holiday. Yesterday's may just not be posted yet, so wait for it.
        if (!(err.status === 403 || err.status === 404) || next >= addDays(today, -1)) break;
      }
    }
    day = next;
    setSetting("13f_index_through", day);
  }
  return added;
}

// ---- Process ----
function trackedCiks() {
  return new Set(db.prepare("SELECT cik FROM thirteenf_managers").all().map((r) => r.cik));
}

async function processFiling(f, tracked) {
  const oldest = seed().latest?.period || B.prevQuarter(B.quarterEnd(nyDay()));
  const { primaryXml, infoUrl } = await sec.filingDocs(f.cik, f.accession);
  const cover = B.parsePrimaryDoc(primaryXml);
  const name = cover.name || f.name;
  if (!cover.period || cover.period < oldest || /NOTICE/i.test(cover.reportType) || !infoUrl) {
    db.prepare("UPDATE thirteenf_filings SET status = 'skipped', period = ?, name = ?, doneAt = datetime('now') WHERE accession = ?").run(cover.period, name, f.accession);
    return null;
  }
  const mine = new Map();
  let summed = 0;
  await sec.streamInfoTable(infoUrl, (row) => {
    summed += row.value || 0;
    const cusip = row.cusip.toUpperCase();
    if (row.putCall || !SYMBOL_OF.has(cusip)) return;
    const cur = mine.get(cusip) || { shares: 0, value: 0 };
    cur.shares += row.shares; cur.value += row.value;
    mine.set(cusip, cur);
  });
  const totalValue = cover.tableValueTotal || summed;
  db.transaction(() => {
    // A filer that files two originals for one quarter: the later one stands.
    const existing = db.prepare("SELECT accession, filedAt FROM thirteenf_filers WHERE cik = ? AND period = ?").get(f.cik, cover.period);
    if (!existing || existing.accession === "seed" || existing.filedAt <= f.filedAt) {
      db.prepare("INSERT INTO thirteenf_filers (cik, period, accession, name, totalValue, filedAt) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(cik, period) DO UPDATE SET accession = excluded.accession, name = excluded.name, totalValue = excluded.totalValue, filedAt = excluded.filedAt")
        .run(f.cik, cover.period, f.accession, name, totalValue, f.filedAt);
      db.prepare("DELETE FROM thirteenf_positions WHERE cik = ? AND period = ?").run(f.cik, cover.period);
      const ins = db.prepare("INSERT INTO thirteenf_positions (cik, period, cusip, shares, value) VALUES (?, ?, ?, ?, ?)");
      for (const [cusip, v] of mine) if (v.shares > 0) ins.run(f.cik, cover.period, cusip, v.shares, v.value);
    }
    db.prepare("UPDATE thirteenf_filings SET status = 'done', period = ?, name = ?, totalValue = ?, error = NULL, doneAt = datetime('now') WHERE accession = ?").run(cover.period, name, totalValue, f.accession);
  })();

  if (tracked.has(f.cik)) {
    // The manager page caches EDGAR for up to a day; drop that so it shows the new filing now.
    db.prepare("DELETE FROM api_cache WHERE cache_key IN (?, ?)").run(`13f_filings_${f.cik}`, `13f_holdings_v2_${f.cik}`);
    const held = [...new Set([...mine.keys()].map((c) => SYMBOL_OF.get(c)))].sort();
    const size = totalValue >= 1e12 ? `$${(totalValue / 1e12).toFixed(2)}T` : `$${(totalValue / 1e9).toFixed(1)}B`;
    notify("all", {
      type: "thirteenF",
      title: `13F filed: ${name} (${B.quarterLabel(cover.period)})`,
      body: `${size} reported. ${!held.length ? "Holds none of our holdings or watchlist." : held.length > 8 ? `Holds ${held.length} of our holdings and watchlist names.` : `Holds ${held.join(", ")}.`}`,
      link: "#/13f",
    });
  }
  return { period: cover.period, positions: mine.size };
}

const status = { running: false, lastRunAt: null, lastFeedAt: null, lastError: null };

// One pass: discover, then process for up to `budgetMs` (managers the fund follows first,
// then newest filings first). Safe to call while a pass is running (it returns at once).
async function run({ budgetMs = 4 * 60 * 1000 } = {}) {
  if (status.running) return { busy: true };
  status.running = true;
  const started = Date.now();
  const out = { added: 0, done: 0, failed: 0 };
  try {
    ensureSeedLoaded();
    try { out.added += await discoverFeed(); status.lastFeedAt = new Date().toISOString(); } catch (err) { status.lastError = `feed: ${err.message}`; }
    try { out.added += await discoverIndexes(); } catch (err) { status.lastError = `index: ${err.message}`; }
    const tracked = trackedCiks();
    const queue = db.prepare("SELECT * FROM thirteenf_filings WHERE status = 'pending' OR (status = 'error' AND attempts < 3) ORDER BY filedAt DESC, accession DESC LIMIT 2000").all()
      .sort((a, b) => tracked.has(b.cik) - tracked.has(a.cik));
    for (const f of queue) {
      if (Date.now() - started > budgetMs) break;
      try {
        await processFiling(f, tracked);
        out.done++;
      } catch (err) {
        out.failed++;
        db.prepare("UPDATE thirteenf_filings SET status = 'error', attempts = attempts + 1, error = ? WHERE accession = ?").run(String(err.message).slice(0, 300), f.accession);
      }
    }
  } finally {
    status.running = false;
    status.lastRunAt = new Date().toISOString();
  }
  return out;
}

// ---- Queries ----
function universe() {
  const owned = db.prepare("SELECT symbol FROM positions").all().map((r) => r.symbol);
  const watched = db.prepare("SELECT symbol FROM watchlist").all().map((r) => r.symbol);
  return { owned, watched, symbols: [...new Set([...owned, ...watched])].sort() };
}

function filerMap(period) {
  return new Map(db.prepare("SELECT cik, totalValue FROM thirteenf_filers WHERE period = ?").all(period).map((r) => [r.cik, r.totalValue]));
}
function positionMap(period, cusips) {
  const m = new Map();
  if (!cusips.length) return m;
  const rows = db.prepare(`SELECT cik, shares, value FROM thirteenf_positions WHERE period = ? AND cusip IN (${cusips.map(() => "?").join(",")})`).all(period, ...cusips);
  for (const r of rows) {
    const cur = m.get(r.cik) || { shares: 0, value: 0 };
    cur.shares += r.shares; cur.value += r.value;
    m.set(r.cik, cur);
  }
  return m;
}

// The quarter being filed now, its deadline, and whether the season is still open (filings
// keep trickling in for a week or so after the deadline).
function currentSeason(today = nyDay()) {
  const period = B.quarterEnd(today);
  const deadline = B.filingDeadline(period);
  return { period, prior: B.prevQuarter(period), deadline, label: B.quarterLabel(period), inProgress: today <= addDays(deadline, 7), daysToDeadline: B.daysAfter(today, deadline) };
}

// Breadth for one ticker for live (non-seed) quarters, against the quarter before.
function liveBreadth(symbol, period, filersByPeriod) {
  const cusips = CUSIPS[symbol] || [];
  const prior = B.prevQuarter(period);
  const get = (p) => filersByPeriod.get(p) || filersByPeriod.set(p, filerMap(p)).get(p);
  const filersPrior = get(prior);
  return {
    symbol, period, live: true,
    ...B.computeBreadth({ current: positionMap(period, cusips), prior: filersPrior.size ? positionMap(prior, cusips) : new Map(), filersCur: get(period), filersPrior }),
  };
}

function livePeriods() {
  const latestSeed = seed().latest?.period || "";
  return db.prepare("SELECT DISTINCT period FROM thirteenf_filers WHERE period > ? ORDER BY period").all(latestSeed).map((r) => r.period);
}

// One ticker's quarterly history: seed quarters, then any quarters ingested live.
function breadthHistory(symbol) {
  if (!CUSIPS[symbol]) return { symbol, tracked: false, rows: [] };
  const cache = new Map();
  const rows = seed().history.filter((r) => r.symbol === symbol)
    .concat(livePeriods().map((p) => liveBreadth(symbol, p, cache)))
    .sort((a, b) => a.period.localeCompare(b.period));
  return { symbol, tracked: true, season: currentSeason(), sizeBuckets: B.SIZE_BUCKETS.map(({ key, label }) => ({ key, label })), rows };
}

// Every holding and watchlist ticker for the quarter being filed now (or the latest seed
// quarter before any live filings arrive), with last quarter's reading next to it.
function breadthTable() {
  const season = currentSeason();
  const { owned, watched, symbols } = universe();
  const cache = new Map();
  const live = livePeriods();
  const rows = symbols.map((symbol) => {
    const base = { symbol, owned: owned.includes(symbol), watching: watched.includes(symbol) };
    if (!CUSIPS[symbol]) return { ...base, tracked: false };
    const now = live.includes(season.period) ? liveBreadth(symbol, season.period, cache) : null;
    const last = seed().history.find((r) => r.symbol === symbol && r.period === season.prior) || (live.includes(season.prior) ? liveBreadth(symbol, season.prior, cache) : null);
    return { ...base, tracked: true, now, last };
  });
  return { season, rows };
}

function seasonStatus() {
  const season = currentSeason();
  const filers = db.prepare("SELECT cik, name, totalValue, filedAt, accession FROM thirteenf_filers WHERE period = ? AND accession != 'seed'").all(season.period);
  const byStatus = Object.fromEntries(db.prepare("SELECT status, COUNT(*) AS n FROM thirteenf_filings WHERE status IN ('pending', 'error') GROUP BY status").all().map((r) => [r.status, r.n]));

  // Cumulative filers by day after quarter end: this quarter (live) vs last quarter.
  const cumulative = (perDay) => {
    const out = []; let total = 0;
    for (let d = 0; d <= 60; d++) { total += perDay[d] || 0; out.push(total); }
    return out;
  };
  const nowPerDay = {};
  for (const f of filers) { const d = B.daysAfter(season.period, f.filedAt); nowPerDay[d] = (nowPerDay[d] || 0) + 1; }
  let priorPerDay = seed().season[season.prior];
  if (!priorPerDay) {
    priorPerDay = {};
    for (const f of db.prepare("SELECT filedAt FROM thirteenf_filers WHERE period = ? AND accession != 'seed'").all(season.prior)) { const d = B.daysAfter(season.prior, f.filedAt); priorPerDay[d] = (priorPerDay[d] || 0) + 1; }
  }
  const today = B.daysAfter(season.period, nyDay());
  const curve = { days: [...Array(61).keys()], current: cumulative(nowPerDay).map((v, d) => (d <= today ? v : null)), prior: cumulative(priorPerDay) };

  const tracked = db.prepare("SELECT cik, name FROM thirteenf_managers ORDER BY name").all();
  const filed = new Map(filers.map((f) => [f.cik, f]));
  const heldCount = db.prepare("SELECT cik, COUNT(*) AS n FROM thirteenf_positions WHERE period = ? GROUP BY cik").all(season.period);
  const held = new Map(heldCount.map((r) => [r.cik, r.n]));
  const trackedSet = new Set(tracked.map((m) => m.cik));
  const biggest = [...filers].sort((a, b) => b.totalValue - a.totalValue).slice(0, 15)
    .map((f) => ({ ...f, holdsOurs: held.get(f.cik) || 0, following: trackedSet.has(f.cik) }));

  return {
    season,
    filed: filers.length,
    priorTotal: curve.prior[curve.prior.length - 1],
    queue: { pending: byStatus.pending || 0, errors: byStatus.error || 0 },
    ingest: { ...status, indexThrough: getSetting("13f_index_through") },
    curve,
    biggest,
    following: tracked.map((m) => ({ ...m, filing: filed.get(m.cik) || null })),
    history: { periods: seed().periods, builtAt: seed().builtAt || null },
  };
}

module.exports = { run, ensureSeedLoaded, breadthHistory, breadthTable, seasonStatus, currentSeason, CUSIPS };
