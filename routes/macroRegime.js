// Macro regime dashboard (WS10): GET /api/macro/regime (see lib/macroRegime.js).
const express = require("express");
const { macroRegime } = require("../lib/macroRegime");

const router = express.Router();

router.get("/macro/regime", async (req, res) => {
  res.json(await macroRegime());
});

module.exports = router;
module.exports.autoMount = true; // WS1 auto-mount (server.js mounts routes/*.js with this flag)
