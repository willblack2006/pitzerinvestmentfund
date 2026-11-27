// Market-data warehouse (public-data rebuild plan, step 1.1): a second SQLite file attached to the
// main database as schema "wh". Heavy, rebuildable data (collected series, later XBRL facts,
// Finviz history, events) lives here so it can be deleted and rebuilt from its sources without
// touching member data in pif.db. Backups (lib/backup.js) cover pif.db only, on purpose.
//
//   WAREHOUSE_PATH  defaults to warehouse.db next to pif.db (on Render: /data/warehouse.db)
//
// Queries go through the main connection: `db.prepare("SELECT ... FROM wh.alt_series ...")`,
// and can join main tables (positions, watchlist) directly.
const path = require("path");
const db = require("../db");

const whPath = process.env.WAREHOUSE_PATH || path.join(path.dirname(db.path), "warehouse.db");

let attached = false;
function attach() {
  if (attached) return db;
  const already = db.prepare("PRAGMA database_list").all().some((r) => r.name === "wh");
  if (!already) db.prepare("ATTACH DATABASE ? AS wh").run(whPath);
  db.exec("PRAGMA wh.journal_mode = WAL");
  db.exec(`
    -- One row per collector run, so a missing day reads as missing rather than as zero.
    CREATE TABLE IF NOT EXISTS wh.collector_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      collector TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','ok','empty','error')),
      rows INTEGER NOT NULL DEFAULT 0,
      as_of TEXT,            -- the data date the run covered (e.g. the trading day of a file)
      message TEXT,
      trigger TEXT NOT NULL DEFAULT 'schedule'
    );
    CREATE INDEX IF NOT EXISTS wh.collector_runs_by_name ON collector_runs(collector, started_at);

    -- Numeric time series keyed by (source, entity, metric, date): short volume, ETF weights,
    -- estimate snapshots and the like. entity is usually a ticker.
    CREATE TABLE IF NOT EXISTS wh.alt_series (
      source TEXT NOT NULL,
      entity TEXT NOT NULL,
      metric TEXT NOT NULL,
      date TEXT NOT NULL,
      value REAL,
      PRIMARY KEY (source, entity, metric, date)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS wh.alt_series_by_date ON alt_series(source, metric, date);
  `);
  attached = true;
  return db;
}

// Size of the warehouse file in bytes (0 if it doesn't exist yet).
function sizeBytes() {
  try { return require("fs").statSync(whPath).size; } catch { return 0; }
}

// Upserts many alt_series rows in one transaction. rows: [{ source, entity, metric, date, value }]
function putSeries(rows) {
  attach();
  const stmt = db.prepare(`INSERT INTO wh.alt_series (source, entity, metric, date, value) VALUES (@source, @entity, @metric, @date, @value)
    ON CONFLICT (source, entity, metric, date) DO UPDATE SET value = excluded.value`);
  db.exec("BEGIN");
  try { for (const r of rows) stmt.run(r); db.exec("COMMIT"); } catch (err) { db.exec("ROLLBACK"); throw err; }
  return rows.length;
}

// One entity's series, oldest first.
function getSeries({ source, entity, metric, since = "0000-00-00", limit = 5000 }) {
  attach();
  return db.prepare(`SELECT date, value FROM wh.alt_series WHERE source = ? AND entity = ? AND metric = ? AND date >= ? ORDER BY date LIMIT ?`)
    .all(source, entity, metric, since, limit);
}

module.exports = { attach, putSeries, getSeries, sizeBytes, path: whPath };
