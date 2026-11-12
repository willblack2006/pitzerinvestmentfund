// Builds lib/seed/13fSeed.json.gz: 13F breadth history for the tickers in lib/seed/13fCusips.json,
// from SEC's quarterly "Form 13F data sets" (sec.gov/data-research/sec-markets-data/form-13f-data-sets).
// Run on a laptop, not the server (each zip is ~100 MB):
//
//   node scripts/build-13f-seed.js <zip> [<zip> ...]
//
// Pass consecutive data sets. Each period's breadth uses every filing for that period found in
// any of the zips, so a late filer that lands in the next set is still counted. The newest
// period's per-filer positions are kept too, so the live ingest can compare this quarter's
// filers against what they reported last quarter.
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const B = require("../lib/thirteenFBreadth");

const MONTHS = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };
const isoDate = (s) => { const m = String(s).match(/^(\d{2})-([A-Z]{3})-(\d{4})$/); return m ? `${m[3]}-${MONTHS[m[2]]}-${m[1]}` : null; };

async function eachRow(zip, file, fn) {
  const child = spawn("unzip", ["-p", zip, file]);
  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  let header = null;
  for await (const line of rl) {
    const cols = line.split("\t");
    if (!header) { header = Object.fromEntries(cols.map((c, i) => [c, i])); continue; }
    fn(cols, header);
  }
}

async function main() {
  const zips = process.argv.slice(2);
  if (!zips.length) throw new Error("Pass one or more Form 13F data set zips.");
  const cusipMap = JSON.parse(fs.readFileSync(path.join(__dirname, "../lib/seed/13fCusips.json"), "utf8"));
  const symbolOf = new Map();
  for (const [sym, cusips] of Object.entries(cusipMap)) if (!sym.startsWith("_")) for (const c of cusips) symbolOf.set(c, sym);

  // 1. Which filing stands for each filer and period: the latest original 13F-HR or restatement.
  const subs = new Map(); // accession -> { cik, period, filed, form }
  const cover = new Map(); // accession -> { amendType, reportType }
  const totals = new Map(); // accession -> tableValueTotal
  for (const zip of zips) {
    await eachRow(zip, "SUBMISSION.tsv", (c, h) => subs.set(c[h.ACCESSION_NUMBER], { cik: c[h.CIK], period: isoDate(c[h.PERIODOFREPORT]), filed: isoDate(c[h.FILING_DATE]), form: c[h.SUBMISSIONTYPE] }));
    await eachRow(zip, "COVERPAGE.tsv", (c, h) => cover.set(c[h.ACCESSION_NUMBER], { amendType: c[h.AMENDMENTTYPE], reportType: c[h.REPORTTYPE] }));
    await eachRow(zip, "SUMMARYPAGE.tsv", (c, h) => totals.set(c[h.ACCESSION_NUMBER], Number(c[h.TABLEVALUETOTAL]) || 0));
  }
  const chosen = new Map(); // `${cik}|${period}` -> accession
  const firstFiled = new Map(); // `${cik}|${period}` -> earliest original filing date (season curve)
  for (const [acc, s] of subs) {
    const cv = cover.get(acc) || {};
    if (!s.period || /NOTICE/i.test(cv.reportType || "")) continue;
    const isOriginal = s.form === "13F-HR";
    if (!isOriginal && !(s.form === "13F-HR/A" && /RESTATEMENT/i.test(cv.amendType || ""))) continue;
    const key = `${s.cik}|${s.period}`;
    if (isOriginal && (!firstFiled.has(key) || s.filed < firstFiled.get(key))) firstFiled.set(key, s.filed);
    const cur = chosen.get(key);
    if (!cur || s.filed > subs.get(cur).filed || (s.filed === subs.get(cur).filed && acc > cur)) chosen.set(key, acc);
  }

  // Periods with a full filing season in these zips (a few stray old periods get refiled).
  const counts = {};
  for (const key of chosen.keys()) { const p = key.split("|")[1]; counts[p] = (counts[p] || 0) + 1; }
  const periods = Object.keys(counts).filter((p) => counts[p] >= 3000).sort();
  console.log("periods:", periods.map((p) => `${p} (${counts[p]} filers)`).join(", "));

  const filers = Object.fromEntries(periods.map((p) => [p, new Map()])); // period -> cik -> totalValue
  const accToKey = new Map();
  for (const [key, acc] of chosen) {
    const [cik, period] = key.split("|");
    if (!filers[period]) continue;
    filers[period].set(cik, totals.get(acc) || 0);
    accToKey.set(acc, { cik, period });
  }

  // 2. Our tickers' rows, summed per filer (a filer lists one row per sub-account).
  const positions = Object.fromEntries(periods.map((p) => [p, new Map()])); // period -> `${cik}|${cusip}` -> { shares, value }
  for (const zip of zips) {
    await eachRow(zip, "INFOTABLE.tsv", (c, h) => {
      const cusip = (c[h.CUSIP] || "").toUpperCase();
      if (!symbolOf.has(cusip) || c[h.PUTCALL] || c[h.SSHPRNAMTTYPE] !== "SH") return;
      const k = accToKey.get(c[h.ACCESSION_NUMBER]);
      if (!k) return;
      const key = `${k.cik}|${cusip}`;
      const cur = positions[k.period].get(key) || { shares: 0, value: 0 };
      cur.shares += Number(c[h.SSHPRNAMT]) || 0;
      cur.value += Number(c[h.VALUE]) || 0;
      positions[k.period].set(key, cur);
    });
  }

  // 3. Breadth per ticker per period (buyer/seller counts need the period before).
  const bySymbol = (period, sym) => {
    const m = new Map();
    for (const [key, v] of positions[period]) {
      const [cik, cusip] = key.split("|");
      if (symbolOf.get(cusip) !== sym || !(v.shares > 0)) continue;
      const cur = m.get(cik) || { shares: 0, value: 0 };
      cur.shares += v.shares; cur.value += v.value;
      m.set(cik, cur);
    }
    return m;
  };
  const history = [];
  for (const sym of new Set(symbolOf.values())) {
    for (let i = 0; i < periods.length; i++) {
      const period = periods[i], prior = periods[i - 1];
      const hasPrior = prior && prior === B.prevQuarter(period);
      const b = B.computeBreadth({
        current: bySymbol(period, sym),
        prior: hasPrior ? bySymbol(prior, sym) : new Map(),
        filersCur: filers[period],
        filersPrior: hasPrior ? filers[prior] : new Map(),
      });
      if (!hasPrior) for (const k of ["buyers", "sellers", "unchanged", "newPositions", "exits", "netPct"]) b[k] = null;
      history.push({ symbol: sym, period, ...b });
    }
  }

  // 4. Filing-season curve: originals filed by each day after quarter end.
  const season = {};
  for (const [key, filed] of firstFiled) {
    const period = key.split("|")[1];
    if (!filers[period]) continue;
    const day = B.daysAfter(period, filed);
    (season[period] ||= {})[day] = (season[period][day] || 0) + 1;
  }

  const latest = periods[periods.length - 1];
  const seed = {
    builtAt: new Date().toISOString(),
    sources: zips.map((z) => path.basename(z)),
    periods,
    history,
    season,
    latest: {
      period: latest,
      filers: [...filers[latest]].map(([cik, total]) => [cik, total]),
      positions: [...positions[latest]].filter(([, v]) => v.shares > 0).map(([key, v]) => [...key.split("|"), v.shares, Math.round(v.value)]),
    },
  };
  const out = path.join(__dirname, "../lib/seed/13fSeed.json.gz");
  fs.writeFileSync(out, zlib.gzipSync(JSON.stringify(seed), { level: 9 }));
  console.log(`wrote ${out}: ${history.length} history rows, ${seed.latest.filers.length} filers and ${seed.latest.positions.length} positions for ${latest}, ${(fs.statSync(out).size / 1e6).toFixed(2)} MB`);
}

main().catch((err) => { console.error(err); process.exit(1); });
