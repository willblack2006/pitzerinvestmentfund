// USAspending.gov (no key). Contract transactions (new awards and modifications) whose action
// date falls in the window. Note: Defense Department data posts with a 90-day delay, so
// recent DoD awards are missing until then.
const { cached } = require("../cache");

const CONTRACT_TYPES = ["A", "B", "C", "D"]; // BPA calls, purchase orders, delivery orders, definitive contracts

async function getRecentContracts(searchText, days = 90) {
  return cached(`usaspending_${searchText}_${days}`, 24 * 60 * 60, "usaspending", async () => {
    const end = new Date();
    const start = new Date(end.getTime() - days * 864e5);
    const res = await fetch("https://api.usaspending.gov/api/v2/search/spending_by_transaction/", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        filters: {
          recipient_search_text: [searchText],
          award_type_codes: CONTRACT_TYPES,
          time_period: [{ start_date: start.toISOString().slice(0, 10), end_date: end.toISOString().slice(0, 10) }],
        },
        fields: ["Award ID", "Recipient Name", "Transaction Amount", "Action Date", "Awarding Agency", "Transaction Description", "generated_internal_id"],
        limit: 100,
        sort: "Transaction Amount",
        order: "desc",
      }),
    });
    if (!res.ok) throw new Error(`USAspending request failed: ${res.status}`);
    const json = await res.json();
    return (json.results || []).map((r) => ({
      awardId: r["Award ID"],
      recipient: r["Recipient Name"],
      amount: r["Transaction Amount"],
      date: r["Action Date"],
      agency: r["Awarding Agency"],
      description: r["Transaction Description"] || "",
      url: r.generated_internal_id ? `https://www.usaspending.gov/award/${encodeURIComponent(r.generated_internal_id)}` : null,
    }));
  });
}

module.exports = { getRecentContracts };
