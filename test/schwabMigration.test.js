const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pif-schwab-")), "test.db");
process.env.DB_PATH = dbPath;
const db = require("../db");
const { apply, SNAPSHOT, CASH } = require("../lib/migrations/schwab20261109");

test("Schwab 11/09 sync matches the statement totals and runs once", () => {
  // A fresh database is seeded with the old positions on first open; CELH carries the old cost.
  db.prepare("UPDATE positions SET shares = 15, avgCost = 27.35, totalCost = 410.26 WHERE symbol = 'CELH'").run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('cash', '41236.2') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();

  const first = apply(db, dbPath);
  assert.equal(first.ran, true);
  assert.ok(fs.existsSync(first.backup));
  const rows = db.prepare("SELECT * FROM positions").all();
  assert.equal(rows.length, SNAPSHOT.length);
  // Schwab cost basis $82,687.72 minus LumiraDx's $192.49 (left out on purpose).
  assert.equal(rows.reduce((s, r) => s + r.totalCost, 0).toFixed(2), "82495.23");
  assert.equal(db.prepare("SELECT totalCost FROM positions WHERE symbol = 'CELH'").get().totalCost, 636.71);
  assert.equal(Number(db.prepare("SELECT value FROM settings WHERE key = 'cash'").get().value), CASH);

  // A later edit in the app must survive a second run.
  db.prepare("UPDATE positions SET shares = 99 WHERE symbol = 'NVDA'").run();
  assert.equal(apply(db, dbPath).ran, false);
  assert.equal(db.prepare("SELECT shares FROM positions WHERE symbol = 'NVDA'").get().shares, 99);
});
