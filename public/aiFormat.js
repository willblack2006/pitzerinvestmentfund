// Pure helpers for the AI features (no DOM, unit-tested in test/aiUx.test.js): plain-English
// names for agent tools and sources, progress lines from a run's steps, suggested questions.

// ---- Plain-English names for agent tools and sources ----

const TOOL_LABEL = {
  get_holdings: "the fund's holdings", get_allocation: "allocation and policy limits", get_research_overview: "the company overview",
  get_recent_filings: "recent SEC filings", get_filing_text: "a filing's text", get_red_flags: "red flags in filings", get_risk: "risk statistics",
  get_comps: "the peer comparison", get_insider_activity: "insider trades", get_short_pressure: "short interest", get_13f_breadth: "13F institutional buying",
  get_congress_trades: "Congress trades", get_estimate_revisions: "analyst estimate revisions", get_base_rate: "the base rate", get_pitches: "the fund's pitches",
  get_pitch: "a pitch", get_performance: "fund performance", get_macro: "macro data", get_earnings_calendar: "the earnings calendar",
  get_insiders_all: "insider trades across holdings", get_short_pressure_all: "short interest across holdings", get_13f_breadth_all: "13F buying across holdings",
  get_congress_trades_all: "Congress trades across holdings", get_gov_contracts_all: "federal contracts", get_alerts: "the fund's alerts",
};
export function toolLabel(name, args = {}) {
  const base = TOOL_LABEL[name] || String(name || "").replace(/^get_/, "").replace(/_/g, " ");
  return args?.symbol ? `${base} for ${String(args.symbol).toUpperCase()}` : base;
}

const PAGE_LABEL = { holdings: "Holdings", allocation: "Allocation", pitches: "Pitches", performance: "Performance", macro: "Macro", calendar: "Calendar",
  insiders: "Insiders", "short-interest": "Short interest", "13f": "13F", congress: "Congress trades", alerts: "Alerts", research: "Research" };
const TAB_LABEL = { filings: "Filings", ownership: "Ownership", risk: "Risk", valuation: "Valuation", street: "Street", financials: "Financials", thesis: "Thesis", options: "Options", notes: "Notes" };
// "#/research/NVDA/ownership" → "NVDA · Ownership"; sec.gov → "SEC filing".
export function sourceLabel(u) {
  const s = String(u || "");
  if (s.startsWith("#/")) {
    const [a, b, c] = s.slice(2).split("/");
    if (a === "research" && b) return `${decodeURIComponent(b)} · ${TAB_LABEL[c] || "Research"}`;
    if (a === "pitches" && b) return `Pitch #${b}`;
    return PAGE_LABEL[a] || a;
  }
  try {
    const host = new URL(s).hostname.replace(/^www\./, "");
    return host === "sec.gov" || host.endsWith(".sec.gov") ? "SEC filing" : host;
  } catch { return "source"; }
}

// Steps recorded so far → short lines a member can follow. The run's own steps come from
// GET /api/agents/runs-live, which the page polls while it waits on the POST.
export function progressLines(steps = []) {
  const lines = [];
  for (const s of steps) {
    if (s.kind === "tool") lines.push({ done: true, bad: s.ok === false, text: `${s.ok === false ? "Couldn't read" : "Read"} ${toolLabel(s.name, s.args)}` });
    else if (s.kind === "source") lines.push({ done: true, text: "Read the filing" });
    else if (s.kind === "model" && !s.toolCalls?.length) lines.push({ done: true, text: "Drafted the answer" });
  }
  return lines;
}

// ---- Suggested questions for where the member is ----

export const routeSymbol = (hash) => {
  const m = String(hash || "").match(/^#\/(?:research|pitches\/new)\/([A-Za-z0-9.\-^=]{1,12})/);
  return m ? decodeURIComponent(m[1]).toUpperCase() : null;
};

// `symbol` undefined = take it from the route; null = none (fund-wide questions).
export function suggestedQuestions({ symbol, hash = "" } = {}) {
  if (symbol === undefined) symbol = routeSymbol(hash);
  if (symbol) return [
    `What changed in ${symbol}'s latest filing?`,
    `What are insiders doing in ${symbol}?`,
    `How is ${symbol} valued against its peers?`,
    `What are the biggest risks for ${symbol} right now?`,
  ];
  const h = String(hash || "");
  if (/^#\/(today|calendar|macro)/.test(h)) return [
    "Which holdings report earnings in the next two weeks?",
    "What does the macro data say about rates right now?",
    "Which holdings have new red flags in their filings?",
  ];
  return [
    "Which holdings have the most insider selling this quarter?",
    "Are we breaking any allocation limits?",
    "Which holdings report earnings in the next two weeks?",
    "How has the fund done against its benchmark this year?",
  ];
}
