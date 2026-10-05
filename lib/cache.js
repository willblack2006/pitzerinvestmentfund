const db = require("../db");

const getStmt = db.prepare("SELECT payload, expires_at FROM api_cache WHERE cache_key = ?");
const setStmt = db.prepare(`
  INSERT INTO api_cache (cache_key, payload, fetched_at, expires_at, source)
  VALUES (@key, @payload, datetime('now'), @expiresAt, @source)
  ON CONFLICT(cache_key) DO UPDATE SET
    payload = excluded.payload, fetched_at = excluded.fetched_at,
    expires_at = excluded.expires_at, source = excluded.source
`);

function getCached(key) {
  const row = getStmt.get(key);
  if (!row) return null;
  if (new Date(row.expires_at + "Z") <= new Date()) return null;
  try {
    return JSON.parse(row.payload);
  } catch {
    return null;
  }
}

function setCached(key, payload, ttlSeconds, source) {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString().replace("Z", "");
  setStmt.run({ key, payload: JSON.stringify(payload), expiresAt, source });
}

/**
 * Fetches `key` from cache, or calls `fetcher()` and caches the result for `ttlSeconds`.
 * `fetcher` errors propagate to the caller (so Promise.allSettled call sites can degrade per-source).
 */
async function cached(key, ttlSeconds, source, fetcher) {
  const hit = getCached(key);
  if (hit !== null) return hit;
  const value = await fetcher();
  setCached(key, value, ttlSeconds, source);
  return value;
}

module.exports = { getCached, setCached, cached };
