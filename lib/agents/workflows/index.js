// Registers every built workflow with the dispatcher. Required once at boot (server.js).
const agents = require("..");
const { flash } = require("./flash");
const { redTeam } = require("./pitch");

agents.register("filing_flash", flash);
agents.register("earnings_flash", flash);
agents.register("red_team", redTeam);
const s = require("./scheduled");
agents.register("earnings_preview", s.earningsPreview);
agents.register("weekly_memo", s.weeklyMemo);
agents.register("macro_brief", s.macroBrief);
agents.register("ownership_watch", s.ownershipWatch);
agents.register("policy_watch", s.policyWatch);
agents.register("data_qa", s.dataQa);
agents.register("thesis_check", s.thesisCheck);
agents.setScheduler((a) => s.scheduledEvents(a));

module.exports = agents;

// Shared memory and the blackboard (WS5): approval kind for agent-written facts, the nightly
// dossier writer and the open-message sweep.
require("../memory").registerProposalKind();
require("./dossier").registerJobs();
require("../handoffs").registerJobs();
