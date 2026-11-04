// Ticker lookup by symbol or company name. Merges the fund's own tickers, the SEC company
// directory (every US-registered ticker) and Yahoo's search (ETFs, indices, foreign listings),
// then ranks them. Pure, so it's unit-testable without the network.

const SUFFIXES = /\b(the|inc|incorporated|corp|corporation|co|company|ltd|limited|plc|holdings?|group|sa|nv|ag|class [a-c])\b/g;

function normName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\/(new|de|md|ny)\b/g, " ") // SEC's state tags: "COSTCO WHOLESALE CORP /NEW"
    .replace(/&/g, " and ")
    .replace(/[.,'’()/-]/g, " ")
    .replace(SUFFIXES, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const US_EXCHANGES = new Set(["NMS", "NYQ", "NGM", "NCM", "ASE", "PCX", "BTS", "NAS", "NYS", "NasdaqGS", "NasdaqGM", "NasdaqCM", "NYSE", "NYSEArca", "NASDAQ"]);
// "HSY.HM", "APC.F": Yahoo marks foreign listings with a dot suffix (share classes use a
// dash, "BRK-B"), so any dot suffix is a foreign listing.
const isForeign = (sym) => /\.[A-Z]+$/.test(sym);

// Futures, crypto, options and currencies aren't things the fund researches.
const SKIP_TYPES = new Set(["FUTURE", "CRYPTOCURRENCY", "OPTION", "CURRENCY"]);

// How well `q` matches one candidate; 0 means no match.
function matchScore(q, { symbol, name }) {
  const qu = q.toUpperCase().replace(/\s+/g, "").replace(/[./](?=[A-Z]$)/, "-");
  const sym = symbol.toUpperCase();
  const qn = normName(q);
  const n = normName(name);
  if (sym === qu || sym.replace(/[.-]/g, "") === qu.replace(/[.-]/g, "")) return 100;
  let best = 0;
  if (qn && n) {
    if (n === qn) best = 90;
    else if (n.startsWith(qn + " ") || n.startsWith(qn)) best = 80;
    else if ((" " + n).includes(" " + qn)) best = 65;
    else if (qn.length >= 3 && n.includes(qn)) best = 40;
  }
  if (sym.startsWith(qu) && qu.length >= 1) best = Math.max(best, 55 - Math.min(sym.length - qu.length, 4) * 3);
  return best;
}

// candidates: [{ symbol, name, exchange?, type?, source: "fund"|"sec"|"yahoo", owned?, watching?, yahooRank? }]
function rankSymbols(q, candidates, limit = 8) {
  const query = String(q || "").trim();
  if (!query) return [];
  const bySymbol = new Map();
  for (const c of candidates) {
    if (!c?.symbol || SKIP_TYPES.has(c.type) || /=F$|-USD$/.test(c.symbol)) continue;
    const symbol = c.symbol.toUpperCase();
    const prev = bySymbol.get(symbol) || { symbol, name: null, exchange: null, exchDisp: null, type: null, owned: false, watching: false, sources: new Set(), yahooRank: null };
    // Yahoo's names read better than SEC's ("The Hershey Company" vs "HERSHEY CO").
    if (c.name && (!prev.name || c.source === "yahoo")) prev.name = c.name;
    prev.exchange = prev.exchange || c.exchange || null;
    prev.exchDisp = prev.exchDisp || c.exchDisp || null;
    prev.type = prev.type || c.type || null;
    prev.owned ||= !!c.owned;
    prev.watching ||= !!c.watching;
    prev.sources.add(c.source);
    if (c.yahooRank != null) prev.yahooRank = prev.yahooRank == null ? c.yahooRank : Math.min(prev.yahooRank, c.yahooRank);
    bySymbol.set(symbol, prev);
  }
  const rows = [];
  for (const r of bySymbol.values()) {
    let score = matchScore(query, r);
    // Yahoo's own relevance order counts even when the name doesn't literally contain the
    // query (e.g. "google" → GOOGL, "Alphabet Inc.").
    if (r.yahooRank != null) score = Math.max(score, 60 - r.yahooRank * 4);
    if (!score) continue;
    if (r.owned) score += 30; // the fund's own names are what members look up most
    else if (r.watching) score += 15;
    if (r.sources.has("sec")) score += 6; // a US-registered listing
    if (r.exchange && US_EXCHANGES.has(r.exchange)) score += 4;
    if (isForeign(r.symbol)) score -= 30;
    rows.push({ ...r, score });
  }
  // Drop foreign listings of a company that also has a US listing ("HSY.HM", "HSHY34.SA").
  const home = rows.filter((r) => !isForeign(r.symbol));
  const base = new Set(home.map((r) => r.symbol));
  const homeNames = new Set(home.map((r) => normName(r.name)).filter(Boolean));
  return rows
    .filter((r) => !(isForeign(r.symbol) && (base.has(r.symbol.split(".")[0]) || homeNames.has(normName(r.name)))))
    .sort((a, b) => b.score - a.score || a.symbol.length - b.symbol.length || a.symbol.localeCompare(b.symbol))
    .slice(0, limit)
    .map(({ symbol, name, exchange, exchDisp, type, owned, watching }) => ({ symbol, name, exchange: exchDisp || exchange, type, owned, watching }));
}

// Cheap pre-filter over the ~10k-row SEC directory before ranking.
function directoryMatches(q, directory, max = 40) {
  // "BRK.B" and "BRK/B" are how people type share classes; SEC and Yahoo use "BRK-B".
  const qu = String(q || "").trim().toUpperCase().replace(/[./](?=[A-Z]$)/, "-");
  const qn = normName(q);
  if (!qu) return [];
  const out = [];
  for (const row of directory) {
    if (row.ticker.startsWith(qu.replace(/\s+/g, "")) || (qn.length >= 2 && normName(row.name).includes(qn))) {
      out.push({ symbol: row.ticker, name: row.name, source: "sec" }); // SEC and Yahoo both use BRK-B
      if (out.length >= max) break;
    }
  }
  return out;
}

module.exports = { normName, matchScore, rankSymbols, directoryMatches };
