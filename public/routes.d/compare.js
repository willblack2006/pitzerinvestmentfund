// WS10: 2 to 5 tickers side by side.
export default { pattern: "compare/:symbols?", load: () => import("../views/compare.js"), section: "research" };
