// SQLite via libsql (a better-sqlite3-compatible driver), stored in a file: DB_PATH (on Render,
// the attached disk at /data/pif.db) or data/pif.db locally.
const Database = require("libsql");
const path = require("path");

const dbPath = process.env.DB_PATH || path.join(__dirname, "data", "pif.db");
require("fs").mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
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
// Named parameters (@name) are rewritten to numbered positional ones (?1, ?2 …) and the
// object argument converted to an array; repeated names reuse the same number. (Added for a
// past Turso setup; kept because every query in the app now goes through it.)
function toPositional(sql) {
  const names = [];
  const text = sql.replace(/@([A-Za-z_][A-Za-z0-9_]*)/g, (_, name) => {
    let i = names.indexOf(name);
    if (i < 0) { names.push(name); i = names.length - 1; }
    return `?${i + 1}`;
  });
  return { text, names };
}
const isPlainObject = (v) => v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Buffer);

const rawPrepare = db.prepare.bind(db);
db.prepare = (sql) => {
  const { text, names } = toPositional(sql);
  const stmt = rawPrepare(text);
  const bind = (args) => {
    if (!names.length || !(args.length === 1 && isPlainObject(args[0]))) return args;
    const obj = args[0];
    return names.map((n) => {
      if (!(n in obj)) throw new Error(`Missing named parameter "${n}"`);
      return obj[n] === undefined ? null : obj[n];
    });
  };
  const run = stmt.run.bind(stmt), get = stmt.get.bind(stmt), all = stmt.all.bind(stmt);
  stmt.run = (...args) => run(...bind(args));
  stmt.get = (...args) => clean(get(...bind(args)));
  stmt.all = (...args) => all(...bind(args)).map(clean);
  return stmt;
};

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
// Accounts (2026-10-09): each member signs in with email + password set through a one-time
// invite link. `role` is now a free-text title ("Analyst", "Risk officer"); what someone may
// do comes from isAdmin / canTrade. PINs are retired (pinHash kept for old rows, unused).
addColumn("members", "email", "TEXT");
addColumn("members", "passwordHash", "TEXT");
addColumn("members", "isAdmin", "INTEGER NOT NULL DEFAULT 0");
addColumn("members", "canTrade", "INTEGER NOT NULL DEFAULT 0");
addColumn("members", "lastSeenAt", "TEXT");
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS members_email ON members (email) WHERE email IS NOT NULL`);
// Sessions are now cookies; the table stores a SHA-256 of the token, never the token itself.
addColumn("member_sessions", "expiresAt", "TEXT");
addColumn("member_sessions", "lastUsedAt", "TEXT");
db.exec(`
  CREATE TABLE IF NOT EXISTS invites (
    tokenHash TEXT PRIMARY KEY,
    memberId INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    createdBy INTEGER,
    expiresAt TEXT NOT NULL,
    usedAt TEXT,
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  );
  -- Who changed what: every real-fund change and member administration.
  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memberId INTEGER,
    memberName TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '{}',
    at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS activity_log_at ON activity_log (at);
`);
addColumn("research_notes", "targetPrice", "REAL");
addColumn("research_notes", "priceAtThesis", "REAL");
addColumn("positions", "sector", "TEXT NOT NULL DEFAULT ''");
// Calibration & decision journal (feature 6): a confidence level and time horizon on each
// pitch, so outcomes can be graded later.
addColumn("pitches", "confidencePct", "REAL");
addColumn("pitches", "horizonMonths", "INTEGER");
// Pre-mortem prompt (feature 16): required before a pitch can go to a vote.
addColumn("pitches", "preMortem", "TEXT NOT NULL DEFAULT ''");
addColumn("pitches", "bearChecklist", "TEXT NOT NULL DEFAULT '[]'");

// 13F "best ideas" tracker (feature 11): managers the fund follows, by CIK.
db.exec(`
  CREATE TABLE IF NOT EXISTS thirteenf_managers (
    cik TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    addedAt TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Dividends the fund is owed or has received, one row per holding per ex-dividend date,
// logged automatically from the date holdings were last reconciled with Schwab (lib/dividends.js).
// status: expected (ex-date passed, not yet confirmed) | received (recorded as a dividend
// transaction, which credits cash) | skipped (e.g. the shares were sold before the ex-date).
db.exec(`
  CREATE TABLE IF NOT EXISTS dividends (
    symbol TEXT NOT NULL,
    exDate TEXT NOT NULL,
    payDate TEXT,
    perShare REAL NOT NULL,
    shares REAL NOT NULL,
    amount REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'expected' CHECK (status IN ('expected','received','skipped')),
    transactionId INTEGER,
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (symbol, exDate)
  );
`);

// Personal preferences (benchmark to compare against, theme, start page, followed tickers…),
// one JSON value per key per member; lib/prefs.js validates them.
db.exec(`
  CREATE TABLE IF NOT EXISTS member_prefs (
    memberId INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (memberId, key)
  );
`);

// Personal notes: on a company (symbol) or any page (pageRef/pageTitle), optionally quoting text
// the member highlighted. Private by default; "club" notes are visible to every signed-in member.
db.exec(`
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memberId INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    symbol TEXT,
    pageRef TEXT NOT NULL DEFAULT '',
    pageTitle TEXT NOT NULL DEFAULT '',
    quote TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','club')),
    pinned INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS notes_member ON notes (memberId, updatedAt);
  CREATE INDEX IF NOT EXISTS notes_symbol ON notes (symbol);
`);

// Club chat (members only). Messages can carry an attachment (a quoted highlight, a page link
// or a snapshot image) and @mentions; images live in chat_images (JPEG/PNG/WebP, size-capped).
db.exec(`
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memberId INTEGER NOT NULL REFERENCES members(id),
    body TEXT NOT NULL DEFAULT '',
    attachment TEXT,
    imageId INTEGER,
    replyTo INTEGER,
    mentions TEXT NOT NULL DEFAULT '[]',
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    editedAt TEXT,
    deletedAt TEXT
  );
  CREATE TABLE IF NOT EXISTS chat_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memberId INTEGER NOT NULL REFERENCES members(id),
    mime TEXT NOT NULL,
    data BLOB NOT NULL,
    bytes INTEGER NOT NULL,
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS chat_reads (
    memberId INTEGER PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
    lastReadId INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS chat_reactions (
    messageId INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    memberId INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    emoji TEXT NOT NULL,
    PRIMARY KEY (messageId, memberId, emoji)
  );
`);

// Today page news editions (lib/today.js): premarket / midday / postmarket snapshots of the
// headlines, holdings news and AI recap, keyed by New York date. Pruned after ~10 days.
db.exec(`
  CREATE TABLE IF NOT EXISTS news_editions (
    date TEXT NOT NULL,
    slot TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (date, slot)
  );
`);

// Per-symbol alert signals computed in the background (lib/signals.js), so /api/alerts reads
// stored results instead of fanning out to hundreds of external calls per page load.
db.exec(`
  CREATE TABLE IF NOT EXISTS signals (
    symbol TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    computed_at TEXT NOT NULL
  );
`);

// Paper-trading sandbox (feature 21): one season per semester; each member's portfolio is the
// replay of their trades in that season (lib/paperTrading.js). Ended seasons are kept.
db.exec(`
  CREATE TABLE IF NOT EXISTS paper_seasons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    startingCash REAL NOT NULL DEFAULT 100000,
    startedAt TEXT NOT NULL DEFAULT (datetime('now')),
    endedAt TEXT
  );

  CREATE TABLE IF NOT EXISTS paper_trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seasonId INTEGER NOT NULL REFERENCES paper_seasons(id),
    memberId INTEGER NOT NULL REFERENCES members(id),
    type TEXT NOT NULL CHECK (type IN ('buy','sell')),
    symbol TEXT NOT NULL,
    shares REAL NOT NULL,
    price REAL NOT NULL,
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS paper_trades_member ON paper_trades (seasonId, memberId);
`);

// Paper trading rules (2026-10-09, from docs/paper-trading-research.md): a small fee per trade,
// diversification rules, a reason with every order, and orders placed while the market is shut
// wait for the next open ("pending" until filled or cancelled).
addColumn("paper_seasons", "feeBps", "REAL NOT NULL DEFAULT 10");
addColumn("paper_seasons", "minHoldings", "INTEGER NOT NULL DEFAULT 5");
addColumn("paper_seasons", "maxPositionPct", "REAL NOT NULL DEFAULT 25");
addColumn("paper_seasons", "minPrice", "REAL NOT NULL DEFAULT 5");
addColumn("paper_seasons", "minMarketCap", "REAL NOT NULL DEFAULT 300000000");
addColumn("paper_trades", "status", "TEXT NOT NULL DEFAULT 'filled'");
addColumn("paper_trades", "fee", "REAL NOT NULL DEFAULT 0");
addColumn("paper_trades", "reason", "TEXT NOT NULL DEFAULT ''");
addColumn("paper_trades", "targetPrice", "REAL");
addColumn("paper_trades", "stopPrice", "REAL");
addColumn("paper_trades", "horizon", "TEXT NOT NULL DEFAULT ''");
addColumn("paper_trades", "filledAt", "TEXT");
addColumn("paper_trades", "cancelReason", "TEXT NOT NULL DEFAULT ''");

// Watchlists beyond the fund's own (2026-10-09): any member can make a list, private to them or
// shared with the club (any member can add to a shared list; only its creator or an admin can
// rename or delete it). The fund's watchlist stays in the "watchlist" table, which the analysis
// pages use as their universe.
db.exec(`
  CREATE TABLE IF NOT EXISTS watchlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ownerId INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','club')),
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS watchlist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listId INTEGER NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    addedBy INTEGER,
    addedAt TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (listId, symbol)
  );
`);

// Club sign-up link (2026-10-10): an admin shares one link (e.g. in the group chat) and anyone
// with it creates their own account as an Analyst. One link is live at a time; making a new
// one or turning it off kills the old one. Stored as-is so the admin can copy it again.
db.exec(`
  CREATE TABLE IF NOT EXISTS join_links (
    token TEXT PRIMARY KEY,
    createdBy INTEGER,
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    expiresAt TEXT NOT NULL,
    revokedAt TEXT,
    uses INTEGER NOT NULL DEFAULT 0
  );
`);

// Personal notifications (the inbox) and personal price alerts.
addColumn("pitches", "authorId", "INTEGER");
db.exec(`
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memberId INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    link TEXT NOT NULL DEFAULT '',
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    readAt TEXT
  );
  CREATE INDEX IF NOT EXISTS notifications_member ON notifications (memberId, id);
  -- Alerts only their owner sees: price above/below (one-shot) or a daily move of N% (once a day).
  CREATE TABLE IF NOT EXISTS member_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memberId INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('above','below','move')),
    value REAL NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    lastTriggeredAt TEXT,
    lastTriggeredDay TEXT,
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS member_alerts_member ON member_alerts (memberId);
`);

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
