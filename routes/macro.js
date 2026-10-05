const express = require("express");
const fred = require("../lib/sources/fred");

const router = express.Router();

router.get("/macro", async (req, res) => {
  const series = await fred.getAllSeries();
  res.json(series);
});

module.exports = router;
