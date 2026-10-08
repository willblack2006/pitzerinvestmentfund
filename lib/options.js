// Options positioning: pure math over a parsed options chain ({ strike, openInterest, volume,
// impliedVolatility, bid, ask }[] for calls and puts separately). Context for a trade, not a
// forecast. Assumes a 0% risk-free rate throughout (negligible for near-dated equity options)
// and, for dealer gamma, the stated convention that dealers are net long calls / short puts.

function normalPdf(x) { return Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI); }

// Abramowitz & Stegun 7.1.26 approximation of the standard normal CDF (good to ~1e-7).
function normalCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (x > 0) p = 1 - p;
  return p;
}

function d1(S, K, T, sigma, r = 0) {
  if (!(S > 0 && K > 0 && T > 0 && sigma > 0)) return null;
  return (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / (sigma * Math.sqrt(T));
}

function bsGamma(S, K, T, sigma, r = 0) {
  const x = d1(S, K, T, sigma, r);
  return x === null ? null : normalPdf(x) / (S * sigma * Math.sqrt(T));
}

function bsDelta(S, K, T, sigma, r = 0, type = "call") {
  const x = d1(S, K, T, sigma, r);
  if (x === null) return null;
  return type === "call" ? normalCdf(x) : normalCdf(x) - 1;
}

function putCallRatio(calls, puts) {
  const sum = (rows, key) => rows.reduce((s, r) => s + (r[key] || 0), 0);
  const callVol = sum(calls, "volume"), putVol = sum(puts, "volume");
  const callOI = sum(calls, "openInterest"), putOI = sum(puts, "openInterest");
  return {
    volumeRatio: callVol > 0 ? putVol / callVol : null,
    oiRatio: callOI > 0 ? putOI / callOI : null,
    callVol, putVol, callOI, putOI,
  };
}

// The strike at which option HOLDERS collectively lose the most money at expiration (so
// "max pain" for holders, often cited as a magnet for the underlying into expiration —
// contested in the literature, shown as context only).
function maxPain(calls, puts) {
  const strikes = [...new Set([...calls.map((c) => c.strike), ...puts.map((p) => p.strike)])].sort((a, b) => a - b);
  if (!strikes.length) return null;
  let best = null, bestPain = Infinity;
  for (const S of strikes) {
    let pain = 0;
    for (const c of calls) if (S > c.strike) pain += (S - c.strike) * (c.openInterest || 0);
    for (const p of puts) if (S < p.strike) pain += (p.strike - S) * (p.openInterest || 0);
    if (pain < bestPain) { bestPain = pain; best = S; }
  }
  return best;
}

// At-the-money straddle cost as a fraction of spot — the options market's own forecast of
// the move by expiration (commonly used ahead of earnings).
function expectedMove(callMid, putMid, spot) {
  if (!(spot > 0) || !Number.isFinite(callMid) || !Number.isFinite(putMid)) return null;
  return (callMid + putMid) / spot;
}

// A 25-delta-style skew approximation using moneyness as a stand-in for true delta (Yahoo's
// free chain gives implied vol per contract, not delta): compares the IV of the ~10%-OTM put
// to the ~10%-OTM call. Positive skew (put IV > call IV) is the normal "smirk" — downside
// protection costs more; it's a market feature, not a bearish signal by itself.
function ivSkew(calls, puts, spot) {
  if (!(spot > 0)) return null;
  const nearest = (rows, targetStrike) => rows.reduce((best, r) => (
    !best || Math.abs(r.strike - targetStrike) < Math.abs(best.strike - targetStrike) ? r : best
  ), null);
  const otmPut = nearest(puts, spot * 0.9);
  const otmCall = nearest(calls, spot * 1.1);
  if (!otmPut?.impliedVolatility || !otmCall?.impliedVolatility) return null;
  return { putIV: otmPut.impliedVolatility, callIV: otmCall.impliedVolatility, skew: otmPut.impliedVolatility - otmCall.impliedVolatility };
}

// Net dealer gamma exposure by strike, in $ per 1% move of the underlying (a common
// normalization): assumes dealers are long calls and short puts (a simplifying convention,
// not a fact about any specific dealer's actual book).
function dealerGammaByStrike(calls, puts, spot, yearsToExpiry) {
  const byStrike = new Map();
  const add = (rows, sign) => {
    for (const r of rows) {
      if (!r.impliedVolatility || !(r.openInterest > 0)) continue;
      const g = bsGamma(spot, r.strike, yearsToExpiry, r.impliedVolatility);
      if (g === null) continue;
      const exposure = sign * g * r.openInterest * 100 * spot * spot * 0.01; // $ per 1% move
      byStrike.set(r.strike, (byStrike.get(r.strike) || 0) + exposure);
    }
  };
  add(calls, 1);
  add(puts, -1);
  return [...byStrike.entries()].map(([strike, gammaExposure]) => ({ strike, gammaExposure })).sort((a, b) => a.strike - b.strike);
}

// Yahoo sometimes serves a chain with every open interest at 0 and every implied vol at a
// 0.5 placeholder (seen after hours). Stats built on those look precise and mean nothing, so
// flag what's actually usable.
function chainQuality(calls, puts) {
  const all = [...calls, ...puts];
  const ivs = all.map((r) => r.impliedVolatility).filter((v) => Number.isFinite(v) && v > 0);
  const placeholder = ivs.filter((v) => Math.abs(v - 0.5) < 1e-3).length;
  return {
    hasOI: all.some((r) => r.openInterest > 0),
    hasQuotes: all.some((r) => r.bid > 0 && r.ask > 0),
    hasIV: ivs.length > 0 && placeholder / ivs.length < 0.8,
  };
}

module.exports = { chainQuality, normalPdf, normalCdf, d1, bsGamma, bsDelta, putCallRatio, maxPain, expectedMove, ivSkew, dealerGammaByStrike };
