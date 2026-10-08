// EDGAR 13F-HR filings: a manager's quarterly information table of equity holdings. 13F
// filings have a ~45-day lag after quarter end (deadline is 45 days after quarter close).
const { cached } = require("../cache");
const { parseManagerSearch } = require("../thirteenF");

function userAgent() {
  return process.env.SEC_USER_AGENT || "Pitzer Investment Fund research@example.edu";
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": userAgent(), Accept: "application/json" } });
  if (!res.ok) throw new Error(`EDGAR request failed: ${res.status} ${url}`);
  return res.json();
}

async function fetchXml(url) {
  const res = await fetch(url, { headers: { "User-Agent": userAgent(), Accept: "application/xml,text/xml,*/*" } });
  if (!res.ok) throw new Error(`EDGAR request failed: ${res.status} ${url}`);
  return res.text();
}

// Pure parse: a 13F information table XML -> [{ nameOfIssuer, cusip, value, shares, putCall }].
// `value` is in whole dollars (the SEC switched 13F values from thousands to dollars for
// filings made from January 2023 on).
function parseInfoTable(xml) {
  const entries = [...xml.matchAll(/<(?:\w+:)?infoTable>([\s\S]*?)<\/(?:\w+:)?infoTable>/gi)];
  return entries.map((m) => {
    const block = m[1];
    const grab = (tag) => block.match(new RegExp(`<(?:\\w+:)?${tag}>([^<]*)<\\/(?:\\w+:)?${tag}>`, "i"))?.[1]?.trim() || "";
    return {
      nameOfIssuer: grab("nameOfIssuer"),
      cusip: grab("cusip"),
      value: Number(grab("value")) || 0,
      shares: Number(grab("sshPrnamt")) || 0,
      putCall: grab("putCall") || null,
    };
  });
}

async function get13FFilings(cik, limit = 2) {
  return cached(`13f_filings_${cik}`, 12 * 60 * 60, "sec_13f", async () => {
    const json = await fetchJson(`https://data.sec.gov/submissions/CIK${cik}.json`);
    const r = json.filings?.recent || {};
    const out = [];
    for (let i = 0; i < (r.form || []).length && out.length < limit; i++) {
      if (!/^13F-HR/.test(r.form[i])) continue;
      out.push({ accession: r.accessionNumber[i], filingDate: r.filingDate[i], periodOfReport: r.reportDate[i] });
    }
    return { companyName: json.name || "", filings: out };
  });
}

async function findInfoTableUrl(cik, accession) {
  const accNoDash = accession.replace(/-/g, "");
  const cikNum = Number(cik);
  const idx = await fetchJson(`https://www.sec.gov/Archives/edgar/data/${cikNum}/${accNoDash}/index.json`);
  const files = idx.directory?.item || [];
  // The holdings table is the filing's XML other than the cover page (primary_doc.xml). Filers
  // name it anything ("infotable.xml", "56757.xml"), so prefer an "infotable" name, else the
  // largest remaining XML.
  const xmls = files.filter((f) => /\.xml$/i.test(f.name) && !/^primary_doc\.xml$/i.test(f.name));
  const info = xmls.find((f) => /infotable/i.test(f.name)) || xmls.sort((a, b) => (Number(b.size) || 0) - (Number(a.size) || 0))[0];
  return info ? `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accNoDash}/${info.name}` : null;
}

// The two most recent 13F-HR filings' parsed holdings, for a quarter-over-quarter comparison.
async function getHoldings(cik) {
  return cached(`13f_holdings_v2_${cik}`, 24 * 60 * 60, "sec_13f", async () => {
    const { companyName, filings } = await get13FFilings(cik, 2);
    if (!filings.length) return { companyName, filings: [], current: [], prior: [] };
    const urls = await Promise.all(filings.map((f) => findInfoTableUrl(cik, f.accession).catch(() => null)));
    const tables = await Promise.all(urls.map((u) => (u ? fetchXml(u).then(parseInfoTable).catch(() => []) : [])));
    return { companyName, filings, current: tables[0] || [], prior: tables[1] || [] };
  });
}

// Find 13F filers by name via EDGAR full-text search (free; same User-Agent rule as the
// rest of EDGAR), limited to 13F-HR filings so only institutional managers come back.
// EDGAR returns at most 30 filers per query, so a very common word can miss a manager.
async function searchManagers(query) {
  const q = String(query || "").replace(/["\\]/g, " ").replace(/\s+/g, " ").trim();
  return cached(`13f_search_${q.toLowerCase()}`, 7 * 24 * 60 * 60, "sec_13f", async () => {
    const json = await fetchJson(`https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${q}"`)}&forms=13F-HR`);
    return parseManagerSearch(json, q);
  });
}

module.exports = { parseInfoTable, get13FFilings, getHoldings, searchManagers };
