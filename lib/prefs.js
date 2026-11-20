// Per-member preferences. Each key has a validator that returns the cleaned value or throws;
// unknown keys are rejected so the table only ever holds things the app understands.
const db = require("../db");
const benchmarks = require("./benchmarks");
const { getSettings } = require("./settings");
const { memberFromRequest } = require("../middleware/auth");

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const oneOf = (allowed) => (v) => { if (!allowed.includes(v)) throw bad(`Must be one of: ${allowed.join(", ")}.`); return v; };
const TICKER = /^[A-Z0-9.\-^=]{1,12}$/;

const SCHEMA = {
  // The fund/index to compare against on Performance, Allocation, Risk, Backtester, Paper.
  benchmark: (v) => (v === null || v === "" ? null : benchmarks.normalize(String(v))),
  startPage: oneOf(["today", "holdings", "cockpit"]),
  txView: oneOf(["table", "timeline"]),
  theme: oneOf(["system", "light", "dark"]),
  holdingsPeriod: oneOf(["1d", "5d", "1m", "3m", "ytd", "1y", "all"]),
  // Personal follow list (separate from the fund's watchlist).
  myTickers: (v) => {
    if (!Array.isArray(v)) throw bad("myTickers must be a list.");
    const out = [...new Set(v.map((s) => String(s).toUpperCase().trim()).filter((s) => TICKER.test(s)))];
    if (out.length > 50) throw bad("Follow up to 50 tickers.");
    return out;
  },
  // Today page sections someone has hidden.
  todayHidden: (v) => {
    const allowed = ["read", "markets", "foryou", "recap", "stories", "holdingsNews", "portfolio", "deck", "sectors", "movers"];
    if (!Array.isArray(v)) throw bad("todayHidden must be a list.");
    return [...new Set(v.filter((k) => allowed.includes(k)))];
  },
  // Holdings table columns the member chose to show (true) or hide (false), by column key.
  holdingsColumns: (v) => {
    const KEYS = ["signals", "weight", "shares", "lastPrice", "dayChangePct", "avgCost", "marketValue", "gain", "gainPct", "divIncome"];
    if (!v || typeof v !== "object" || Array.isArray(v)) throw bad("holdingsColumns must be an object.");
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (!KEYS.includes(k)) throw bad(`Unknown column: ${k}.`);
      if (typeof x !== "boolean") throw bad(`Column ${k} must be true or false.`);
      out[k] = x;
    }
    return out;
  },
  // Research chart: last timeframe, chart type, scale and indicators.
  chartSettings: (v) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) throw bad("chartSettings must be an object.");
    const FRAMES = ["1D", "5D", "1M", "3M", "6M", "YTD", "1Y", "2Y", "5Y", "MAX"];
    const TYPES = ["line", "area", "candles", "bars", "heikin"];
    const IDS = ["sma", "ema", "bb", "vwap", "vol", "rsi", "macd", "atr"];
    const indicators = (Array.isArray(v.indicators) ? v.indicators : []).slice(0, 8)
      .filter((i) => i && IDS.includes(i.id))
      .map((i) => ({ id: i.id, params: Object.fromEntries(Object.entries(i.params || {}).filter(([k, x]) => /^[a-z]{1,8}$/.test(k) && Number.isFinite(Number(x))).slice(0, 4).map(([k, x]) => [k, Math.max(0.5, Math.min(400, Number(x)))])) }));
    return {
      frame: FRAMES.includes(v.frame) ? v.frame : "1Y",
      type: TYPES.includes(v.type) ? v.type : "area",
      log: !!v.log,
      marks: v.marks !== false,
      indicators,
      // Event layers on the chart (public/viz/markers.js): { trades: true, earnings: false, … }.
      layers: Object.fromEntries(Object.entries(v.layers && typeof v.layers === "object" && !Array.isArray(v.layers) ? v.layers : {})
        .filter(([k]) => ["trades", "earnings", "filings", "insiders", "dividends", "pitches", "agents", "levels", "tripwires", "scenarios"].includes(k))
        .map(([k, x]) => [k, x !== false])),
    };
  },
  // Research chart drawings, per ticker: [{ t, p: [{ time, price }], text }].
  chartDrawings: (v) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) throw bad("chartDrawings must be an object.");
    const KINDS = ["hline", "trend", "ray", "rect", "text", "measure"];
    const out = {};
    for (const [sym, list] of Object.entries(v).slice(0, 60)) {
      const s = String(sym).toUpperCase();
      if (!TICKER.test(s) || !Array.isArray(list)) continue;
      const clean = list.slice(0, 40).filter((d) => d && KINDS.includes(d.t)).map((d) => ({
        t: d.t,
        p: (Array.isArray(d.p) ? d.p : []).slice(0, 2).map((pt) => ({ time: Number(pt.time), price: Number(pt.price) })).filter((pt) => Number.isFinite(pt.time) && Number.isFinite(pt.price)),
        ...(d.t === "text" ? { text: String(d.text || "").slice(0, 120) } : {}),
      })).filter((d) => d.p.length >= (["hline", "text"].includes(d.t) ? 1 : 2));
      if (clean.length) out[s] = clean;
    }
    return out;
  },
  // Fund cockpit: which widgets, in what order and size, plus each widget's own options and the period.
  dashboardLayout: (v) => {
    if (!v || typeof v !== "object" || Array.isArray(v) || !Array.isArray(v.widgets)) throw bad("dashboardLayout must be { widgets: [...] }.");
    const seen = new Set();
    const widgets = v.widgets.slice(0, 40).filter((w) => w && /^[a-z][a-z0-9-]{1,40}$/.test(w.key) && !seen.has(w.key) && seen.add(w.key)).map((w) => {
      const out = { key: w.key };
      if (["s", "m", "l", "full"].includes(w.size)) out.size = w.size;
      if (w.opts && typeof w.opts === "object" && !Array.isArray(w.opts)) {
        const opts = Object.fromEntries(Object.entries(w.opts).slice(0, 8)
          .filter(([k, x]) => /^[a-zA-Z]{1,20}$/.test(k) && (typeof x === "boolean" || (typeof x === "number" && Number.isFinite(x)) || (typeof x === "string" && x.length <= 40))));
        if (Object.keys(opts).length) out.opts = opts;
      }
      return out;
    });
    return { v: 1, period: ["1d", "5d", "mtd", "1m", "3m", "ytd", "1y"].includes(v.period) ? v.period : "1d", widgets };
  },
  // "Start here" lessons the member has marked read, and whether they hid the Today reminder.
  learnRead: (v) => {
    if (!Array.isArray(v)) throw bad("learnRead must be a list.");
    return [...new Set(v.map(String).filter((k) => /^[a-z][a-z0-9-]{1,30}$/.test(k)))].slice(0, 40);
  },
  learnHidden: (v) => { if (typeof v !== "boolean") throw bad("learnHidden must be true or false."); return v; },
  // Inbox notification types someone has turned off (keys of TYPES in lib/notify.js).
  notifyOff: (v) => {
    // Every type notify.js knows (the old fixed list left out 13F and agent alerts, so muting
    // them was silently dropped).
    const allowed = Object.keys(require("./notify").TYPES);
    if (!Array.isArray(v)) throw bad("notifyOff must be a list.");
    return [...new Set(v.filter((k) => allowed.includes(k)))];
  },
};

function getPrefs(memberId) {
  const out = {};
  for (const r of db.prepare("SELECT key, value FROM member_prefs WHERE memberId = ?").all(memberId)) {
    try { out[r.key] = JSON.parse(r.value); } catch { /* ignore a corrupt row */ }
  }
  return out;
}

function setPrefs(memberId, patch = {}) {
  const clean = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!SCHEMA[k]) throw bad(`Unknown preference "${k}".`);
    clean[k] = SCHEMA[k](v);
  }
  const up = db.prepare(`INSERT INTO member_prefs (memberId, key, value, updatedAt) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(memberId, key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`);
  const del = db.prepare("DELETE FROM member_prefs WHERE memberId = ? AND key = ?");
  for (const [k, v] of Object.entries(clean)) {
    if (v === null) del.run(memberId, k);
    else up.run(memberId, k, JSON.stringify(v));
  }
  return getPrefs(memberId);
}

// The benchmark this request should compare against: an explicit ?benchmark=, else the signed-in
// member's own choice, else the fund's official benchmark. Throws a 400 on a malformed override.
function benchmarkFor(req) {
  if (req.query?.benchmark) return benchmarks.normalize(String(req.query.benchmark));
  const m = memberFromRequest(req);
  if (m) {
    const row = db.prepare("SELECT value FROM member_prefs WHERE memberId = ? AND key = 'benchmark'").get(m.id);
    if (row) { try { return benchmarks.normalize(JSON.parse(row.value)); } catch { /* fall through */ } }
  }
  return getSettings().benchmark;
}

module.exports = { getPrefs, setPrefs, benchmarkFor, SCHEMA };
