import { pairedBars } from "../viz/bars.js";

export default {
  key: "caps", title: "Company size", size: "s", defaultOn: false,
  description: "How much of the fund sits in mega, large, mid and small companies.",
  async render(body, ctx) {
    const x = await ctx.get("/api/cockpit/exposures");
    const rows = (x?.caps || []).filter((c) => c.weight > 0);
    if (!rows.length) { body.innerHTML = ctx.empty("No size data", "Market caps come from Yahoo."); return; }
    pairedBars(body, rows.map((c) => ({ label: c.label.replace(/ \(.*\)/, ""), a: c.weight * 100, b: null })), { label: "Fund weight by company size", aName: "Fund", bName: "", format: (v) => `${Number(v).toFixed(1)}%` });
    ctx.foot("Mega over $200B, large $10B to $200B, mid $2B to $10B, small $300M to $2B.");
  },
};
