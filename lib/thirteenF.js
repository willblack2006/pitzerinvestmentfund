// 13F "best ideas" tracker: pure math over parsed 13F info-table rows ({ nameOfIssuer,
// cusip, value (in dollars), shares, putCall }). The route does the EDGAR fetches.
//
// A true "highest conviction" measure (Cohen, Polk & Silli, 2010) ranks positions by their
// overweight vs the STOCK'S weight in the overall market, which needs a market-cap weight for
// every single holding — free EDGAR data doesn't provide that. This instead ranks by weight
// within the manager's OWN reported portfolio (value / total 13F value), which is a simpler
// but still informative proxy for where a manager is concentrated, and says so in the UI.

// A manager reports one row per stock per sub-account/discretion type (Berkshire lists Apple
// a dozen times), so combine rows for the same security before ranking. Option positions
// (putCall set) stay separate from the shares.
function aggregateByCusip(holdings) {
  const byKey = new Map();
  for (const h of holdings) {
    const key = `${h.cusip}|${h.putCall || ""}`;
    const cur = byKey.get(key);
    if (cur) { cur.value += h.value || 0; cur.shares += h.shares || 0; }
    else byKey.set(key, { ...h, value: h.value || 0, shares: h.shares || 0 });
  }
  return [...byKey.values()];
}

function computeWeights(rows) {
  const holdings = aggregateByCusip(rows);
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
  const key = (h) => `${h.cusip}|${h.putCall || ""}`;
  const priorByCusip = new Map(computeWeights(prior).map((h) => [key(h), h]));
  return weightedCurrent.map((h) => {
    const p = priorByCusip.get(key(h));
    return { ...h, priorWeightPct: p?.weightPct ?? null, weightChangePct: p ? h.weightPct - p.weightPct : h.weightPct, isNew: !p };
  });
}

// Pure parse of an EDGAR full-text search response (restricted to 13F-HR filings) into
// managers whose own name contains every word of the query. The search matches filing text,
// so its filer list also includes managers that merely hold a stock with that name (e.g.
// "berkshire" returns every holder of BRK); the name filter drops those. One row per CIK,
// most matching 13F documents first. Bucket keys look like "NAME  (TICKERS)  (CIK 0001067983)".
function parseManagerSearch(json, query) {
  const words = String(query || "").toLowerCase().split(/[^a-z0-9&]+/).filter(Boolean);
  const out = [], seen = new Set();
  const buckets = [...(json?.aggregations?.entity_filter?.buckets || [])].sort((a, b) => (b.doc_count || 0) - (a.doc_count || 0));
  for (const b of buckets) {
    const m = String(b.key || "").match(/^(.*?)(?:\s{2}\(([^)]*)\))?\s*\(CIK (\d{10})\)\s*$/);
    if (!m || seen.has(m[3])) continue;
    const name = m[1].trim();
    if (!words.length || !words.every((w) => name.toLowerCase().includes(w))) continue;
    seen.add(m[3]);
    out.push({ cik: m[3], name, matches: b.doc_count || 0 });
  }
  return out;
}

module.exports = { aggregateByCusip, computeWeights, topConviction, normalizeName, matchOverlaps, qoqChanges, parseManagerSearch };
