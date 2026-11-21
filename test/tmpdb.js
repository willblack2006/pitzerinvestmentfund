// Point this test process at a throwaway SQLite file before anything requires db.js.
// Without it, test files that load lib/ modules (which pull in db.js through lib/cache.js) all
// open data/pif.db at once: on a fresh checkout they race to create the schema and fail with
// "database is locked", and on a real checkout they write cache rows into the fund's database.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

if (!process.env.DB_PATH) process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pif-unit-")), "unit.db");
