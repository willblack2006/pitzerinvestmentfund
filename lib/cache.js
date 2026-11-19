const db = require("../db");

db.exec("CREATE INDEX IF NOT EXISTS api_cache_expires ON api_cache (expires_at)");

const getStmt = db.prepare("SELECT payload, expires_at FROM api_cache WHERE cache_key = ?");
const setStmt = db.prepare(`
  INSERT INTO api_cache (cache_key, payload, fetched_at, expires_at, source)
  VALUES (@key, @payload, datetime('now'), @expiresAt, @source)
  ON CONFLICT(cache_key) DO UPDATE SET
    payload = excluded.payload, fetched_at = excluded.fetched_at,
    expires_at = excluded.expires_at, source = excluded.source
`);

// An expired row is kept this long past its expiry so it can stand in when the source is down
// (rate limited, timing out). Past this the data is too old to show as if it were current.
const STALE_GRACE_MS = 3 * 24 * 3600 * 1000;

function read(key, { allowStale = false } = {}) {
  const row = getStmt.get(key);
  if (!row) return null;
  const expiresAt = new Date(row.expires_at + "Z").getTime();
  const now = Date.now();
  if (expiresAt <= now && !(allowStale && now - expiresAt <= STALE_GRACE_MS)) return null;
  try {
    return JSON.parse(row.payload);
  } catch {
    return null;
  }
}

function getCached(key) {
  return read(key);
}

function setCached(key, payload, ttlSeconds, source) {
  // undefined has no JSON form; storing it would write the string "undefined" and break every read.
  if (payload === undefined) return;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString().replace("Z", "");
  setStmt.run({ key, payload: JSON.stringify(payload), expiresAt, source });
}

const inflight = new Map();

/**
 * Fetches `key` from cache, or calls `fetcher()` and caches the result for `ttlSeconds`.
 * Concurrent callers for the same key share one fetch (a page and an agent asking for the same
 * thing no longer double the upstream calls). If the fetch fails and an expired copy from the
 * last few days exists, that copy is returned instead of an error; with no copy, the error
 * propagates (so Promise.allSettled call sites can degrade per-source).
 */
async function cached(key, ttlSeconds, source, fetcher) {
  const hit = getCached(key);
  if (hit !== null) return hit;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const value = await fetcher();
      setCached(key, value, ttlSeconds, source);
      return value;
    } catch (err) {
      const stale = read(key, { allowStale: true });
      if (stale !== null) {
        console.warn(`[cache] ${key}: ${err.message}; serving the expired copy`);
        return stale;
      }
      throw err;
    }
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// Deletes rows that are past the stale grace window. Returns the number removed.
function purgeExpired() {
  const cutoff = new Date(Date.now() - STALE_GRACE_MS).toISOString().replace("Z", "");
  return db.prepare("DELETE FROM api_cache WHERE expires_at < ?").run(cutoff).changes;
}

module.exports = { getCached, setCached, cached, purgeExpired, STALE_GRACE_MS };
