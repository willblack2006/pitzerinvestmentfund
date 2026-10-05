// SQLite via libsql (a better-sqlite3-compatible driver). Two modes:
//   - Local file (default): DB_PATH or data/pif.db.
//   - Turso (serverless hosting such as Vercel, where the filesystem is temporary): set
//     TURSO_DATABASE_URL + TURSO_AUTH_TOKEN. The app keeps a local replica for fast reads,
//     sends writes to the Turso primary, and re-syncs so every server instance sees them.
const Database = require("libsql");

// libsql picks its native build with a computed require(), which serverless bundlers can't
// see. Naming the Linux builds here makes Vercel's file tracer ship them with the function.
if (process.env.VERCEL) {
  for (const load of [() => require("@libsql/linux-x64-gnu"), () => require("@libsql/linux-arm64-gnu")]) {
    try { load(); } catch { /* only the build for this CPU can load */ }
  }
}
const path = require("path");

const turso = process.env.TURSO_DATABASE_URL
  ? { syncUrl: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN }
  : null;
// Vercel's app directory is read-only; only /tmp is writable (and temporary — hence Turso).
const dbPath = process.env.DB_PATH || (process.env.VERCEL ? "/tmp/pif.db" : path.join(__dirname, "data", "pif.db"));
require("fs").mkdirSync(path.dirname(dbPath), { recursive: true });

const db = turso ? new Database(dbPath, turso) : new Database(dbPath);
if (turso) db.sync();
else db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// libsql adds a `_metadata` field to every row; strip it so rows serialize and spread
// exactly like plain objects (they're returned as API JSON and reused as named params).
const clean = (row) => {
  if (row && typeof row === "object" && "_metadata" in row) {
    const { _metadata, ...rest } = row;
    return rest;
  }
  return row;
};
const rawPrepare = db.prepare.bind(db);
db.prepare = (sql) => {
  const stmt = rawPrepare(sql);
  const get = stmt.get.bind(stmt), all = stmt.all.bind(stmt);
  stmt.get = (...args) => clean(get(...args));
  stmt.all = (...args) => all(...args).map(clean);
  return stmt;
};

// Pull other instances' writes from Turso, at most every couple of seconds.
let lastSync = Date.now();
db.syncIfStale = (maxAgeMs = 2000) => {
  if (!turso || Date.now() - lastSync < maxAgeMs) return;
  try { db.sync(); } catch (err) { console.error("[db] sync failed:", err.message); }
  lastSync = Date.now();
};
db.isTurso = !!turso;

db.exec(`
  CREATE TABLE IF NOT EXISTS positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL UNIQUE,
    shares REAL NOT NULL,
    lastPrice REAL NOT NULL DEFAULT 0,
    avgCost REAL NOT NULL DEFAULT 0,
    totalCost REAL NOT NULL DEFAULT 0,
    marketValue REAL NOT NULL DEFAULT 0,
    divIncome REAL NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS api_cache (
    cache_key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    source TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS research_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL UNIQUE,
    author TEXT NOT NULL DEFAULT '',
    thesis TEXT NOT NULL DEFAULT '',
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS watchlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL UNIQUE,
    note TEXT NOT NULL DEFAULT '',
    sourcedFrom TEXT NOT NULL DEFAULT '',
    addedAt TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ---- Fund operations: ledger, performance history, settings, members, pitches, alerts ----
db.exec(`
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('buy','sell','dividend','deposit','withdrawal','fee')),
    symbol TEXT NOT NULL DEFAULT '',
    shares REAL NOT NULL DEFAULT 0,
    price REAL NOT NULL DEFAULT 0,
    amount REAL NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT '',
    pitchId INTEGER,
    costBasis REAL,        -- sells: average cost of the shares sold (lets a delete reverse it exactly)
    realizedGain REAL,     -- sells: proceeds minus costBasis
    createdBy TEXT NOT NULL DEFAULT '',
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS nav_history (
    date TEXT PRIMARY KEY,
    totalValue REAL NOT NULL,
    cash REAL NOT NULL DEFAULT 0,
    netFlow REAL NOT NULL DEFAULT 0,
    benchmarkClose REAL,
    positions TEXT NOT NULL DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'analyst',
    pinHash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS member_sessions (
    token TEXT PRIMARY KEY,
    memberId INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS pitches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL DEFAULT 'buy' CHECK (direction IN ('buy','add','trim','sell')),
    title TEXT NOT NULL DEFAULT '',
    author TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','voting','approved','rejected','executed','withdrawn')),
    thesis TEXT NOT NULL DEFAULT '',
    catalysts TEXT NOT NULL DEFAULT '',
    risks TEXT NOT NULL DEFAULT '',
    valuation TEXT NOT NULL DEFAULT '',
    bullCase TEXT NOT NULL DEFAULT '',
    baseCase TEXT NOT NULL DEFAULT '',
    bearCase TEXT NOT NULL DEFAULT '',
    bullPrice REAL,
    basePrice REAL,
    bearPrice REAL,
    sizePct REAL,
    priceAtPitch REAL,
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
    votingOpenedAt TEXT,
    decidedAt TEXT
  );

  CREATE TABLE IF NOT EXISTS votes (
    pitchId INTEGER NOT NULL REFERENCES pitches(id) ON DELETE CASCADE,
    memberId INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    vote TEXT NOT NULL CHECK (vote IN ('yes','no','abstain')),
    comment TEXT NOT NULL DEFAULT '',
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (pitchId, memberId)
  );

  CREATE TABLE IF NOT EXISTS price_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('above','below')),
    price REAL NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Additive column migrations for tables that predate these features.
function addColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}
addColumn("research_notes", "targetPrice", "REAL");
addColumn("research_notes", "priceAtThesis", "REAL");
addColumn("positions", "sector", "TEXT NOT NULL DEFAULT ''");

// Defaults (editable on the Settings page). Policy limits start unset ("") so the fund
// enters its own IPS rather than inheriting placeholder numbers.
const DEFAULT_SETTINGS = {
  maxPositionPct: "",
  maxSectorPct: "",
  minPositions: "",
  maxPositions: "",
  minCashPct: "",
  cash: "0",
  benchmark: "SPY",
  voteThresholdPct: "50",
  voteQuorum: "3",
};
const insertSetting = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(k, v);

const count = db.prepare("SELECT COUNT(*) AS c FROM positions").get().c;
if (count === 0) {
  const seed = require("./seed");
  const insert = db.prepare(`
    INSERT INTO positions (symbol, shares, lastPrice, avgCost, totalCost, marketValue, divIncome)
    VALUES (@symbol, @shares, @lastPrice, @avgCost, @totalCost, @marketValue, @divIncome)
  `);
  const insertMany = db.transaction((rows) => rows.forEach((r) => insert.run(r)));
  insertMany(seed);
  console.log(`Seeded ${seed.length} positions.`);
}

module.exports = db;
