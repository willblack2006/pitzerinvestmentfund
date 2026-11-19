// Decides how much machinery an Ask PIF question needs, with plain rules and no model call:
//   - tier: simple one-company lookups go to the cheap model; anything analytical, comparative or
//     portfolio-wide goes to the mid model.
//   - tools: only the tool groups the wording points at (plus a small core), instead of all ~68
//     definitions on every step. Unclear questions get everything.
//   - effort / maxSteps: lookups get fewer steps.
// The cheap path is checked: ask.js escalates to mid with every tool if the answer fails the
// number check or the cheap run errors.
const CORE = ["get_research_overview", "get_holdings", "get_allocation", "get_watchlist", "get_recent_filings", "get_alerts", "web_search"];

const GROUPS = {
  filings: { re: /\b(filings?|10-?k|10-?q|8-?k|risk factors?|md&a|guidance|disclos\w*|annual report|quarterly report|restat\w*|going concern|auditor|material weakness|activist|13d|transcript|earnings call|call)\b/i,
    tools: ["get_filing_text", "get_filing_changes", "get_red_flags", "get_activist_filings", "get_earnings_call"] },
  valuation: { re: /\b(valuation|valued|dcf|fair value|worth|multiples?|p\/?e|ev\/?\w+|peg|comps?|peers?|industry|sector|cheap|expensive|overvalued|undervalued|price target|targets?|upside|downside)\b/i,
    tools: ["get_comps", "get_dcf", "get_industry_comparison", "get_financials", "get_estimate_revisions", "get_base_rate", "get_estimate_revisions_all"] },
  financials: { re: /\b(revenue|sales|margins?|earnings|eps|cash ?flow|fcf|debt|leverage|balance sheet|income|growth|profit\w*|financials?|capex|guidance|dividends?|payout|buybacks?)\b/i,
    tools: ["get_financials", "get_estimate_revisions", "get_earnings_call", "get_earnings_calendar", "get_dividends", "get_comps"] },
  risk: { re: /\b(risk\w*|volatil\w*|beta|drawdowns?|returns?|momentum|52[- ]?week|moving average|sma|technical|chart|trend|liquid\w*|options?|puts?|calls?|implied|factor|quality|piotroski|altman|beneish|sharpe|backtest\w*)\b/i,
    tools: ["get_risk", "get_price_history", "get_factor_scores", "get_liquidity", "get_options", "get_momentum_backtest", "get_base_rate", "get_factors_all", "get_performance"] },
  ownership: { re: /\b(insiders?|form 4|short\w*|squeeze|13f|institution\w*|hedge funds?|ownership|owners?|congress|senat\w*|representatives?|smart money|crowd\w*|index|forced|buyers?|sellers?)\b/i,
    tools: ["get_insider_activity", "get_insider_signal", "get_insiders_all", "get_insider_signals_all", "get_short_pressure", "get_short_pressure_all", "get_13f_breadth", "get_13f_breadth_all", "get_13f_manager", "search_13f_managers", "get_13f_season", "get_congress_trades", "get_congress_trades_all", "get_forced_sellers", "get_index_radar", "get_liquidity"] },
  macro: { re: /\b(macro\w*|rates?|fed|inflation|cpi|gdp|yield curve|treasur\w*|unemployment|recession|fred|lobby\w*|fda|federal register|regulat\w*|rulemaking|contracts?|government|supply chain|suppliers?|customers?)\b/i,
    tools: ["get_macro", "get_macro_detail", "get_lobbying", "get_fda_activity", "search_federal_register", "get_gov_contracts", "get_gov_contracts_all", "get_supply_chain", "get_market_news"] },
  fund: { re: /\b(pitch\w*|vote|voting|thesis|trades?|transactions?|fund|club|policy|limits?|meeting|notes?|performance|track record|paper|season|calendar|attention|screen|ideas?|signals?|portfolio|holdings?|positions?|weights?)\b/i,
    tools: ["get_pitches", "get_pitch", "get_fund_view", "get_transactions", "get_fund_policy", "get_meeting_brief", "get_my_notes", "get_performance", "get_track_record", "get_paper_trading", "get_calendar", "get_signals", "get_attention", "get_attention_all", "get_idea_screen", "get_earnings_calendar", "get_dividends"] },
  quote: { re: /\b(price|quote|market cap|trading|stock|shares?|ticker)\b/i, tools: [] },
  news: { re: /\b(news|headlines?|why (is|did|are)|today|this week|moving|moved|catalyst\w*|rumou?rs?|announce\w*|latest|recent)\b/i,
    tools: ["get_news", "get_market_news", "get_signals", "get_attention"] },
};

// Words that mean a question needs real analysis, not a lookup.
const COMPLEX = /\b(compare|versus|vs\.?|why|should|bull|bear|thesis|valuation|dcf|risks?|rank|best|worst|which of|across|every|all (of )?(the )?(holdings|positions|stocks)|explain|analy[sz]e|assess|evaluate|what if|scenario|summar\w*|pros|cons|catalyst\w*|trend|outlook|implications?|how (does|do|would|might)|diversif\w*|exposure|concentrat\w*)\b/i;
// "$NVDA", "NVDA", "BRK.B": upper-case words of 1-5 letters that aren't ordinary words.
const NOT_TICKERS = new Set(["I", "A", "AI", "US", "USA", "EPS", "PE", "PEG", "DCF", "CEO", "CFO", "FCF", "ETF", "IPO", "SEC", "FDA", "FED", "GDP", "CPI", "TTM", "YOY", "QOQ", "ROE", "ROIC", "ROA", "PIF", "WHAT", "WHO", "HOW", "WHY", "THE", "AND", "FOR", "ARE", "IS", "DID", "DOES", "ALL", "ANY", "CAN", "YTD", "EV", "EBIT", "EBITDA", "OK", "IT", "OR", "BUY", "SELL", "HOLD", "NEW", "TOP", "LOW", "HIGH"]);
function mentionedTickers(q) {
  const out = new Set();
  for (const m of String(q).matchAll(/\$?\b([A-Z]{1,5}(?:\.[A-Z])?)\b/g)) if (!NOT_TICKERS.has(m[1]) && (m[0].startsWith("$") || m[1].length >= 2 || /\b[A-Z]\b/.test(m[1]))) out.add(m[1]);
  return [...out];
}

function plan(question, allTools) {
  const q = String(question || "").trim();
  const hits = Object.entries(GROUPS).filter(([, g]) => g.re.test(q)).map(([k]) => k);
  const tickers = mentionedTickers(q);
  const complex = COMPLEX.test(q) || q.length > 160 || tickers.length > 1 || hits.length >= 4;
  const known = new Set(allTools);
  // No group matched, or the question is broad: don't guess, give the model everything.
  const subset = hits.length === 0 || hits.length >= 4
    ? null
    : [...new Set([...CORE, ...hits.flatMap((h) => GROUPS[h].tools)])].filter((t) => known.has(t));
  return {
    tier: complex ? "mid" : "cheap",
    effort: "low",
    maxSteps: complex ? 8 : 5,
    tools: subset || allTools,
    groups: hits,
    narrowed: !!subset,
    tickers,
  };
}

module.exports = { plan, mentionedTickers, GROUPS, CORE };
