// Forced-seller opportunities: mechanical selling pressure unrelated to fundamentals —
// presented as a watchlist feed, never as a recommendation.

// December tax-loss-selling candidate: down sharply year-to-date, screened only in
// November/December (when tax-loss selling actually happens) since the same drawdown in
// June means something different. The "January effect" rebound in such names afterward is a
// long-documented seasonal pattern, not a guarantee.
function isTaxLossCandidate({ ytdReturnPct, asOfMonth }, threshold = -20) {
  if (!Number.isFinite(ytdReturnPct)) return false;
  return (asOfMonth === 11 || asOfMonth === 12) && ytdReturnPct <= threshold;
}

// A loose proxy for "this holding recently completed a spin-off": an 8-K Item 2.01
// (completion of a disposition of assets) whose description mentions a spin-off. Spin-offs
// create mechanical selling in the new shares as index funds and mismatched-mandate holders
// dump a security they weren't built to hold.
function looksLikeSpinoff(filing) {
  return /\b2\.01\b/.test(filing.items || "") && /spin[- ]?off/i.test(filing.description || "");
}

module.exports = { isTaxLossCandidate, looksLikeSpinoff };
