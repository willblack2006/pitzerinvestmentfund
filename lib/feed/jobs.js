// Background work for the team feed (WS7), registered with WS1's job registry when present:
// follow notifications every minute, the followed-agents evening digest (checked every 15 min).
const { platform } = require("./store");
const follows = require("./follows");

let registered = false;
function register() {
  if (registered) return false;
  const jobs = platform("jobs");
  if (!jobs || typeof jobs.register !== "function") return false;
  jobs.register("feed_follow_notify", { everyMs: 60e3, fn: async () => follows.notifyNew() });
  jobs.register("feed_follow_digest", { everyMs: 15 * 60e3, fn: async () => follows.maybeSendDigest() });
  registered = true;
  return true;
}

module.exports = { register };
