// Automatic database backups. The live database is the fund's only copy of its holdings, trades,
// notes and members, so a snapshot is taken about once a day with SQLite's VACUUM INTO (a
// consistent copy, safe while the app is running) and the newest few are kept next to the
// database (on Render that's the attached disk, /data/backups). Hand-made backups in the same
// folder are never touched: only files named auto-pif-*.db are pruned.
const fs = require("fs");
const path = require("path");

const PREFIX = "auto-pif-";
const DAY_MS = 24 * 60 * 60 * 1000;

const keepCount = () => Math.max(1, parseInt(process.env.BACKUP_KEEP, 10) || 3);

function backupDir(dbPath) {
  return process.env.BACKUP_DIR || path.join(path.dirname(dbPath), "backups");
}

function listBackups(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.startsWith(PREFIX) && f.endsWith(".db")).sort(); // names sort by time
}

// Takes a snapshot unless one newer than `minAgeMs` exists. Returns { ran, file?, pruned? }.
function backupIfDue(db, dbPath, { minAgeMs = DAY_MS - 60 * 60 * 1000, now = new Date() } = {}) {
  const dir = backupDir(dbPath);
  fs.mkdirSync(dir, { recursive: true });
  const existing = listBackups(dir);
  const newest = existing.at(-1);
  if (newest && now.getTime() - fs.statSync(path.join(dir, newest)).mtimeMs < minAgeMs) return { ran: false };
  const name = `${PREFIX}${now.toISOString().replace(/[:.]/g, "-")}.db`;
  const tmp = path.join(dir, `${name}.partial`);
  fs.rmSync(tmp, { force: true });
  db.prepare("VACUUM INTO ?").run(tmp);
  fs.renameSync(tmp, path.join(dir, name)); // never leave a half-written file that looks real
  const old = listBackups(dir).slice(0, -keepCount());
  for (const f of old) fs.rmSync(path.join(dir, f), { force: true });
  return { ran: true, file: name, pruned: old.length };
}

module.exports = { backupIfDue, listBackups, backupDir };
