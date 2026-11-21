// Cockpit widget registry. APPEND-ONLY: add one line per widget at the end (other workstreams
// add theirs here too). Each module's default export is
//   { key, title, description, size: "s" | "m" | "l" | "full", defaultOn: boolean,
//     render(body, ctx) }   (ctx is described in public/views/cockpit.js)
// A widget that fails to load or render shows an error in its own card only.
export const WIDGETS = [
  { key: "explain", load: () => import("./explain.js") },
  { key: "treemap", load: () => import("./treemap.js") },
  { key: "value", load: () => import("./value.js") },
  { key: "waterfall", load: () => import("./waterfall.js") },
  { key: "calendar", load: () => import("./calendar.js") },
  { key: "sectors", load: () => import("./sectors.js") },
  { key: "risk-scatter", load: () => import("./riskScatter.js") },
  { key: "movers", load: () => import("./movers.js") },
  { key: "ips", load: () => import("./ips.js") },
  { key: "monthly", load: () => import("./monthly.js") },
  { key: "attribution", load: () => import("./attribution.js") },
  { key: "caps", load: () => import("./caps.js") },
  { key: "factors", load: () => import("./factors.js") },
  { key: "nav-ledger", load: () => import("./navLedger.js") },
  { key: "signal-matrix", load: () => import("./signalMatrixMini.js") }, // WS10
  { key: "vol-movers", load: () => import("./volMovers.js") }, // WS10
];
