// Senate eFD financial disclosures: a DataTables-backed search (undocumented JSON API) plus the
// HTML "print view" of each Periodic Transaction Report. Unlike the House Clerk, the site gates
// searches behind a click-through agreement to 5 U.S.C. app. §105(c) (no commercial use, no
// solicitation, no credit-rating use) — agreeing programmatically is required before any search.
const { cached, getCached, setCached } = require("../cache");

const BASE = "https://efdsearch.senate.gov";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function parseSetCookies(res, jar) {
  const set = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  for (const c of set) {
    const [kv] = c.split(";");
    const eq = kv.indexOf("=");
    if (eq > 0) jar[kv.slice(0, eq)] = kv.slice(eq + 1);
  }
}

const cookieHeader = (jar) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");

// Agrees to the site's terms and returns a cookie jar good for searching. Cached for an hour,
// same pattern as the Yahoo crumb session.
async function getSession() {
  const hit = getCached("senate_efd_session");
  if (hit) return hit;

  const jar = {};
  const homeRes = await fetch(`${BASE}/search/home/`, { headers: { "User-Agent": UA } });
  parseSetCookies(homeRes, jar);
  const homeHtml = await homeRes.text();
  const csrfField = /name="csrfmiddlewaretoken" value="([^"]+)"/.exec(homeHtml)?.[1];
  if (!csrfField) throw new Error("Could not find Senate eFD agreement form");

  const agreeRes = await fetch(`${BASE}/search/home/`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieHeader(jar),
      Referer: `${BASE}/search/home/`,
      Origin: BASE,
    },
    body: new URLSearchParams({ prohibition_agreement: "1", csrfmiddlewaretoken: csrfField }).toString(),
    redirect: "manual",
  });
  if (agreeRes.status !== 302) throw new Error(`Senate eFD agreement was not accepted: ${agreeRes.status}`);
  parseSetCookies(agreeRes, jar);

  const session = { jar };
  setCached("senate_efd_session", session, 55 * 60, "senate_efd");
  return session;
}

// One page of Periodic Transaction Report filings since `startDate` (MM/DD/YYYY). The site's
// DataTables endpoint is a server-side search; `start`/`length` page through it.
async function searchPage(session, { startDate, start = 0, length = 100 }) {
  const params = new URLSearchParams({
    report_types: "[11]",
    filer_types: "[]",
    submitted_start_date: `${startDate} 00:00:00`,
    submitted_end_date: "",
    candidate_state: "",
    senator_state: "",
    office_id: "",
    first_name: "",
    last_name: "",
    draw: "1",
    start: String(start),
    length: String(length),
  });
  const res = await fetch(`${BASE}/search/report/data/`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      "X-CSRFToken": session.jar.csrftoken,
      Referer: `${BASE}/search/`,
      Origin: BASE,
      Cookie: cookieHeader(session.jar),
    },
    body: params.toString(),
  });
  if (!res.ok) throw new Error(`Senate eFD search failed: ${res.status}`);
  return res.json();
}

function parseRow(row) {
  const [first, last, , reportCell, filingDate] = row;
  const link = /href="([^"]+)"/.exec(reportCell)?.[1];
  if (!link) return null; // paper filings have no detail link and no extractable text
  return {
    name: [first, last].filter(Boolean).join(" "),
    filingDate: filingDate ? filingDate.replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, "$3-$1-$2") : null,
    url: `${BASE}${link}`,
  };
}

async function getPtrIndex(startDate) {
  const session = await getSession();
  const filings = [];
  let start = 0;
  for (;;) {
    const page = await searchPage(session, { startDate, start, length: 100 });
    for (const row of page.data) {
      const f = parseRow(row);
      if (f) filings.push(f);
    }
    start += 100;
    if (start >= page.recordsFiltered) break;
  }
  return filings;
}

const TYPE = { Purchase: "Purchase", Sale: "Sale", "Sale (Full)": "Sale", "Sale (Partial)": "Partial sale", Exchange: "Exchange" };

const cellText = (html) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

// One filing's HTML table -> trades with a ticker. Columns: #, Transaction Date, Owner, Ticker,
// Asset Name, Asset Type, Type, Amount, Comment. Non-stock rows (bonds, funds without a ticker)
// read "--" for Ticker and are skipped.
function parsePtrHtml(html) {
  const tbody = /<tbody>([\s\S]*?)<\/tbody>/.exec(html)?.[1];
  if (!tbody) return [];
  const trades = [];
  for (const rowHtml of tbody.match(/<tr>[\s\S]*?<\/tr>/g) || []) {
    const cells = [...rowHtml.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((m) => cellText(m[1]));
    if (cells.length < 8) continue;
    const [, date, owner, ticker, assetName, assetType, type, amount] = cells;
    if (!ticker || ticker === "--") continue;
    const mdy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date);
    trades.push({
      ticker,
      owner,
      assetName,
      assetType: /option/i.test(assetType) ? "option" : "stock",
      type: TYPE[type] || type,
      tradeDate: mdy ? `${mdy[3]}-${mdy[1]}-${mdy[2]}` : null,
      amount,
    });
  }
  return trades;
}

// A filed report never changes, so its parsed trades cache for 30 days.
async function getPtrTrades(filing) {
  const cacheKey = `senate_ptr_${filing.url}`;
  const hit = getCached(cacheKey);
  if (hit) return hit;
  const session = await getSession();
  const res = await fetch(filing.url, { headers: { "User-Agent": UA, Cookie: cookieHeader(session.jar) } });
  if (!res.ok) throw new Error(`Senate PTR request failed: ${res.status} ${filing.url}`);
  const trades = parsePtrHtml(await res.text());
  setCached(cacheKey, trades, 30 * 24 * 60 * 60, "senate_efd");
  return trades;
}

// Senate PTRs filed in the last `days` days, each with its parsed trades. Same shape as
// houseDisclosures.getRecentPtrs (filings + trades) so the two chambers can be merged.
async function getRecentPtrs(days = 60) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - days * 864e5);
  const startDate = `${String(cutoff.getMonth() + 1).padStart(2, "0")}/${String(cutoff.getDate()).padStart(2, "0")}/${cutoff.getFullYear()}`;
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  const index = await cached(`senate_fd_index_${startDate}`, 60 * 60, "senate_efd", () => getPtrIndex(startDate));

  const recent = index.filter((f) => f.filingDate && f.filingDate >= cutoffIso);
  const queue = [...recent];
  const out = [];
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const f = queue.shift();
      try { out.push({ ...f, trades: await getPtrTrades(f) }); } catch { out.push({ ...f, trades: [], error: true }); }
    }
  }));
  return { filings: out, paperCount: 0 };
}

module.exports = { getSession, getPtrIndex, getPtrTrades, getRecentPtrs, parsePtrHtml };
