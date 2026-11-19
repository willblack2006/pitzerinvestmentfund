// Thesis tracking entry point: registers the thesis workflows with the agent dispatcher and the
// daily rule pass with the platform job runner (lib/platform/jobs.js). Required by
// routes/theses.js, which the server mounts at boot, so nothing else needs editing.
const agents = require("../agents");
const ai = require("./ai");
const evaluate = require("./evaluate");
const store = require("./store");

agents.register("thesis_pillars", (event, ctx) => ai.suggestPillars({ symbol: event.symbol || event.payload?.symbol, pitchId: event.payload?.pitchId }, ctx));
agents.register("thesis_scenario", (event, ctx) => ai.suggestScenario({ symbol: event.symbol || event.payload?.symbol }, ctx));

const RULE_PASS_MS = 3 * 60 * 60 * 1000; // every 3h; each pillar is still checked once a day

async function rulePass() {
  if (!store.available()) return { skipped: "thesis tables missing" };
  const { latestPrices } = require("../prices");
  const symbols = evaluate.trackedSymbols();
  const prices = symbols.length ? await latestPrices(symbols).catch(() => ({})) : {};
  return evaluate.runRules({ symbols, prices });
}

try {
  const jobs = require("../platform/jobs");
  if (typeof jobs.register === "function") jobs.register("thesis_rules", { everyMs: RULE_PASS_MS, fn: rulePass });
} catch { /* platform job runner not on this branch yet */ }

try { require("./metrics").registerShared(); } catch { /* shared registry optional */ }

module.exports = { rulePass, RULE_PASS_MS };
