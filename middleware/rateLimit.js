// Small in-memory limiter for credential checks. A 4-digit member PIN has only 10,000
// possibilities, so failed attempts are capped per IP (and per member for PIN logins).
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const failures = new Map(); // key -> { count, resetAt }

function keyFor(req, scope) {
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  return `${scope}|${ip}`;
}

function blocked(key) {
  const f = failures.get(key);
  if (!f) return false;
  if (Date.now() > f.resetAt) { failures.delete(key); return false; }
  return f.count >= MAX_FAILURES;
}

function recordFailure(key) {
  const f = failures.get(key);
  if (!f || Date.now() > f.resetAt) failures.set(key, { count: 1, resetAt: Date.now() + WINDOW_MS });
  else f.count++;
}

// Wrap a login handler: rejects with 429 while blocked; the handler reports failures via
// req.loginFailed() and successes via req.loginSucceeded().
function loginLimiter(scope, extraKey = () => "") {
  return (req, res, next) => {
    const keys = [keyFor(req, scope)];
    const extra = extraKey(req);
    if (extra) keys.push(`${scope}|target|${extra}`);
    if (keys.some(blocked)) {
      return res.status(429).json({ error: "Too many failed attempts. Try again in 15 minutes." });
    }
    req.loginFailed = () => keys.forEach(recordFailure);
    req.loginSucceeded = () => keys.forEach((k) => failures.delete(k));
    next();
  };
}

module.exports = { loginLimiter, _failures: failures };
