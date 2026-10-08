// Congressional trades (House only): the Clerk's yearly disclosure index plus the text of each
// electronically filed Periodic Transaction Report (PTR). Weak evidence: post-STOCK Act
// studies find no average edge in members' trades. The Senate site requires accepting its
// terms, so it isn't covered. Pure parsing; the source module fetches.

const TYPE = { P: "Purchase", S: "Sale", "S (partial)": "Partial sale", E: "Exchange" };

const isoDate = (mdy) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(mdy || "");
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
};

// The tab-separated YYYYFD.txt index. Keeps PTRs (FilingType "P") only. Electronic filings
// have DocIDs starting with 2; paper filings are scanned images with no extractable text.
function parseFdIndex(txt, year) {
  const [header, ...lines] = txt.split(/\r?\n/);
  const cols = header.split("\t");
  const at = (name) => cols.indexOf(name);
  const out = [];
  for (const line of lines) {
    const f = line.split("\t");
    if (f[at("FilingType")] !== "P") continue;
    const docId = (f[at("DocID")] || "").trim();
    if (!docId) continue;
    const name = [f[at("Prefix")], f[at("First")], f[at("Last")], f[at("Suffix")]].map((x) => (x || "").trim()).filter(Boolean).join(" ");
    out.push({
      name,
      district: (f[at("StateDst")] || "").trim(),
      filingDate: isoDate((f[at("FilingDate")] || "").trim()),
      docId,
      electronic: docId.startsWith("2"),
      url: `https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/${year}/${docId}.pdf`,
    });
  }
  return out;
}

// One PTR's extracted text -> trades with a ticker. Each line item reads like
// "Crown Castle Inc. Common Stock (CCI) [ST] S06/30/202607/02/2026$1,001 - $15,000"
// (the PDF text runs columns together). Only stock [ST] and option [OP] rows are kept.
function parsePtrText(text) {
  const flat = text.replace(/\s+/g, " ");
  const re = /\(([A-Z][A-Z0-9.\-]{0,6})\)\s*\[(ST|OP)\]\s*(S \(partial\)|P|S|E)\s*(\d{2}\/\d{2}\/\d{4})\s*(\d{2}\/\d{2}\/\d{4})\s*(\$[\d,]+\s*-\s*\$[\d,]+|Over \$[\d,]+|\$[\d,]+)/g;
  const trades = [];
  let m;
  while ((m = re.exec(flat))) {
    trades.push({
      ticker: m[1],
      assetType: m[2] === "OP" ? "option" : "stock",
      type: TYPE[m[3]],
      tradeDate: isoDate(m[4]),
      notifiedDate: isoDate(m[5]),
      amount: m[6].replace(/\s+/g, " "),
    });
  }
  return trades;
}

// Trades in names the fund tracks, newest first. `filings` carry `trades` from parsePtrText.
function matchTracked(filings, tracked) {
  const set = new Set(tracked.map((s) => s.toUpperCase()));
  const out = [];
  for (const f of filings) {
    for (const t of f.trades || []) {
      if (set.has(t.ticker)) out.push({ ...t, member: f.name, district: f.district, filingDate: f.filingDate, url: f.url });
    }
  }
  return out.sort((a, b) => (b.tradeDate || "").localeCompare(a.tradeDate || ""));
}

module.exports = { parseFdIndex, parsePtrText, matchTracked, isoDate };
