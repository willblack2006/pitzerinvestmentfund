// Background work for the team feed (WS7), registered once at boot (routes/feed.js):
//   - follow notifications every minute, the followed-agents evening digest (checked every 15 min)
//   - run_finished on the live stream when any run ends, so "Running now" chips clear at once
const { platform } = require("./store");
const follows = require("./follows");

let registered = false;
function register() {
  if (registered) return false;
  registered = true;
  const jobs = platform("jobs");
  if (jobs && typeof jobs.register === "function") {
    jobs.register("feed_follow_notify", { everyMs: 60e3, fn: async () => follows.notifyNew() });
    jobs.register("feed_follow_digest", { everyMs: 15 * 60e3, fn: async () => follows.maybeSendDigest() });
  }
  const bus = platform("bus");
  if (bus && typeof bus.on === "function") {
    bus.on("agent_output", (p) => {
      const data = { runId: p.runId, agentId: p.agentId ?? null, workflow: p.workflow, symbol: p.symbol ?? null };
      require("../events").publish("run_finished", data, { membersOnly: true, ...(p.memberId ? { to: [p.memberId] } : {}) });
    });
  }
  return true;
}

module.exports = { register };
