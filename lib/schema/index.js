// Schema loader (agent platform, 2026-11-19). db.js creates the core tables, then calls this
// once. Every other file in lib/schema/ is a module exporting `apply(db, { addColumn })` and is
// run in file-name order, so each workstream adds its own tables in its own file instead of
// editing db.js. Each file must be idempotent (CREATE TABLE IF NOT EXISTS, addColumn).
// Files must not require("../../db"): db.js is still loading when they run.
const fs = require("fs");
const path = require("path");

function loadAll(db, helpers) {
  const files = fs.readdirSync(__dirname).filter((f) => f.endsWith(".js") && f !== "index.js").sort();
  // platform.js first: other schema files may reference its tables.
  files.sort((a, b) => (a === "platform.js" ? -1 : b === "platform.js" ? 1 : 0));
  for (const f of files) {
    const apply = require(path.join(__dirname, f));
    if (typeof apply !== "function") throw new Error(`lib/schema/${f} must export a function (db, { addColumn })`);
    apply(db, helpers);
  }
  return files;
}

module.exports = loadAll;
