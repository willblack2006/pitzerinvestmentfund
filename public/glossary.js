// One place for plain-language definitions. term(key) renders the label plus a "?" button
// that opens the definition in a popover (works with keyboard and touch, unlike a title
// tooltip). Definitions state what a number is and how it's computed here; they don't
// promise thresholds the app has no source for.
import { esc } from "./shared.js";

export const GLOSSARY = {
  // Risk & performance
  beta: ["Beta", "How much the stock tends to move when the benchmark moves 1%. 1.0 moves with the market; 1.5 moves about 50% more; below 1 moves less. Measured on two years of daily returns."],
  volatility: ["Volatility", "How much the price bounces around: the standard deviation of daily returns, scaled to a year. Higher means a wider range of likely outcomes."],
  maxDrawdown: ["Max drawdown", "The largest fall from a peak to a later low over the period. A sense of the worst ride an owner would have sat through."],
  sharpe: ["Sharpe ratio", "Return above the risk-free rate divided by volatility: how much return each unit of risk earned. Comparable across investments; higher is better."],
  informationRatio: ["Information ratio", "Return above the benchmark divided by tracking error: how consistently the stock or fund beat its benchmark, not just by how much."],
  trackingError: ["Tracking error", "How far returns wander from the benchmark's (the volatility of the difference). Low means it behaves like the index."],
  correlation: ["Correlation", "From −1 to 1, how closely two return series move together. Lower correlation with what the fund already owns means more diversification."],
  contribution: ["Contribution", "A holding's return times its starting weight, in percentage points: how much it added to or took away from the portfolio's return."],
  twr: ["Time-weighted return", "Return with deposits and withdrawals stripped out, so adding cash doesn't look like performance. The standard way funds report returns."],
  // Markets (Today page)
  vix: ["VIX", "The Cboe Volatility Index: the volatility S&P 500 options prices imply for the next 30 days, as an annual %. It usually rises when stocks fall, so it's often called the market's fear gauge."],
  tenYearYield: ["10-year Treasury yield", "The interest rate the US government pays to borrow for 10 years, set by trading in the bond market. Mortgage and corporate borrowing rates key off it, and higher yields make future company profits worth less today."],
  sectorEtf: ["Sector ETFs", "Funds that hold the S&P 500 companies in one sector (the SPDR \"XL\" funds, e.g. XLK for technology). Their day change shows which parts of the market led or lagged."],
  // Short interest
  daysToCover: ["Days to cover", "Shares sold short ÷ average daily volume: how many days of normal trading it would take short sellers to buy back their shares. Higher means a more crowded short."],
  shortFloat: ["Short % of float", "Shares sold short as a share of the shares available to trade. Reported about twice a month, so it lags."],
  finraShortVolume: ["FINRA short volume", "The share of each day's trading marked \"short\". Most of it is market makers providing liquidity, not bets against the stock, so it's a much weaker signal than short interest."],
  // Factors
  percentile: ["Percentile", "Where a stock ranks within a group, 0 to 100. 75 means it scores higher than three quarters of the group. Here the group is the fund's holdings and watchlist, not the whole market."],
  momentum121: ["12-1 month momentum", "The stock's return from 12 months ago to 1 month ago. The most recent month is skipped because very short-term moves tend to partly reverse."],
  valueFactor: ["Value", "How cheap the stock is: the average percentile of its earnings yield (E/P), free-cash-flow yield and book yield (B/P). Higher = cheaper."],
  qualityFactor: ["Quality", "How profitable and clean the business looks: the average percentile of return on equity, gross profit ÷ assets, Piotroski F-score, and low accruals (earnings backed by cash)."],
  lowVolFactor: ["Low volatility", "How calm the stock is: the average percentile of low 1-year volatility and low beta. Higher = calmer."],
  sizeFactor: ["Size", "Market-cap percentile. Higher = a bigger company. Neither end is \"good\"; historically small companies earned a premium, with long dry spells."],
  // Valuation
  peRatio: ["P/E ratio", "Share price ÷ earnings per share over the last twelve months. Forward P/E uses analysts' estimate of the next twelve months' earnings instead."],
  priceToSales: ["Price/sales", "Market cap ÷ revenue over the last twelve months. Usable when a company has little or no profit."],
  pfcf: ["Price/free cash flow", "Market cap ÷ free cash flow over the last twelve months. The inverse of free-cash-flow yield."],
  priceToBook: ["Price/book", "Market cap ÷ book value (balance-sheet assets minus liabilities). Most meaningful for banks and insurers, whose assets are mostly financial."],
  evRevenue: ["EV/Revenue", "Enterprise value (market cap + debt − cash) ÷ revenue. Like price/sales, but accounts for debt and cash."],
  roe: ["Return on equity (ROE)", "Net income ÷ shareholders' equity: profit per dollar of book capital. Borrowing more raises it without the business getting better."],
  evEbitda: ["EV/EBITDA", "Enterprise value (market cap + debt − cash) ÷ earnings before interest, taxes, depreciation and amortization. Compares companies with different debt levels."],
  fcfYield: ["Free-cash-flow yield", "Free cash flow ÷ market cap: the cash the business generates per dollar of stock, after capital spending."],
  peg: ["PEG ratio", "P/E divided by expected earnings growth (in %). A rough way to compare a high-P/E grower with a low-P/E slow grower."],
  wacc: ["WACC", "Weighted average cost of capital: the blended return lenders and shareholders require. A DCF discounts future cash flows at this rate."],
  terminalGrowth: ["Terminal growth", "The growth rate assumed forever after the forecast years. Small changes move a DCF a lot, so it's usually kept near long-run inflation or GDP growth."],
  reverseDcf: ["Reverse DCF", "Instead of estimating a value, solves for the growth the current price already assumes. Useful for asking \"is that believable?\""],
  piotroski: ["Piotroski F-score", "Nine yes/no tests of profitability, leverage and efficiency (Piotroski, 2000). 0 to 9; higher means improving fundamentals."],
  altmanZ: ["Altman Z-score", "A bankruptcy-risk score from five balance-sheet and income ratios (Altman, 1968). Built for manufacturers; less meaningful for banks and software companies."],
  beneish: ["Beneish M-score", "A model that flags patterns common in companies that manipulated earnings (Beneish, 1999). A screen for questions, not proof of anything."],
  // Street
  priceTarget: ["Price target", "An analyst's estimate of where the stock will trade, usually 12 months out. The mean and median here summarize every analyst covering the stock."],
  consensus: ["Consensus estimate", "The average of analysts' published estimates for a number such as EPS or revenue."],
  epsSurprise: ["Earnings surprise", "Reported EPS vs the analyst consensus just before the report, as a % of the consensus. Positive = beat, negative = miss."],
  revisionScore: ["Estimate revision score", "From −100 (estimates falling) to +100 (estimates rising). Combines revision breadth and EPS-estimate drift for this and next quarter and year, weighted toward the nearer periods."],
  revisionBreadth: ["Revision breadth", "Of the analysts who changed their EPS estimate recently, how many raised vs cut it. Mostly up = improving expectations."],
  epsDrift: ["EPS estimate drift", "How much the average analyst EPS estimate has moved over 30 or 90 days."],
  // Options
  openInterest: ["Open interest", "The number of option contracts outstanding at a strike: positions opened and not yet closed."],
  putCallOI: ["Put/call OI ratio", "Put open interest ÷ call open interest. Above 1 means more puts outstanding than calls (more hedging or bearish positioning), but hedging by long holders makes it noisy."],
  putCallVolume: ["Put/call volume ratio", "Puts traded today ÷ calls traded today. A same-day read on positioning; jumpier than the open-interest ratio."],
  maxPain: ["Max pain", "The strike where option buyers as a group would lose the most money at expiration. A popular theory says prices drift toward it into expiry; the evidence for that is weak."],
  expectedMove: ["Expected move", "How far the options market prices the stock to move, up or down, by this expiration: the cost of the at-the-money call plus put, as a % of the price."],
  ivSkew: ["Skew", "Implied volatility of out-of-the-money puts minus out-of-the-money calls (here, the strikes nearest 10% below and above the price). Usually positive, because downside protection costs more."],
  dealerGamma: ["Dealer gamma", "An estimate of how option dealers' hedging would push the stock at each strike, assuming dealers are long calls and short puts. A model with a stated assumption, not observed data."],
  impliedVol: ["Implied volatility", "The volatility that option prices imply, annualized. The market's priced-in uncertainty."],
  // Filings & ownership
  form4: ["Form 4", "The SEC filing insiders (officers, directors, 10% owners) must make within two business days of trading their company's stock."],
  routineInsider: ["Routine vs opportunistic", "Insiders who trade in the same month year after year are \"routine\" (bonuses, taxes, scheduled plans) and their trades carry little information; everyone else is \"opportunistic\" (Cohen, Malloy & Pomorski, 2012)."],
  form13F: ["13F", "A quarterly SEC filing listing the US stock holdings of managers with over $100M. Due 45 days after quarter end, so it's always stale."],
  form13DG: ["13D / 13G", "Filed when someone crosses 5% ownership of a company. 13D means they may try to influence it (activists); 13G is for passive holders."],
  form8K: ["8-K", "A filing for a material event between quarterly reports: earnings, an auditor change, an executive leaving, a restatement."],
  ptr: ["Periodic Transaction Report", "The form members of Congress file for stock trades, within 45 days, with amounts given only as ranges."],
  filingSimilarity: ["Filing similarity", "How alike two years' versions of a 10-K section are, by word counts (100% = unchanged). Big rewrites have been followed by weaker returns (Cohen, Malloy & Nguyen, \"Lazy Prices\", 2020)."],
  // Calibration & backtests
  brier: ["Brier score", "Average squared gap between the confidence stated and what happened (1 if the target was hit, 0 if not). 0 is perfect; always saying 50% scores 0.25. Needs many calls before it means much."],
  hitRate: ["Hit rate", "Share of graded calls where the base-case target was reached by the stated horizon."],
  tercile: ["Tercile", "One third of a group after ranking. \"Top tercile by momentum\" is the third of names with the strongest momentum."],
  bps: ["Basis points (bps)", "Hundredths of a percent. 20 bps = 0.20%."],
  survivorship: ["Survivorship bias", "Testing only on companies that are still around (or still in the fund) leaves out the ones that failed, which flatters past results."],
};

let n = 0;
// `label` defaults to the glossary's own name for the term.
export function term(key, label) {
  const entry = GLOSSARY[key];
  if (!entry) return esc(label ?? key);
  const [name, def] = entry;
  const id = `term-${key}-${++n}`;
  return `${esc(label ?? name)}<button type="button" class="term-btn" popovertarget="${id}" aria-label="What is ${esc(name)}?">?</button><span popover id="${id}" class="term-pop"><strong>${esc(name)}.</strong> ${esc(def)} <a href="#/glossary">All terms</a></span>`;
}
