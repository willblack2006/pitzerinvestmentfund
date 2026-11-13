// 13F breadth: quarter math, buyer/seller counting, split detection, EDGAR parses, the streaming
// holdings-table reader, and the season / breadth API routes.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pif-13f-")), "unit.db");

const B = require("../lib/thirteenFBreadth");
const sec = require("../lib/sources/thirteenF");
const { startServer } = require("./helpers");

test("13F quarters: current period, prior, deadline rolls off weekends", () => {
  assert.equal(B.quarterEnd("2026-11-12"), "2026-09-30");
  assert.equal(B.quarterEnd("2026-09-30"), "2026-09-30");
  assert.equal(B.quarterEnd("2026-01-05"), "2025-12-31");
  assert.equal(B.quarterEnd("2026-03-30"), "2025-12-31");
  assert.equal(B.prevQuarter("2026-09-30"), "2026-06-30");
  assert.equal(B.prevQuarter("2026-03-31"), "2025-12-31");
  assert.equal(B.filingDeadline("2026-09-30"), "2026-11-16", "Nov 14 2026 is a Saturday");
  assert.equal(B.filingDeadline("2026-06-30"), "2026-08-14");
  assert.equal(B.daysAfter("2026-09-30", "2026-11-14"), 45);
  assert.equal(B.quarterLabel("2026-09-30"), "Q3 '26");
  assert.equal(B.sizeBucket(5e8), "small");
  assert.equal(B.sizeBucket(5e9), "mid");
  assert.equal(B.sizeBucket(2e12), "large");
});

const m = (obj) => new Map(Object.entries(obj));
const pos = (obj) => new Map(Object.entries(obj).map(([k, s]) => [k, { shares: s, value: s * 10 }]));

test("13F breadth: buyers, sellers, new, exits; late filers aren't counted as exits", () => {
  const b = B.computeBreadth({
    prior: pos({ a: 100, b: 100, c: 100, d: 100, late: 100 }),
    current: pos({ a: 150, b: 50, c: 100.5, e: 10 }),
    filersPrior: m({ a: 5e8, b: 5e8, c: 5e9, d: 5e9, e: 5e8, late: 3e10 }),
    filersCur: m({ a: 5e8, b: 5e8, c: 5e9, d: 5e9, e: 5e8, f: 1e8 }),
  });
  assert.equal(b.holders, 4);
  assert.equal(b.buyers, 2, "a added, e opened a position");
  assert.equal(b.newPositions, 1);
  assert.equal(b.sellers, 2, "b cut, d sold out");
  assert.equal(b.exits, 1);
  assert.equal(b.unchanged, 1, "c within ±1%");
  assert.equal(b.netPct, 0);
  assert.equal(b.reported, 6);
  assert.equal(b.reportedBoth, 5, "f is a first-time filer");
  assert.equal(b.bySize.small.buyers, 2);
  assert.equal(b.bySize.mid.sellers, 1);
  assert.equal(b.bySize.large.holders, 0, "the filer that hasn't reported yet is ignored");
});

test("13F breadth: a 10-for-1 split is not a wave of buying", () => {
  const prior = {}, current = {}, filers = {};
  for (let i = 0; i < 40; i++) {
    const k = `f${i}`;
    prior[k] = 100;
    current[k] = i < 15 ? 1000 : i < 30 ? 1300 : 700; // 15 untouched, 15 added, 10 cut
    filers[k] = 1e9;
  }
  const b = B.computeBreadth({ prior: pos(prior), current: pos(current), filersPrior: m(filers), filersCur: m(filers) });
  assert.equal(b.split, 10);
  assert.equal(b.buyers, 15);
  assert.equal(b.sellers, 10);
  assert.equal(b.unchanged, 15);
  // An ordinary quarter with heavy buying is not mistaken for a split.
  assert.equal(B.splitFactor(Array.from({ length: 40 }, (_, i) => ({ prior: 100, cur: i < 10 ? 100 : 150 + i }))), 1);
});

test("13F parses: Atom feed, daily form index, cover page", () => {
  const feed = `<feed><entry>
<title>13F-HR - Dakota Wealth Management (0001631353) (Filer)</title>
<updated>2026-11-12T17:28:24-05:00</updated>
<category scheme="https://www.sec.gov/" label="form type" term="13F-HR"/>
<id>urn:tag:sec.gov,2008:accession-number=0001951757-26-001931</id>
</entry><entry>
<title>13F-HR/A - Capital Analysts, LLC (0001624758) (Filer)</title>
<updated>2026-11-12T17:29:25-05:00</updated>
<category scheme="https://www.sec.gov/" label="form type" term="13F-HR/A"/>
<id>urn:tag:sec.gov,2008:accession-number=0001624758-26-000016</id>
</entry></feed>`;
  const f = B.parseAtomFeed(feed);
  assert.equal(f.length, 2);
  assert.deepEqual(f[0], { form: "13F-HR", name: "Dakota Wealth Management", cik: "0001631353", role: "Filer", accession: "0001951757-26-001931", filedAt: "2026-11-12T17:28:24-05:00" });
  assert.equal(f[1].form, "13F-HR/A");

  const idx = `Form Type   Company Name                                                  CIK
---------------------------------------------------------------------------------------------------------------------------------------------
13F-HR           1832 Asset Management L.P.                                    944388      20261110    edgar/data/944388/0000944388-26-000018.txt
13F-HR/A         Some Amended Filer LLC                                        123456      20261110    edgar/data/123456/0000123456-26-000001.txt
13F-NT           Notice Only Inc                                               222222      20261110    edgar/data/222222/0000222222-26-000002.txt`;
  assert.deepEqual(B.parseFormIndex(idx), [{ form: "13F-HR", name: "1832 Asset Management L.P.", cik: "0000944388", filedAt: "2026-11-10", accession: "0000944388-26-000018" }]);

  const cover = B.parsePrimaryDoc(`<edgarSubmission><headerData><filerInfo><periodOfReport>09-30-2026</periodOfReport></filerInfo></headerData>
    <formData><coverPage><filingManager><name>GEODE CAPITAL MANAGEMENT, LLC</name></filingManager><reportType>13F HOLDINGS REPORT</reportType></coverPage>
    <signatureBlock><name>Laura Doherty</name></signatureBlock><summaryPage><tableEntryTotal>8379</tableEntryTotal><tableValueTotal>1924364235538</tableValueTotal></summaryPage></formData></edgarSubmission>`);
  assert.deepEqual(cover, { period: "2026-09-30", name: "GEODE CAPITAL MANAGEMENT, LLC", reportType: "13F HOLDINGS REPORT", isAmendment: false, tableEntryTotal: 8379, tableValueTotal: 1924364235538 });
  assert.equal(B.parsePrimaryDoc("<filingManager><name>JPMORGAN CHASE &amp; CO</name></filingManager>").name, "JPMORGAN CHASE & CO");
});

test("13F holdings table streams correctly when entries straddle chunk boundaries", async () => {
  const row = (name, cusip, value, shares, putCall = "") => `<ns1:infoTable><ns1:nameOfIssuer>${name}</ns1:nameOfIssuer><ns1:cusip>${cusip}</ns1:cusip><ns1:value>${value}</ns1:value><ns1:shrsOrPrnAmt><ns1:sshPrnamt>${shares}</ns1:sshPrnamt><ns1:sshPrnamtType>SH</ns1:sshPrnamtType></ns1:shrsOrPrnAmt>${putCall ? `<ns1:putCall>${putCall}</ns1:putCall>` : ""}</ns1:infoTable>`;
  const xml = `<?xml version="1.0"?><ns1:informationTable xmlns:ns1="x">${row("NVIDIA CORPORATION", "67066G104", 1000, 10)}${row("APPLE INC", "037833100", 500, 2)}${row("NVIDIA CORPORATION", "67066G104", 300, 3)}${row("NVIDIA CORPORATION", "67066G104", 50, 1, "Call")}</ns1:informationTable>`;
  const bytes = new TextEncoder().encode(xml);
  const realFetch = global.fetch;
  global.fetch = async () => new Response(new ReadableStream({
    start(c) { for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7)); c.close(); },
  }));
  try {
    const rows = [];
    await sec.streamInfoTable("https://example.test/info.xml", (r) => rows.push(r));
    assert.equal(rows.length, 4);
    assert.deepEqual(rows.map((r) => [r.cusip, r.shares, r.putCall]), [["67066G104", 10, null], ["037833100", 2, null], ["67066G104", 3, null], ["67066G104", 1, "Call"]]);
  } finally {
    global.fetch = realFetch;
  }
});

test("13F API: season status and breadth history from the seed", async () => {
  const s = await startServer();
  try {
    const season = await s.api("/api/13f/season");
    assert.equal(season.status, 200);
    assert.match(season.body.season.period, /^\d{4}-(03-31|06-30|09-30|12-31)$/);
    assert.equal(season.body.curve.days.length, 61);
    assert.ok(Array.isArray(season.body.biggest));

    const nvda = await s.api("/api/13f/breadth/nvda");
    assert.equal(nvda.status, 200);
    assert.equal(nvda.body.tracked, true);
    assert.ok(nvda.body.rows.length >= 4, "four seed quarters");
    const last = nvda.body.rows[nvda.body.rows.length - 1];
    assert.ok(last.holders > 1000, "thousands of filers hold NVDA");
    assert.ok(last.netPct >= -1 && last.netPct <= 1);

    assert.equal((await s.api("/api/13f/breadth/ZZZZ")).body.tracked, false);
    const table = await s.api("/api/13f/breadth");
    assert.equal(table.status, 200);
    assert.ok(Array.isArray(table.body.rows));
  } finally {
    await s.stop();
  }
});
