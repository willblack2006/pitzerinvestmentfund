// Pitch fit check: what a proposed trade does to the fund's weights and policy limits.
// Pure: the route supplies the current allocation (see portfolio.allocation) and the pitch.
// sizePct is read as "percent of the fund traded": buys/adds take it from cash, trims take it
// out of the position, a sell exits the whole position.

const has = (v) => v !== null && v !== undefined;
const r1 = (n) => Math.round(n * 10) / 10;

// alloc: { positions:[{symbol,sector,weight}], sectors:[{sector,weight}], cashPct, settings }
// pitch: { symbol, direction, sizePct }, sector: sector of the pitched symbol (may be "")
function fitCheck(alloc, pitch, sector = "") {
  const s = alloc.settings || {};
  const sym = String(pitch.symbol || "").toUpperCase();
  const size = Number(pitch.sizePct);
  const existing = alloc.positions.find((p) => p.symbol === sym);
  const curW = existing ? existing.weight : 0;
  const sec = existing?.sector || sector || "Unclassified";
  const curSec = alloc.sectors.find((x) => x.sector === sec)?.weight || 0;
  const buying = pitch.direction === "buy" || pitch.direction === "add";

  if (!buying && !existing) return { ok: false, reason: `The fund doesn't hold ${sym}, so there is nothing to ${pitch.direction}.` };
  if (pitch.direction !== "sell" && !(size > 0)) return { ok: false, reason: "Add a proposed size to see the impact on the fund." };

  let delta;
  if (buying) delta = size;
  else if (pitch.direction === "sell") delta = -curW;
  else delta = -Math.min(size, curW);

  const newW = Math.max(0, curW + delta);
  const newSec = Math.max(0, curSec + delta);
  const newCash = alloc.cashPct - delta;
  const newCount = alloc.positions.length + (!existing && buying ? 1 : 0) - (existing && newW === 0 ? 1 : 0);

  const issues = [];
  // Only flag what the trade causes or worsens: a limit already broken before the trade and
  // not made worse isn't this pitch's problem.
  if (buying && has(s.maxPositionPct) && newW > s.maxPositionPct) issues.push({ level: "breach", rule: "Max position size", detail: `${sym} would be ${r1(newW)}% of the fund (limit ${s.maxPositionPct}%).` });
  if (buying && has(s.maxSectorPct) && newSec > s.maxSectorPct) issues.push({ level: "breach", rule: "Max sector weight", detail: `${sec} would be ${r1(newSec)}% of the fund (limit ${s.maxSectorPct}%).` });
  if (has(s.minCashPct) && newCash < s.minCashPct && newCash < alloc.cashPct) issues.push({ level: "breach", rule: "Minimum cash", detail: `Cash would drop to ${r1(newCash)}% (policy minimum ${s.minCashPct}%).` });
  if (newCash < 0) issues.push({ level: "breach", rule: "Not enough cash", detail: `This needs ${r1(delta)}% of the fund but only ${r1(alloc.cashPct)}% is cash; it would need to be funded by selling something.` });
  if (has(s.maxPositions) && newCount > s.maxPositions && newCount > alloc.positions.length) issues.push({ level: "breach", rule: "Maximum holdings", detail: `${newCount} positions (policy maximum ${s.maxPositions}).` });
  if (has(s.minPositions) && newCount < s.minPositions && newCount < alloc.positions.length) issues.push({ level: "breach", rule: "Minimum holdings", detail: `${newCount} positions (policy minimum ${s.minPositions}).` });
  if (!issues.length && buying && has(s.maxPositionPct) && newW > s.maxPositionPct * 0.85) issues.push({ level: "watch", rule: "Close to position limit", detail: `${sym} would be ${r1(newW)}% (limit ${s.maxPositionPct}%).` });

  return {
    ok: true, symbol: sym, direction: pitch.direction, sector: sec, issues,
    before: { position: r1(curW), sector: r1(curSec), cash: r1(alloc.cashPct), positions: alloc.positions.length },
    after: { position: r1(newW), sector: r1(newSec), cash: r1(newCash), positions: newCount },
  };
}

module.exports = { fitCheck };
