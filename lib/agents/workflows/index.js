// Registers every built workflow with the dispatcher. Required once at boot (server.js).
const agents = require("..");
const { flash } = require("./flash");

agents.register("filing_flash", flash);
agents.register("earnings_flash", flash);

module.exports = agents;
