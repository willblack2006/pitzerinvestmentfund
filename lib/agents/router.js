// The router: plain code rules, no model (research report 8.2). Each event gets a delivery tier
// and, if any, the workflow that should run on it. Tiers for 8-K items follow Lerman & Livnat's
// measured price reactions (report section 6): push = tell members now, inbox = notify,
// digest = list it on the Agents page only, ignore = record and drop.

const ITEM_TIER = {
  "1.03": "push",   // bankruptcy
  "3.01": "push",   // delisting notice
  "2.06": "push",   // material impairment
  "4.02": "push",   // non-reliance on prior financials
  "2.04": "push",   // acceleration of an obligation
  "5.01": "push",   // change in control
  "1.05": "push",   // cybersecurity incident (post-2023; not in the study, treated as push)
  "2.05": "inbox",  // exit or disposal costs
  "4.01": "inbox",  // auditor change
  "5.02": "inbox",  // officer or director change
  "1.01": "inbox",  // material agreement
  "1.02": "inbox",  // termination of a material agreement
  "2.01": "inbox",  // acquisition or disposal of assets
  "2.03": "inbox",  // new material obligation
  "3.02": "inbox",  // unregistered equity sale
  "3.03": "inbox",  // change to holders' rights
  "2.02": "inbox",  // results: the earnings workflow
  "7.01": "digest", "8.01": "digest", "5.07": "digest", "5.03": "digest", "5.05": "digest", "5.08": "digest",
  "9.01": "ignore", // exhibits only
};
const RANK = { ignore: 0, digest: 1, inbox: 2, push: 3 };
const maxTier = (a, b) => (RANK[a] >= RANK[b] ? a : b);

const parseItems = (items) => String(items || "").split(/[,\s]+/).map((s) => s.trim()).filter((s) => /^\d\.\d\d$/.test(s));

// Returns { tier, workflow, reason }. `event` has { type, items, symbol, payload }.
function classify(event) {
  const type = String(event.type || "").toUpperCase();
  if (type === "8-K" || type === "8-K/A") {
    const items = parseItems(event.items).filter((i) => i !== "9.01");
    if (!items.length) return { tier: "digest", workflow: null, reason: "8-K with no item codes beyond exhibits" };
    let tier = items.map((i) => ITEM_TIER[i] || "digest").reduce(maxTier, "ignore");
    // Reactions grow with the number of items in one filing: three or more substantive items
    // move an inbox filing up to push.
    if (tier === "inbox" && items.filter((i) => RANK[ITEM_TIER[i] || "digest"] >= RANK.inbox).length >= 3) tier = "push";
    const workflow = items.includes("2.02") ? "earnings_flash" : RANK[tier] >= RANK.inbox ? "filing_flash" : null;
    return { tier, workflow, reason: `8-K items ${items.join(", ")}` };
  }
  if (type === "10-Q" || type === "10-K") return { tier: "inbox", workflow: "filing_flash", reason: `New ${type}` };
  if (type === "10-Q/A" || type === "10-K/A") return { tier: "digest", workflow: null, reason: `Amended ${type.slice(0, 4)}` };
  if (type === "PITCH_SUBMITTED") return { tier: "inbox", workflow: "red_team", reason: "Pitch opened for a vote" };
  return { tier: "digest", workflow: null, reason: "No rule for this event type" };
}

module.exports = { classify, parseItems, ITEM_TIER };
