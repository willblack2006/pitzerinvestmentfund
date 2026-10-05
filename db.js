const Database = require("better-sqlite3");
const path = require("path");

const dbPath = process.env.DB_PATH || path.join(__dirname, "data", "pif.db");
require("fs").mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

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
`);

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
