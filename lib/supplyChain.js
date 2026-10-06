// Supply-chain map: extract major-customer concentration disclosures (SEC Reg S-K Item
// 101(c)(1)(vii): customers representing >=10% of revenue) from 10-K text with a
// conservative regex over the common disclosure template. Real phrasing varies a lot, so
// this only catches sentences that actually name a customer and a percentage — it won't find
// everything, but it won't guess either.
function extractCustomerMentions(text, minPct = 10) {
  // The customer-name capture forbids ". " followed by a capital letter (a sentence break)
  // so it can't swallow the end of the PRECEDING sentence, while still allowing a trailing
  // abbreviation like "Inc." (its period is followed by a lowercase word, not a new sentence).
  const re = /([A-Z](?:(?!\.\s+[A-Z])[A-Za-z0-9&.,' \-]){1,69}?)\s+(?:accounted for|represented|contributed)\s+(?:approximately\s+)?(\d{1,2}(?:\.\d+)?)\s*%\s+of\s+(?:our\s+|the\s+Company'?s\s+)?(?:total\s+|consolidated\s+)?(?:net\s+)?(?:revenue|sales|net sales)/g;
  const out = [];
  let m;
  while ((m = re.exec(text))) {
    const pct = Number(m[2]);
    if (pct >= minPct) out.push({ customer: m[1].trim(), pct, context: text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40).trim() });
  }
  // Dedupe by name, keeping the highest reported percentage (a filing sometimes repeats the
  // disclosure in both the risk factors and MD&A sections).
  const byName = new Map();
  for (const o of out) {
    const key = o.customer.toLowerCase();
    if (!byName.has(key) || byName.get(key).pct < o.pct) byName.set(key, o);
  }
  return [...byName.values()];
}

// Economic-links lead/lag check (Cohen & Frazzini, "Economic Links and Predictable Returns",
// 2008): the raw gap between a customer's recent return and the supplier's — not a signal by
// itself, just the numbers the research is about.
function economicLinkGap(customerReturn, supplierReturn) {
  if (!Number.isFinite(customerReturn) || !Number.isFinite(supplierReturn)) return null;
  return customerReturn - supplierReturn;
}

module.exports = { extractCustomerMentions, economicLinkGap };
