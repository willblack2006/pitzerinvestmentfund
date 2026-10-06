// Index event radar: an approximate S&P 500 eligibility screen (S&P's published criteria,
// which it updates occasionally — the market-cap threshold here is a configurable
// approximation, not pulled from a live source) and Russell reconstitution date math. The
// academic finding that most of the index-inclusion "pop" has shifted to the
// pre-announcement run-up (once the original effect became well known and arbitraged away)
// is a UI note, not something computed here.

function lastWeekday(year, month, dow) {
  const last = new Date(Date.UTC(year, month + 1, 0));
  const diff = (last.getUTCDay() - dow + 7) % 7;
  const day = last.getUTCDate() - diff;
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
// Russell reconstitution is effective the last Friday of June.
const russellReconstitutionDate = (year) => lastWeekday(year, 5, 5);

function sp500EligibilityCheck({ marketCap, trailingQuarterEarnings = [], latestQuarterEarnings, publicFloatPct } = {}, { marketCapThreshold = 20_500_000_000 } = {}) {
  const reasons = [];
  let eligible = true;
  if (!(marketCap >= marketCapThreshold)) {
    eligible = false;
    reasons.push(`Market cap is below the approximate $${(marketCapThreshold / 1e9).toFixed(1)}B threshold.`);
  }
  if (!(latestQuarterEarnings > 0)) {
    eligible = false;
    reasons.push("Latest quarter wasn't GAAP-profitable.");
  }
  const trailingSum = trailingQuarterEarnings.reduce((s, x) => s + (x || 0), 0);
  if (trailingQuarterEarnings.length === 4 && !(trailingSum > 0)) {
    eligible = false;
    reasons.push("The trailing four quarters combined aren't GAAP-profitable.");
  }
  if (publicFloatPct != null && publicFloatPct < 0.5) {
    eligible = false;
    reasons.push("Public float is below 50% of shares outstanding.");
  }
  if (!reasons.length) reasons.push("Passes the market-cap and profitability screens (S&P's committee also weighs sector balance and liquidity, which this doesn't fully replicate).");
  return { eligible, reasons, trailingEarningsSum: trailingSum };
}

module.exports = { lastWeekday, russellReconstitutionDate, sp500EligibilityCheck };
