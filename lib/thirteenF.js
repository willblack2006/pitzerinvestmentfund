// 13F "best ideas" tracker — pure math over parsed 13F info-table rows ({ nameOfIssuer,
// cusip, value (in $000s), shares, putCall }). The route does the EDGAR fetches.
//
// A true "highest conviction" measure (Cohen, Polk & Silli, 2010) ranks positions by their
// overweight vs the STOCK'S weight in the overall market, which needs a market-cap weight for
// every single holding — free EDGAR data doesn't provide that. This instead ranks by weight
// within the manager's OWN reported portfolio (value / total 13F value), which is a simpler
// but still informative proxy for where a manager is concentrated, and says so in the UI.

function computeWeights(holdings) {
  const total = holdings.reduce((s, h) => s + (h.value || 0), 0);
  return holdings.map((h) => ({ ...h, weightPct: total ? (h.value || 0) / total : null })).sort((a, b) => (b.weightPct ?? -1) - (a.weightPct ?? -1));
}

function topConviction(holdings, n = 10) {
  return computeWeights(holdings).slice(0, n);
}

// Strips common legal suffixes and punctuation so "Apple Inc." and "APPLE INC" compare equal.
function normalizeName(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\b(inc|incorporated|corp|corporation|co|company|ltd|plc|llc|class [a-z]|the|holdings?)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Matches 13F issuer names against our own universe by normalized company name — a free
// substitute for CUSIP-to-ticker resolution (a paid data service EDGAR itself doesn't offer).
function matchOverlaps(holdings, universe) {
  const byName = new Map(universe.filter((u) => u.name).map((u) => [normalizeName(u.name), u.symbol]));
  return holdings
    .map((h) => ({ ...h, matchedSymbol: byName.get(normalizeName(h.nameOfIssuer)) || null }))
    .filter((h) => h.matchedSymbol);
}

// Quarter-over-quarter weight change for positions matched by CUSIP between two snapshots.
function qoqChanges(current, prior) {
  const weightedCurrent = computeWeights(current);
  const priorByCusip = new Map(computeWeights(prior).map((h) => [h.cusip, h]));
  return weightedCurrent.map((h) => {
    const p = priorByCusip.get(h.cusip);
    return { ...h, priorWeightPct: p?.weightPct ?? null, weightChangePct: p ? h.weightPct - p.weightPct : h.weightPct, isNew: !p };
  });
}

module.exports = { computeWeights, topConviction, normalizeName, matchOverlaps, qoqChanges };
