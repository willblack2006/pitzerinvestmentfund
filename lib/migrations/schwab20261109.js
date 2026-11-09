// One-time sync of positions and cash to the Schwab statement dated 2026-11-09 (transcribed from
// a screenshot of the Positions page). Runs once per database: the marker row in `migrations_done`
// stops it from running again, so later edits made in the app are never overwritten.
// LumiraDx (CUSIP G5709L109, $0 value, $192.49 cost) is left out on purpose, as on 2026-10-08.
const fs = require("fs");
const path = require("path");

const NAME = "schwab-2026-11-09";
const CASH = 33239.81;
// [symbol, shares, avgCost, totalCost, lastPrice, marketValue]
const SNAPSHOT = [
  ["APO", 12, 43.02, 516.25, 121.79, 1461.48],
  ["APP", 10, 345.01, 3450.15, 406.565, 4065.65],
  ["CEG", 15, 300.99, 4514.85, 269.775, 4046.62],
  ["CELH", 15, 42.45, 636.71, 32.56, 488.40],
  ["CJPRY", 50, 14.14, 706.95, 13.76, 688.00],
  ["COST", 2, 1019.72, 2039.44, 1051.39, 2102.78],
  ["CRWV", 60, 41.02, 2461.50, 48.875, 2932.50],
  ["DUOL", 13.4553, 190.05, 2557.18, 154.86, 2083.69],
  ["ENVX", 200, 8.83, 1766.40, 2.685, 537.00],
  ["FCEL", 33, 36.15, 1192.95, 10.87, 358.71],
  ["FIGS", 500, 5.30, 2651.60, 21.71, 10855.00],
  ["GOOG", 22.182, 345.27, 7658.89, 289.14, 6413.70],
  ["GOOGL", 80, 11.44, 915.13, 291.03, 23282.40],
  ["HIMS", 100, 14.62, 1461.78, 23.93, 2393.00],
  ["HOOD", 6, 144.37, 866.22, 84.26, 505.56],
  ["HSY", 4.9981, 160.06, 800.00, 170.69, 853.13],
  ["IEFA", 10.4904, 95.33, 1000.00, 97.01, 1017.67],
  ["MAPS", 300, 1.13, 338.49, 0.2735, 82.05],
  ["MCO", 10, 174.59, 1745.95, 505.60, 5056.00],
  ["META", 6, 304.94, 1829.67, 639.225, 3835.35],
  ["MU", 0.7192, 695.22, 500.00, 732.60, 526.89],
  ["NFLX", 10, 92.56, 925.64, 63.6411, 636.41],
  ["NVDA", 17.083, 175.61, 3000.00, 175.45, 2997.26],
  ["ORCL", 7, 177.86, 1244.99, 118.79, 831.53],
  ["P", 15, 67.75, 1016.18, 103.18, 1547.70],
  ["PLTR", 10, 19.41, 194.10, 169.04, 1690.40],
  ["QBTS", 260.5786, 14.39, 3749.18, 11.35, 2957.57],
  ["QTUM", 10, 79.69, 796.90, 129.88, 1298.80],
  ["RDDT", 11, 127.56, 1403.21, 97.205, 1069.26],
  ["SOFI", 400, 7.43, 2972.86, 16.845, 6738.00],
  ["STRL", 34, 147.61, 5018.74, 287.465, 9773.81],
  ["TALO", 10, 19.05, 190.49, 14.955, 149.55],
  ["TJX", 78.3127, 145.94, 11428.96, 137.35, 10756.25],
  ["TTWO", 6.2208, 192.90, 1199.99, 213.515, 1328.23],
  ["VG", 190, 20.58, 3910.20, 11.8738, 2256.02],
  ["WM", 20, 73.80, 1476.09, 235.61, 4712.20],
  ["WMT", 10, 85.76, 857.60, 124.35, 1243.50],
  ["XLP", 11.0547, 90.46, 1000.00, 90.305, 998.29],
  ["XOM", 15.0325, 166.31, 2499.99, 165.30, 2484.87],
];

function apply(db, dbPath) {
  db.exec("CREATE TABLE IF NOT EXISTS migrations_done (name TEXT PRIMARY KEY, at TEXT NOT NULL DEFAULT (datetime('now')))");
  if (db.prepare("SELECT 1 FROM migrations_done WHERE name = ?").get(NAME)) return { ran: false };

  // Copy the database next to itself before touching it (the checkpoint folds the WAL in first).
  let backup = null;
  if (dbPath && fs.existsSync(dbPath)) {
    db.pragma("wal_checkpoint(TRUNCATE)");
    const dir = path.join(path.dirname(dbPath), "backups");
    fs.mkdirSync(dir, { recursive: true });
    backup = path.join(dir, `pif-before-${NAME}.db`);
    fs.copyFileSync(dbPath, backup);
  }

  const upsert = db.prepare(`
    INSERT INTO positions (symbol, shares, lastPrice, avgCost, totalCost, marketValue, divIncome, notes, updatedAt)
    VALUES (@symbol, @shares, @lastPrice, @avgCost, @totalCost, @marketValue, 0, '', datetime('now'))
    ON CONFLICT(symbol) DO UPDATE SET shares = excluded.shares, lastPrice = excluded.lastPrice,
      avgCost = excluded.avgCost, totalCost = excluded.totalCost, marketValue = excluded.marketValue,
      updatedAt = datetime('now')
  `);
  const write = () => {
    for (const [symbol, shares, avgCost, totalCost, lastPrice, marketValue] of SNAPSHOT) {
      upsert.run({ symbol, shares, avgCost, totalCost, lastPrice, marketValue });
    }
    db.prepare("INSERT INTO settings (key, value) VALUES ('cash', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(CASH));
    db.prepare("INSERT INTO migrations_done (name) VALUES (?)").run(NAME);
  };
  db.transaction(write)();
  return { ran: true, backup, positions: SNAPSHOT.length };
}

module.exports = { NAME, CASH, SNAPSHOT, apply };
