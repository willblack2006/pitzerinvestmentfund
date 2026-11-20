// The fund's recorded value (daily snapshots + ledger), not the "today's holdings" reconstruction.
import { lineChart } from "../viz/line.js";
import { fmt } from "../viz/core.js";

export default {
  key: "nav-ledger", title: "Recorded fund value", size: "m", defaultOn: false,
  description: "The fund's actual daily value from snapshots and the transaction ledger.",
  render(body, ctx) {
    const nav = ctx.data.nav || [];
    if (nav.length < 2) { body.innerHTML = ctx.empty("Building history", `${nav.length} snapshot${nav.length === 1 ? "" : "s"} so far. The server records one each weekday after the close.`); return; }
    const twr = ctx.data.navTwr;
    lineChart(body, {
      dates: nav.map((n) => n.date), label: `Recorded fund value from ${fmt.date(nav[0].date)} (${fmt.usd(nav[0].value)}) to ${fmt.date(nav.at(-1).date)} (${fmt.usd(nav.at(-1).value)}).`,
      height: 220, series: [{ label: "Fund value", values: nav.map((n) => n.value), color: "var(--viz-s1)", area: true }],
      yFormat: (v) => fmt.usdc(v), tipFormat: (v) => fmt.usd(v), events: ctx.data.events,
    });
    if (twr) ctx.foot(`Time-weighted return since ${fmt.date(twr[0].date)}: ${fmt.spct(twr.at(-1).index / 100 - 1, 2)}${Number.isFinite(twr.at(-1).bench) ? ` vs ${ctx.data.benchmark} ${fmt.spct(twr.at(-1).bench / 100 - 1, 2)}` : ""}. Gaps are days without a snapshot.`);
  },
};
