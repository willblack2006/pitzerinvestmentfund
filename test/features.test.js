// Pure-logic tests for features #21-23 (paper trading, government contracts, congressional
// trades). Kept apart from unit.test.js only to avoid edit collisions with parallel work.
const test = require("node:test");
const assert = require("node:assert/strict");

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test("paper trading: ledger replay, validation, valuation and ranking", () => {
  const { replayLedger, validateTrade, valuePortfolio, rankLeaderboard } = require("../lib/paperTrading");

  const trades = [
    { type: "buy", symbol: "AAPL", shares: 10, price: 100 },
    { type: "buy", symbol: "AAPL", shares: 10, price: 200 }, // avg cost now 150
    { type: "sell", symbol: "AAPL", shares: 5, price: 180 }, // realizes (180-150)*5 = 150
    { type: "buy", symbol: "MSFT", shares: 2, price: 50 },
    { type: "sell", symbol: "MSFT", shares: 2, price: 40 }, // closes the position at a 20 loss
  ];
  const s = replayLedger(trades, 10000);
  close(s.cash, 10000 - 1000 - 2000 + 900 - 100 + 80);
  close(s.realizedGain, 150 - 20);
  assert.equal(s.positions.length, 1);
  assert.equal(s.positions[0].symbol, "AAPL");
  assert.equal(s.positions[0].shares, 15);
  close(s.positions[0].avgCost, 150);

  assert.match(validateTrade(s, { type: "buy", symbol: "NVDA", shares: 1000, price: 100 }), /Not enough cash/);
  assert.match(validateTrade(s, { type: "sell", symbol: "AAPL", shares: 16, price: 100 }), /hold 15/);
  assert.match(validateTrade(s, { type: "sell", symbol: "TSLA", shares: 1, price: 100 }), /hold 0/);
  assert.match(validateTrade(s, { type: "buy", symbol: "AAPL", shares: 0, price: 100 }), /positive/);
  assert.match(validateTrade(s, { type: "buy", symbol: "AAPL", shares: 1, price: null }), /No live price/);
  assert.match(validateTrade(s, { type: "short", symbol: "AAPL", shares: 1, price: 1 }), /buy or sell/);
  assert.equal(validateTrade(s, { type: "sell", symbol: "AAPL", shares: 15, price: 100 }), null);

  const v = valuePortfolio(s, { AAPL: 160 }, 10000);
  close(v.holdingsValue, 15 * 160);
  close(v.totalValue, s.cash + 2400);
  close(v.returnPct, (s.cash + 2400) / 10000 - 1);
  const unpriced = valuePortfolio(s, {}, 10000);
  assert.equal(unpriced.positions[0].price, null);
  close(unpriced.positions[0].marketValue, 15 * 150); // falls back to cost

  const board = rankLeaderboard([
    { name: "A", returnPct: 0.05, tradeCount: 3 },
    { name: "B", returnPct: 0.1, tradeCount: 9 },
    { name: "C", returnPct: 0.05, tradeCount: 1 },
  ]);
  assert.deepEqual(board.map((r) => `${r.rank}${r.name}`), ["1B", "2C", "3A"]);
});

test("gov contracts: relevance, search text and award summary", () => {
  const { isGovRelevant, recipientSearchText, summarizeAwards } = require("../lib/govContracts");

  assert.equal(isGovRelevant("Industrials", "Aerospace & Defense"), true);
  assert.equal(isGovRelevant("Healthcare", "Drug Manufacturers - General"), true);
  assert.equal(isGovRelevant("Technology", "Information Technology Services"), true);
  assert.equal(isGovRelevant("Consumer Cyclical", "Restaurants"), false);
  assert.equal(isGovRelevant("Industrials", "Trucking"), false);

  assert.equal(recipientSearchText("Lockheed Martin Corporation"), "lockheed martin");
  assert.equal(recipientSearchText("Booz Allen Hamilton Holding Corp."), "booz allen hamilton");
  assert.equal(recipientSearchText("Co."), null);

  const rows = [
    { amount: 100e6, agency: "Department of Defense", date: "2026-09-01" },
    { amount: 50e6, agency: "NASA", date: "2026-09-02" },
    { amount: 25e6, agency: "Department of Defense", date: "2026-09-03" },
    { amount: -10e6, agency: "NASA", date: "2026-09-04" }, // de-obligation
    { amount: null, agency: "NASA" },
  ];
  const s = summarizeAwards(rows, { annualRevenue: 1e9 });
  assert.equal(s.count, 3);
  assert.equal(s.total, 175e6);
  assert.equal(s.deobligated, -10e6);
  close(s.pctOfRevenue, 0.175);
  assert.deepEqual(s.topAgencies[0], { agency: "Department of Defense", amount: 125e6 });
  assert.equal(s.top[0].amount, 100e6);
  assert.equal(summarizeAwards([], {}).pctOfRevenue, null);
});

test("congressional trades: House index, PTR text parsing and matching", () => {
  const { parseFdIndex, parsePtrText, matchTracked } = require("../lib/congressTrades");

  const index = [
    "Prefix\tLast\tFirst\tSuffix\tFilingType\tStateDst\tYear\tFilingDate\tDocID",
    "Hon.\tWittman\tRobert J.\t\tP\tVA01\t2026\t7/10/2026\t20034916",
    "\tAaron\tRichard\t\tW\tMI04\t2026\t4/15/2026\t8068", // not a PTR
    "Hon.\tYakym\tRudy C.\tIII\tP\tIN02\t2026\t4/6/2026\t8220123", // paper filing
  ].join("\n");
  const filings = parseFdIndex(index, 2026);
  assert.equal(filings.length, 2);
  assert.deepEqual(
    { name: filings[0].name, district: filings[0].district, filingDate: filings[0].filingDate, electronic: filings[0].electronic },
    { name: "Hon. Robert J. Wittman", district: "VA01", filingDate: "2026-07-10", electronic: true },
  );
  assert.equal(filings[0].url, "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20034916.pdf");
  assert.equal(filings[1].name, "Hon. Rudy C. Yakym III");
  assert.equal(filings[1].electronic, false);

  // Text as pdf-parse extracts it from a real PTR (columns run together).
  const text = `IDOwnerAssetTransaction\nType\nCrown Castle Inc. Common Stock\n(CCI) [ST]\nS06/30/202607/02/2026$1,001 - $15,000
    SP Apple Inc. (AAPL) [ST]\nP07/01/202607/03/2026$15,001 - $50,000
    Microsoft Corp (MSFT) [OP]\nS (partial)07/02/202607/05/2026Over $50,000,000
    Treasury Bill (3-Month) [GS] P 07/13/2026 07/13/2026 $15,001 - $50,000`;
  const trades = parsePtrText(text);
  assert.equal(trades.length, 3); // the Treasury bill has no ticker and isn't a stock
  assert.deepEqual(trades[0], { ticker: "CCI", assetType: "stock", type: "Sale", tradeDate: "2026-06-30", notifiedDate: "2026-07-02", amount: "$1,001 - $15,000" });
  assert.equal(trades[1].type, "Purchase");
  assert.equal(trades[2].type, "Partial sale");
  assert.equal(trades[2].assetType, "option");
  assert.equal(trades[2].amount, "Over $50,000,000");

  const matched = matchTracked([{ ...filings[0], trades }], ["aapl", "CCI"]);
  assert.deepEqual(matched.map((t) => t.ticker), ["AAPL", "CCI"]); // newest trade first, MSFT not tracked
  assert.equal(matched[0].member, "Hon. Robert J. Wittman");
});

test("13F: rows for the same security combine before weighting; values are dollars", () => {
  const { aggregateByCusip, computeWeights, qoqChanges } = require("../lib/thirteenF");
  const rows = [
    { nameOfIssuer: "APPLE INC", cusip: "037833100", value: 600, shares: 2 },
    { nameOfIssuer: "APPLE INC", cusip: "037833100", value: 300, shares: 1 }, // second sub-account
    { nameOfIssuer: "APPLE INC", cusip: "037833100", value: 50, shares: 10, putCall: "Put" },
    { nameOfIssuer: "CHEVRON CORP", cusip: "166764100", value: 50, shares: 1 },
  ];
  const agg = aggregateByCusip(rows);
  assert.equal(agg.length, 3);
  assert.deepEqual(agg.find((h) => h.cusip === "037833100" && !h.putCall), { nameOfIssuer: "APPLE INC", cusip: "037833100", value: 900, shares: 3 });
  const w = computeWeights(rows);
  close(w[0].weightPct, 0.9);
  const q = qoqChanges(rows, [{ nameOfIssuer: "APPLE INC", cusip: "037833100", value: 100, shares: 1, putCall: "Put" }]);
  assert.equal(q.find((h) => h.putCall === "Put").isNew, false);
  assert.equal(q.find((h) => h.cusip === "037833100" && !h.putCall).isNew, true, "the put doesn't stand in for the shares");
});

test("options: placeholder chains are flagged instead of producing fake stats", () => {
  const { chainQuality } = require("../lib/options");
  const junk = Array.from({ length: 10 }, (_, i) => ({ strike: 100 + i, openInterest: 0, impliedVolatility: 0.500005, bid: 0, ask: 0 }));
  assert.deepEqual(chainQuality(junk, junk), { hasOI: false, hasQuotes: false, hasIV: false });
  const real = [{ strike: 100, openInterest: 50, impliedVolatility: 0.31, bid: 2, ask: 2.1 }, { strike: 105, openInterest: 0, impliedVolatility: 0.29, bid: 0.5, ask: 0.6 }];
  assert.deepEqual(chainQuality(real, []), { hasOI: true, hasQuotes: true, hasIV: true });
});

test("base rate: share classes dedupe; histogram buckets", () => {
  const { dedupeCompanies, histogram } = require("../lib/baseRate");
  const d = dedupeCompanies([{ symbol: "GOOG", name: "Alphabet Inc." }, { symbol: "GOOGL", name: "Alphabet Inc." }, { symbol: "META", name: "Meta Platforms, Inc." }, { symbol: "NFLX", name: "Netflix, Inc." }], { name: "Meta Platforms, Inc." });
  assert.deepEqual(d.map((x) => x.symbol), ["GOOG", "NFLX"]);
  const h = histogram([-0.9, 0.05, 0.05, 2]);
  assert.equal(h.reduce((s, b) => s + b.n, 0), 4);
  assert.equal(h[0].n, 1);
  assert.equal(h.at(-1).n, 1);
});

test("meeting brief: moves since a date, ranked by impact on the fund", () => {
  const { movesSince } = require("../lib/meetingBrief");
  const h = {
    BIG: [{ date: "2026-09-01", close: 100 }, { date: "2026-09-08", close: 110 }],
    SMALL: [{ date: "2026-09-01", close: 10 }, { date: "2026-09-08", close: 5 }],
  };
  const rows = movesSince(h, [{ symbol: "BIG", shares: 100 }, { symbol: "SMALL", shares: 10 }, { symbol: "NONE", shares: 1 }], "2026-09-01", { BIG: 120 });
  assert.equal(rows[0].symbol, "BIG"); // +$2,000 on a $10,100 book beats SMALL's -$50
  close(rows[0].changePct, 0.2);
  close(rows[0].contributionPct, 2000 / 10100);
  close(rows.find((r) => r.symbol === "SMALL").changePct, -0.5);
  assert.equal(rows.find((r) => r.symbol === "NONE").changePct, null);
});
