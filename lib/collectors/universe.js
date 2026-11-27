// Which symbols the collectors keep history for. By default: the fund's holdings, the fund
// watchlist and every member watchlist (a few hundred names at most), which keeps the warehouse
// small on the 1 GB Render disk. COLLECT_UNIVERSE=all stores every symbol a source has instead,
// for when the disk is raised and the screener needs the whole market.
const db = require("../../db");

function trackedSymbols() {
  const rows = db.prepare(`SELECT symbol FROM positions UNION SELECT symbol FROM watchlist UNION SELECT symbol FROM watchlist_items`).all();
  return new Set(rows.map((r) => String(r.symbol).toUpperCase()).filter(Boolean));
}

const wholeMarket = () => process.env.COLLECT_UNIVERSE === "all";

module.exports = { trackedSymbols, wholeMarket };
