# Turn PIF's free data into cited agents

PIF does not need a Bloomberg seat to get most of what professional firms use. The pro terminals sell five things the fund can copy with data it already pulls for free: typed event feeds (8-K item codes, Form 4, 13F), alerts on screen entry and exit, an annotated price chart, portfolio attribution and risk views, and AI that cites every claim and shows the query behind it. The things PIF cannot copy are broker research, Visible Alpha's KPI consensus, licensed news, expert-call libraries and alternative data. The biggest gaps in the current app are a whole-market screener, earnings-call transcripts, factor exposures from regressions (the scorecard today is percentile ranks), volatility-scaled alerts and an AI layer that can answer questions over the fund's own data. The AI section is the core of this report: build most of the "agents" as plain code workflows triggered by events, give the model a narrow tool layer over the existing `lib/` code, let code do every calculation, verify every quote against the source text before it is shown, and keep members as the only ones who can change anything. On official list prices from November 13, 2026, the cheap model tier (gpt-6-luna, which the app already uses, or Claude Haiku 5.5) costs $0.10 per million input tokens, so triage and short briefs cost fractions of a cent; the real cost risks are long-context deep research and multi-agent fan-out, which uses about 15 times the tokens of a chat. Before any of that, the report lists code problems the research found (FCF that treats missing capex as zero, dropped 10-Q cash-flow quarters, debt tags picked instead of summed, and others) that affect numbers members already see.

## Contents

1. How to read this report
2. Pro terminals sell typed events, cited AI and screens, and PIF can copy most of it
3. Valuation formulas: what to add, what to fix, how to draw each one
4. Signals: published effects shrink after publication, so show them with caveats
5. Problems found in the existing code
6. Daily tracking for 39 holdings: tier every alert and scale moves by each stock's own volatility
7. PIF's own metrics: grade the process, not only the returns
8. The agentic system: events, a code router, narrow tools and verified citations
9. Roadmap
10. Decisions only the fund can make
11. Conclusion
12. Sources

## 1. How to read this report

Status labels follow Will's feature list for the current app. **HAVE** means the app already does it. **IMPROVE** means the app does part of it, or does it with a known flaw. **NEW** means it is not in the app. A short check of `lib/` turned up two modules the brief did not list: `lib/supplyChain.js` (extracts 10%-customer disclosures from 10-K text) and `lib/newsTriage.js` (AI headline triage), so those count as HAVE.

Prices carry their source type. **Official** means the vendor's own page; **third-party** means a review site, blog or press report. All prices were gathered on or before November 13, 2026, and the date is given where the source gave one. Anything the research could not confirm is marked unverified. Metrics PIF would invent are labeled **PIF's own metric (not an industry standard)**. Thresholds that no source sets (for example a 2-sigma alert cutoff) are labeled design choices.

## 2. Pro terminals sell typed events, cited AI and screens, and PIF can copy most of it

### What analysts actually open on Bloomberg, Capital IQ and FactSet

No vendor publishes usage rankings, so the "most used" set comes from overlapping university library guides. NYU Stern's guide (updated August 31, 2026) lists ANR (analyst recommendations), BETA, EQS (equity screener), GP (price chart), PEOP, PIB (one-PDF bundle of a company's public documents), PORT (portfolio tracking), SPLC (supply chain), WACC and KI (AI-flagged key news) among its frequently used commands ([NYU guide](https://guides.nyu.edu/bloombergguide/popular-commands)). An older Delaware list adds DES, FA, EE/ERN, RV (relative valuation), HDS (holders), CN, ALRT (price alerts) and OMON (options), but it dates from 2018 ([UDel Lerner](https://lerner.udel.edu/seeing-opportunity/bloomberg-functions-list/)). PIF already covers most of these with free data: company overview, five years of SEC financials, Street consensus, peer comps, ownership and options. The real gaps are broker research, people search and KPI-level consensus.

Capital IQ's distinctive pieces are its typed event stream and its alert taxonomy. **Key Developments** sorts news into 125 development types from over 2,000 sources per S&P's brochure, or over 160 types per the WRDS description, filterable by type, industry and date ([S&P brochure](https://www.spglobal.com/content/dam/spglobal/mi/en/documents/general/S-P-Capital-IQ-Platform-Brochure.pdf); [WRDS](https://wrds-www.wharton.upenn.edu/pages/grid-items/introduction-capital-iq)). Its screening combines company, people, key-development and transaction criteria, it puts an **Annotated Stock Chart** that lines up price moves with news and corporate actions on every company page, and it can alert when a company **enters or leaves a saved screen** ([CBS user guide 2025](https://www.cbs.dk/sites/default/files/2025-11/sp_capital_iq_-_user_guide.pdf)). In October 2025 S&P added Earnings IQ Alerts (instant metrics and summaries when results drop), Natural Language Screening, Document Intelligence 2.0 with citations, and Multi-Document ChatIQ ([S&P press release, Oct 22, 2025](https://press.spglobal.com/2025-10-22-S-P-Global-Redefines-Financial-Insights-with-New-AI-Powered-Multi-Document-Research-and-Analysis-Tool-in-Capital-IQ-Pro-ChatIQ)). Most of Key Developments that matters to a long-only fund comes from filings, and the 8-K item codes PIF can read from EDGAR's submissions JSON map onto many of those types.

FactSet's StreetAccount delivers news summaries by email in real time or batched every couple of hours, with overnight, end-of-day and keyword alerts ([StreetAccount brochure](https://go.factset.com/hubfs/Website/Resources%20Section/Brochures/streetaccount-brochure.pdf); [StreetAccount help PDF](https://www.streetaccount.com/helpdocs/factset_streetaccount_web.pdf)). FactSet launched a public MCP server on September 25, 2026 so outside AI agents can reach its data ([The AI Innovator](https://theaiinnovator.com/inside-factsets-push-to-build-an-agentic-future/)), and in June 2026 announced a Google Cloud partnership that embeds Gemini models in Workstation ([Google Cloud press corner](https://www.googlecloudpresscorner.com/2026-06-30-FactSet-Announces-Strategic-Partnership-with-Google-Cloud-to-Bring-Advanced-AI-to-Financial-Intelligence)).

Visible Alpha is the one product PIF cannot approximate. It carries consensus on over 1 million line items (an average of 156 per company) across more than 7,300 companies, built from broker models, with click-through to the source model ([S&P press release, Mar 25, 2025](https://press.spglobal.com/2025-03-25-S-P-Global-Market-Intelligence-Launches-Visible-Alpha-on-S-P-Capital-IQ-Pro-Platform)); by October 2025 it had over 260 model contributors ([S&P Global](https://www.spglobal.com/market-intelligence/en/news-insights/research/2025/10/nomura-securities-is-now-available-in-s-and-p-globals-visible-alpha-models-consensus)). PIF's substitute is reported KPI history from filings plus a "club consensus" where members log their own KPI forecasts.

On the portfolio side, Bloomberg PORT sells customizable attribution, multifactor risk models, four kinds of scenario analysis (factor, full valuation, macro, climate), optimization, and **AI Portfolio Commentary** that writes summaries from attribution output ([Bloomberg PORT](https://professional.bloomberg.com/products/bloomberg-terminal/portfolio-analytics)). FactSet describes risk-based attribution that splits excess return into factor and stock-specific effects ([FactSet Insight](https://insight.factset.com/demonstrating-the-benefits-of-active-managements-part-one)). PIF has contribution, beta, Sharpe and drawdown, but no Brinson attribution, no ex-ante tracking error, no VaR and no scenario replay.

### The AI pattern every vendor converged on

Bloomberg's ASKB went to beta on February 23, 2026 as a network of agents working in parallel over Bloomberg data. Every answer carries source attribution, and when an answer involves data analysis it **hands back the BQL query** so the user can rerun it; "ASKB Workflows" save and share templates for pre-earnings prep, post-earnings review and meeting prep ([Traders Magazine](https://www.tradersmagazine.com/xtra/bloomberg-introduces-agentic-ai-to-the-terminal/)). Bloomberg's CTO said ASKB routes each query to the cheapest model that meets the workflow's reliability bar and is evaluated per sub-agent by domain specialists, with LLM judges for easy cases and humans for the rest ([Fortune, Apr 28, 2026](https://fortune.com/2026/04/28/bloomberg-askb-ai-agents-lessons-from-bloomberg-cto-shawn-edwards-eye-on-ai/)). At general availability on October 15, 2026, ASKB added questions over a client's own chats (three months, cited to the source chat), watchlists and stored files ([PR Newswire, Oct 15, 2026](https://www.prnewswire.com/news-releases/the-next-evolution-of-askb-your-insights-bloombergs-intelligence-one-conversation-302909392.html)). That last feature is the closest one-to-one copy for PIF: an agent over club chat, notes, pitches and IC votes is unique to the fund.

The shared design is: cite every claim, show the query, save reusable workflows, answer over the firm's own content, compare many documents at once, route to cheap models where possible, and evaluate each sub-agent. Section 8 builds PIF's system on exactly those rules.

### Research apps: what to copy from each

**Koyfin**'s official plan grid (fetched November 13, 2026) lists Free at $0, Plus $39, Premium $79, Advisor Core $209 and Advisor Pro $299 per month, with annual plans saving up to 30% ([Koyfin plans](https://www.koyfin.com/pricing/plans-comparison/)). The copyable parts from its release notes are watchlist columns for insider activity and estimate surprises, a **Check Ticker** view that shows which saved screen rules a stock passes or fails, Brinson attribution, one-pager and comparison PDFs, document alerts, and **Compare Matrix**, an LLM grid that answers questions across transcripts and filings ([Koyfin release notes](https://www.koyfin.com/help/topic/release-notes/)).

**YCharts** is contact-sales with no public prices; its useful ideas are a **Scatter Plot** with point-in-time or timeseries modes and **Scoring Models** where users set metric weights and null handling ([YCharts plans](https://get.ycharts.com/plans); [Scatter Plot KB](https://go.ycharts.com/knowledge-base/scatter-plot-overview); [Scoring Models KB](https://go.ycharts.com/knowledge-base/scoring-models-overview)). PIF's factor scorecard has fixed weights; user-editable weights backtested in the existing backtester would be the new part.

**Morningstar**'s star rating is mechanical once you have a fair value and an uncertainty level, and the bands are public. In its definitions document (2020, older), a 5-star rating needs a discount to fair value of 20% for Low uncertainty, 30% Medium, 40% High, 50% Very High and 75% Extreme; a 1-star rating needs a premium of 25%, 35%, 55%, 75% and 300% respectively. Uncertainty comes from bull and bear cases set so there is a 25% chance of beating the bull and 25% of missing the bear. A moat is a structural advantage that keeps ROIC above WACC, from one of five sources (intangibles, switching costs, network effect, cost advantage, efficient scale) ([Morningstar definitions](https://advisor.morningstar.com/Enterprise/VTC/UpdatedEquityResearchDefinitions.pdf)). Fair value is a three-stage DCF where moat width sets how slowly excess returns fade to WACC ([Morningstar.ca](https://morningstar.ca/ca/news/188241/how-morningstar-values-stocks.aspx)). PIF already has a DCF with sensitivity, so it can produce a "PIF Star" band chart with its sensitivity grid standing in for bull and bear (a PIF adaptation, not a Morningstar rating). The style box and Portfolio X-Ray overlap view are also easy copies ([Morningstar style box](https://morningstar.co.uk/uk/news/59616/diversification-matters-how-to-use-the-morningstar-style-box.aspx); [X-Ray help](https://www.morningstar.com/help-center/portfolio/xray)).

**Finviz** Elite is officially $39.50 a month or $299.50 a year (a $149 first-year promotion was showing on November 13, 2026) and adds real-time data, unlimited alerts on news, ratings, insider trades, SEC filings and screens, and Excel/CSV export ([Finviz Elite](https://finviz.com/elite)). Its January 2026 maps colored the S&P 500 treemap by drawdown from the 52-week high, gain from the 52-week low and six months of insider net buying, and added a themes map ([Finviz blog](https://finviz.com/blog/new-stock-market-maps-for-market-cap-52-week-highs-lows-themes-and-insider-trading)). One third-party review says Finviz has no AI features as of 2026 ([ChartingLens](https://chartinglens.com/blog/is-finviz-elite-worth-it)). A holdings-only treemap (size = weight, color = day move or drawdown or insider score) is a quick PIF win.

**Quartr** Pro is free for student organizations and faculty by application, and it covers PIF's biggest data hole: live calls and real-time transcripts for 17,000+ companies in 65+ markets, AI chat with sourced answers, automations that run a saved prompt when a company publishes, slide history comparison and keyword alerts that jump to the exact sentence ([Quartr students](https://quartr.com/students); [Quartr keyword alerts](https://quartr.com/features/keyword-alerts)). The program's terms (seats, duration, whether data can be pulled into PIF's app) are not public, and Quartr's API is a separate contact-sales product ([Quartr API pricing](https://quartr.com/pricing/api)). Plan on members using Quartr next to PIF, not inside it, until the terms say otherwise.

**AlphaSense** documents its sentiment method well enough to reproduce: each sentence is labeled positive, negative or neutral; the document score is (positive minus negative) over total statements, confidence-adjusted, then normalized against two years of transcripts to a -99 to 99 scale where ±40 marks the top and bottom 20% ([AlphaSense help](https://help.alpha-sense.com/hc/en-us/articles/41711901352211)). Its Smart Summaries link each bullet to the exact transcript line, and its Workflow Agents (Company Primer, Key Themes, Meeting Prep) were announced at AlphaSummit 2025 ([AlphaSummit 2025](https://alpha-sense.com/resources/product-articles/alphasummit-2025-product-announcements/)). A third-party source put AlphaSense at $10,000 to $20,000 per user per year as of April 2024 ([IntuitionLabs](https://intuitionlabs.ai/software/pdfs/alphasense.pdf)).

**Seeking Alpha Quant** grades five sector-relative factors (Value, Growth, Profitability, Momentum, EPS Revisions) from A+ to F and caps a stock at Hold if Growth, Momentum or Revisions is D+ or worse, or Value or Profitability is D- or worse. Weights are secret ([SA Quant FAQ](https://help.seekingalpha.com/premium/quant-ratings-and-factor-grades-faq)). PIF should copy the sector-relative grading and the disqualifier rule, and publish its own weights.

Among **newer AI tools**, the patterns worth copying are Daloopa's three-tool connector (discover companies, discover series, get fundamentals, with every value hyperlinked to its source location) ([Claude marketplace: Daloopa](https://claude.com/marketplace/connectors/daloopa)), Hebbia Matrix's per-cell sourcing across many documents ([Hebbia](https://www.hebbia.com/resources/financial-research-platforms)), and Brightwave's report templates ([Brightwave](https://www.brightwave.io/platform)). Fintool's operating status is contradictory across sources ([AllMind](https://allmind.ai/research/fintool-alternatives)), and Stratosphere appears to be the same product line as FinChat, now Fiscal.ai ([G2](https://www.g2.com/products/stratosphere-io/reviews)). Anthropic's May 5, 2026 finance update ships ten agent templates, including an Earnings reviewer, Market researcher and Valuation reviewer, which are the closest public reference designs for PIF's earnings and scout agents ([Anthropic: finance agents](https://www.anthropic.com/news/finance-agents)).

### Prices, labeled by source

| Product | Price | Source type and date |
|---|---|---|
| Bloomberg Terminal | about $31,980/yr single seat; about $28,320/seat multi-seat; no public rate card | Third-party, from press reports of client letters ([Koyfin blog](https://www.koyfin.com/blog/bloomberg-terminal-cost/); [Costbench](https://www.costbench.com/software/financial-data-terminals/bloomberg-terminal/)) |
| FactSet | $12,000 to $18,000/seat/yr | Third-party, low quality, unverified ([Eulerpool](https://eulerpool.com/blog/bloomberg-terminal-cost)) |
| Capital IQ Pro, Visible Alpha | No public price; Visible Alpha is a paid add-on | Official ([S&P, Mar 2025](https://press.spglobal.com/2025-03-25-S-P-Global-Market-Intelligence-Launches-Visible-Alpha-on-S-P-Capital-IQ-Pro-Platform)) |
| AlphaSense | $10,000 to $20,000/user/yr | Third-party, April 2024 ([IntuitionLabs](https://intuitionlabs.ai/software/pdfs/alphasense.pdf)) |
| Koyfin | Free, $39, $79, $209, $299 per month | Official, fetched 2026-11-13 ([Koyfin](https://www.koyfin.com/pricing/plans-comparison/)) |
| Finviz Elite | $39.50/mo or $299.50/yr ($149 first-year promo seen) | Official, fetched 2026-11-13 ([Finviz](https://finviz.com/elite)) |
| Quartr Pro | Contact sales; free for student organizations | Official ([Quartr pricing](https://quartr.com/pricing); [students](https://quartr.com/students)) |
| YCharts | Contact sales; Professional about $6,000/yr | Official for contact-sales ([YCharts](https://get.ycharts.com/plans)); price third-party, unverified ([DEV Community](https://dev.to/pickuma/ycharts-review-financial-research-and-stock-screening-for-data-driven-investors-32en)) |
| Seeking Alpha | Premium $239/yr, Pro $2,400/yr | Third-party, Koyfin blog, Jan 2026 ([Koyfin blog](https://www.koyfin.com/blog/top-earnings-call-transcripts-platforms)) |
| BamSEC Pro | $69/mo billed annually | Third-party, Koyfin blog, Jan 2026 ([Koyfin blog](https://www.koyfin.com/blog/top-earnings-call-transcripts-platforms)) |
| Fiscal.ai | from about $24/mo | Third-party ([Day Trading Toolkit](https://daytradingtoolkit.com/reviews/finchat-review)) |
| sec-api.io | Free 100 calls total; $49/mo Personal (covers university researchers); $199/mo Business | Official ([sec-api.io](https://sec-api.io/pricing)) |
| Massive (formerly Polygon) | Free 5 calls/min end-of-day; Stocks Advanced $199/mo; Financials & Ratios $29/mo | Official ([Massive](https://massive.com/pricing)) |
| Alpha Vantage | Free 25 requests/day; unlimited for verified educational projects | Official ([Alpha Vantage](https://www.alphavantage.co/support/)) |
| Kroll Cost of Capital Navigator | No public price; 14-day trial | Third-party listing ([Capterra](https://www.capterra.com/p/241024/Cost-of-Capital-Navigator/)) |

Claremont students may already have Bloomberg, Capital IQ or WRDS through a library. That was not checked and is worth one email before buying anything.

### Screens, alerts and workflows worth copying

| Feature | Who has it | PIF status | Free-data build | How to show it |
|---|---|---|---|---|
| Annotated price chart (8-K items, Form 4 trades, earnings, pitch and vote dates) | Capital IQ | IMPROVE: chart exists, no event markers | EDGAR submissions `items`, Form 4, calendar, pitches table | Price line with glyphs; hover shows the filing or trade |
| Typed event feed from 8-K item codes | Capital IQ Key Developments | IMPROVE: tiered red-flag scanner exists | Submissions JSON already carries `items` | Feed with severity chips, one card per ticker per day |
| Whole-market screener with signals (new highs, insider buying, upgrades) | Finviz, Bloomberg EQS, Capital IQ | NEW (screener today is peers of holdings) | XBRL frames give one value per filer per period; prices are the hard part | Filter panel, results table, sparkline grid |
| Natural-language screening | Capital IQ Pro | NEW | LLM converts text to a JSON filter, code runs it | Text box that turns into visible, editable criteria chips |
| Screen entry and exit alerts | Capital IQ, Finviz Elite | NEW | Re-run saved screens nightly, diff results | Inbox card plus "entered / left" table |
| Check Ticker (rules passed or failed) | Koyfin | NEW (IPS checks exist) | Screener rules plus IPS rules | Pass/fail checklist on the research page |
| Watchlist custom columns | Koyfin | IMPROVE | Insider score, revisions, short pressure already computed per ticker | Sortable table with column picker |
| Holdings treemap with alternate colorings | Finviz | NEW | Prices, 52-week range, insider score | Treemap: size = weight, color = chosen metric |
| X vs Y scatter across holdings and peers | YCharts | NEW | XBRL plus prices | Scatter, optional time trail |
| User-weighted scoring models | YCharts | IMPROVE (fixed-weight scorecard) | Existing factor data | Ranked table with weight sliders and a backtest button |
| Letter grades with disqualifier rule | Seeking Alpha Quant | IMPROVE | Existing factor percentiles, made sector-relative | Five-grade row with "capped at Hold because..." note |
| Star bands from DCF | Morningstar | NEW | Existing DCF and sensitivity grid | Horizontal band chart, price marker |
| Style box with portfolio centroid | Morningstar | NEW | Market cap plus value and growth scores | 3x3 heatmap with a centroid dot |
| Brinson attribution plus AI commentary | Bloomberg PORT, FactSet, Koyfin | NEW (contribution is HAVE) | Sector SPDR ETFs as benchmark sectors | Allocation/selection/interaction waterfall, short narrative |
| Ex-ante tracking error, VaR, scenario replays | PORT, MARS, Barra | NEW | Daily prices, FRED, French factors | Gauge plus contribution-to-risk bars |
| Pre-trade what-if against IPS | PORT trade simulation | NEW | Holdings, IPS limits | Before/after table on the IC vote page |
| Instant earnings brief on 8-K Item 2.02 | Capital IQ Earnings IQ Alerts | IMPROVE (filing AI briefs exist) | 8-K exhibit 99 text plus consensus | Card: actual vs consensus, pillar impact |
| Compare Matrix (companies x questions, cited cells) | Koyfin, Hebbia, AlphaSense | NEW | Filings text | Grid; each cell has answer, quote and link |
| KPI extraction with source links | Daloopa, Fiscal.ai | NEW | 10-Q, 10-K and 8-K text, cross-checked to XBRL | KPI table by quarter, each cell links to its sentence |
| Sentence-level tone, normalized | AlphaSense | NEW | Loughran-McDonald dictionary or an LLM over MD&A and press releases | Score line by quarter vs peers, green/red underlines |
| Keyword mention alerts | Quartr, StreetAccount | NEW | EDGAR full-text search | Alert list with deep links |
| Saved, shareable workflows | ASKB Workflows, Quartr automations | NEW | `lib/scheduler.js` exists | Template library page |
| Ask the fund's own content | ASKB at GA | NEW | Notes, chat, pitches, votes | Chat with citations and the query shown |
| Batched email digest | StreetAccount | NEW (in-app inbox is HAVE) | Internal | Morning and end-of-day email |
| Supply chain map | Bloomberg SPLC | HAVE (`lib/supplyChain.js`) | 10-K 10%-customer disclosures | Network graph |
| Packet or comparison PDF | Bloomberg PIB, Koyfin reports | NEW | EDGAR plus PIF notes | Downloadable PDF |
| Transcripts and call search | Capital IQ, Koyfin, Quartr | NEW | Quartr student program (in Quartr's app); Alpha Vantage transcript endpoint (free tier coverage unverified) | Transcript reader with search and highlights |

## 3. Valuation formulas: what to add, what to fix, how to draw each one

The canonical formulas tie together. Damodaran's own definitions give FCFF, FCFE, return on capital, invested capital, reinvestment rate and EVA, linked by the identity **growth = reinvestment rate x return on capital** ([Damodaran variable definitions](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/variable.htm); [Damodaran session 8 slides](https://pages.stern.nyu.edu/~adamodar/pdfiles/valonlineslides/session8.pdf)). That identity is also the McKinsey value driver formula, so it doubles as a consistency check on PIF's DCF: if a member's growth and margin inputs imply a reinvestment rate below zero or above 100%, the workbench should say so. Damodaran does not add back stock-based compensation and calls the add-back indefensible ([Damodaran blog, Feb 2014](https://aswathdamodaran.blogspot.com/2014/02/stock-based-employee-compensation-value.html)), which matters for PIF's tech-heavy book.

### Discount-rate inputs should carry an as-of date

Default WACC inputs can all be free and current. FRED's 10-year Treasury (DGS10) was **5.10% on November 12, 2026** ([FRED DGS10](https://fred.stlouisfed.org/series/DGS10)). Damodaran's implied S&P 500 equity risk premium was **4.41% on November 1, 2026** (trailing 12 months with adjusted payout), with alternatives from 3.39% to 5.81% depending on method ([Damodaran home page](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/home.htm)); he has posted it monthly since September 2008 ([Damodaran blog, March 2026](https://aswathdamodaran.blogspot.com/2026/03/the-price-of-risk-equity-risk-premium.html)). Kroll reaffirmed a **5.0% US ERP** on September 2, 2026, paired with the higher of a 3.5% normalized risk-free rate or the spot 20-year Treasury ([BVWire, Sept 2026](https://www.bvresources.com/articles/bvwire/kroll-reaffirms-50-us-erp-sticks-with-treasury-risk-free-rate)). Damodaran's January 2026 US file shows a market cost of capital of 6.96% (7.72% excluding financials) and cost of equity of 8.02% ([Damodaran wacc.html](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/wacc.html)), a useful sanity band for student pitches. His industry files update once a year in early January ([Damodaran current data](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datacurrent.html)), so they go stale by fall; use them as a band, and use PIF's live peer comps for the point estimate. For beta, Damodaran's bottom-up approach unlevers an industry beta, Beta_U = Beta / (1 + (1 - t) x D/E), then relevers it at the company's own market D/E ([Damodaran variable definitions](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/variable.htm)). Store each input with its as-of date rather than hard-coding it.

### Valuation metric table

| Metric | Formula | Data source and cost | How to visualize | Status |
|---|---|---|---|---|
| FCFF | EBIT(1-t) - (capex - D&A) - change in non-cash working capital ([Damodaran](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/variable.htm)) | SEC companyfacts XBRL, free, no key ([SEC APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)) | Bars by year with the reinvestment split shown | IMPROVE (FCF exists, see Section 5) |
| FCFE | Net income - (capex - D&A) - change in WC - (principal repaid - new debt); equivalently CFO - capex + net borrowing; no SBC add-back | XBRL, free | Bars by year next to dividends plus buybacks | NEW |
| FCF yield and SBC-adjusted FCF yield | (CFO - capex) / market cap; (CFO - capex - SBC) / market cap | XBRL `ShareBasedCompensation` (tag to verify at the FASB viewer), price from the existing price layer | Paired bars per holding; the gap is the SBC drag | IMPROVE |
| DCF with sensitivity | Existing; add fundamental-growth check g = reinvestment rate x ROIC | Existing | Outline the heatmap cell nearest today's price so the grid doubles as a reverse DCF | HAVE, IMPROVE |
| Reverse DCF and market-implied forecast period | Solve for the growth, or the number of years of value-creating growth, that the price implies (Mauboussin and Rappaport) ([expectationsinvesting.com](https://expectationsinvesting.com/)) | Existing solver | Implied growth vs 5-year history vs consensus, on one bar chart | HAVE (reverse DCF), NEW (forecast period) |
| Value driver terminal value | NOPAT(t+1) x (1 - g/RONIC) / (WACC - g) ([Jennergren](https://research.hhs.se/esploro/outputs/workingPaper/Value-Driver-Formulas-for-Continuing-Value/991001535499306056)); critics say it can overstate value when RONIC is below ROIC ([Bodmer](https://edbodmer.com/mckinsey-value-driver-formula-distortions/)) | Existing DCF inputs | Value driver tree: price to EV to NOPAT, growth, RONIC, WACC as leaves | NEW |
| EV and EV multiples with a bridge | EV = diluted market cap + financial debt (+ lease debt only if EBITDA is lease-adjusted) + preferred + noncontrolling interest - cash and short-term investments - equity-method investments | XBRL; lease and NCI tags governed by XBRL US rules ([DQC_0087](https://xbrl.us/data-rule/dqc_0087/); [NCI guidance](https://xbrl.us/guidance/specific-non-controlling-interest-elements/)) | EV bridge waterfall; shows exactly where Yahoo and XBRL differ | IMPROVE |
| ROIC vs WACC and EVA | ROIC = EBIT(1-t) / (BV debt + BV equity - cash); EVA = (ROIC - WACC) x invested capital ([Damodaran](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/variable.htm)) | XBRL; Damodaran industry ROIC as a band, free | Spread bars by year (green above zero, red below), EVA dollars as a line | IMPROVE (ROIC exists) |
| EPV and franchise value | EPV = normalized EBIT(1-t) / WACC; franchise value = EPV - reproduction value; proxy reproduction value with book invested capital, labeled as a proxy ([Kellogg lecture notes](https://kellogg.northwestern.edu/faculty/jagannathan/teaching/practicum/2006/files/Week3/VI_Lecture_3.pdf)) | XBRL | Stacked bar: asset value, franchise value, growth value, against market cap | NEW |
| Residual income value | BV0 + sum of (ROE_t - r) x BV_(t-1) / (1+r)^t + terminal ([Feltham-Ohlson 1995](https://u.osu.edu/schroeder.9/files/2017/07/Feltham1995-1kngbjq.pdf)) | XBRL | Line of abnormal earnings by year; works for banks where FCF is awkward | NEW |
| Implied cost of capital | The r that sets residual income value equal to price (Gebhardt, Lee and Swaminathan 2001) ([IDEAS](https://ideas.repec.org/a/bla/joares/v39y2001i1p135-176.html)); weak beyond the forecast horizon ([NBER w15950](https://www.nber.org/papers/w15950.pdf)) | Existing reverse solver | Gauge: implied r vs PIF's WACC | NEW |
| Implied growth from P/E | g = (r x P/E - payout) / (P/E + payout) for trailing P/E (algebra from a Gordon model) | Price, EPS, payout | Single number next to reverse DCF result | NEW |
| Cash-flow accruals | (Net income - CFO) / average total assets; preferred to the balance-sheet version because M&A distorts balance-sheet changes ([Hribar-Collins](https://econpapers.repec.org/RePEc:bla:joares:v:40:y:2002:i:1:p:105-134)); the anomaly has weakened ([Green, Hand, Soliman 2011](https://ideas.repec.org/a/inm/ormnsc/v57y2011i5p797-816.html)) | XBRL | Percentile bar vs peers, trend line | NEW |
| Gross profitability | Gross profit / total assets ([Novy-Marx 2013](https://econpapers.repec.org/RePEc:eee:jfinec:v:108:y:2013:i:1:p:1-28)) | XBRL | Percentile bar in the factor card | NEW |
| Graham number | sqrt(22.5 x EPS x BVPS) ([YCharts glossary](https://ycharts.com/glossary/terms/graham_number)) | XBRL | One bar on the football field | NEW, low priority |
| Rule of 40 | Revenue growth % + margin %; sources disagree on EBITDA vs FCF margin ([CFI](https://corporatefinanceinstitute.com/resources/valuation/rule-of-40)) | XBRL | Scatter of growth vs margin with the 40 line, software holdings only | NEW |
| PIF Star bands | Price vs DCF value, banded by Morningstar's published margins for the uncertainty level implied by the sensitivity range | Existing DCF | Band chart from 1 to 5 stars with a price marker | NEW (PIF adaptation) |
| Capital allocation grade | Buybacks, dividends, net debt change, acquisitions from the cash flow statement, graded in the spirit of Morningstar's Exemplary/Standard/Poor | XBRL | Stacked bars of uses of cash by year | NEW |
| Football field | One bar per method (DCF grid min-max, EV/EBITDA and EV/EBIT peer quartiles, EPV, residual income, Graham), 52-week range as a reference bar, a vertical line at price, all inputs on one as-of date ([FE Training](https://www.fe.training/free-resources/valuation/football-field-analysis/)) | All of the above | Horizontal range bars | NEW |

ROIC persistence is the reason to show the spread over many years: secondary summaries of Mauboussin's work report that 41% of top-quintile ROIC companies in 1997 were still top quintile nine years later, against 20% if random ([GuruFocus summary](https://www.gurufocus.com/news/19462/mauboussin-on-strategy-roic-patterns-luck-persistence-and-what-to-do-about-it)), and a 2024 follow-up found substantial reversion for 2013 to 2023 ([Measuring the Moat](https://www.morganstanley.com/im/publication/insights/articles/article_measuringthemoat.pdf)). Leases matter for the EV bridge: Damodaran's January 2026 file puts lease debt at 10.02% of total debt for US non-financial firms, and capitalizing leases cuts their aggregate ROIC from 18.92% to 17.39% ([Damodaran leaseeffect](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/leaseeffect.html)). Mixing lease-inclusive debt with unadjusted EBITDA overstates EV/EBITDA, so the app should show "net debt excluding leases" and "net debt including leases" side by side and pair each with the matching multiple.

Segment revenue and other dimensional facts are not in companyfacts, which includes only standard, entity-wide tags ([SEC APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)). Segment data needs the Financial Statement and Notes data sets or the filing's own XBRL instance ([SEC Notes data sets](https://www.sec.gov/data-research/sec-markets-data/financial-statement-notes-data-sets)); treat it as a later phase.

## 4. Signals: published effects shrink after publication, so show them with caveats

The most important number in this section is not any single signal's return. McLean and Pontiff studied 97 published predictors and found returns **26% lower out of sample and 58% lower after publication**, with bigger declines for predictors that had bigger in-sample returns ([McLean & Pontiff 2016](https://Www.Gwern.net/doc/economics/2016-mclean.pdf)). Every effect size below is an in-sample academic figure. When the app explains a score to members, it should show the paper, the sample years and a "post-publication" note, and the headline effect should be treated as an upper bound. No signal-specific decay study was found for Lazy Prices, opportunistic insiders, 13F breadth, best ideas or days to cover, so no decay numbers are given for them.

### Resolving the Kim, Muhn and Nikolaev conflict

The two sets of notes disagree on one paper. Earlier versions of Kim, Muhn and Nikolaev, "Financial Statement Analysis with Large Language Models," reported that GPT-4 with chain-of-thought prompting predicted the direction of future earnings with about 60% accuracy from anonymized statements, on par with a purpose-trained neural net and above the reported analyst range ([arXiv 2407.17866v2](https://arxiv.org/abs/2407.17866v2)). The arXiv listing for v3 (February 2025) says the paper was **withdrawn** after a co-author found inconsistencies in the data and analyses while replicating it ([arXiv 2407.17866v3](https://arxiv.org/abs/2407.17866v3)). The withdrawal is the current state of the record, so the 60% figure should not support any PIF feature or claim. The app should not market an "LLM beats analysts" feature.

### Signal table

| Signal | Formula | Evidence (in-sample) | Data source and cost | How to visualize | Status |
|---|---|---|---|---|---|
| Factor exposures by regression | Daily excess return on Mkt-RF, SMB, HML, RMW, CMA (FF5) plus Mom, 252-day window for the headline, rolling 126 or 252 days for the trend; Newey-West standard errors with lag floor(4 x (T/100)^(2/9)), which gives 4 lags for T = 252 (the notes' "about 6" is an arithmetic slip); 95% CI = beta ± 1.96 x SE | Standard method; French factors are free daily, weekly and monthly ([French library](https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html)) | French CSVs, free; the page showed September 2026 data in mid-November, so the last one to two months need an ETF-spread proxy, labeled as such | Exposure bars with CI whiskers; rolling exposure lines; portfolio shown both returns-based and holdings-based (sum of weight x beta) | IMPROVE: today's scorecard is percentiles within holdings plus watchlist, so "high value" means cheaper than the other names, not a market tilt |
| Estimate revision breadth | (up revisions - down revisions) / number of estimates | Already built | Yahoo earningsTrend (already used) | Histogram across holdings with the weighted mean marked | HAVE; IMPROVE: store daily snapshots |
| Analyst dispersion | (high - low) / abs(mean) FY1 EPS as a proxy, since Yahoo gives no standard deviation | High-dispersion stocks earn lower future returns, strongest in small and prior-loser stocks ([Diether, Malloy, Scherbina 2002](https://www.kellogg.northwestern.edu/faculty/mcdonald/ftp/practicum/papers/dms3.pdf)) | Yahoo, free | Dot per holding on a dispersion axis, flagged above a set percentile | NEW |
| SUE / earnings surprise | (EPS_q - EPS_(q-4)) / std dev of that difference over 8 quarters, or (actual - consensus) / price | PEAD reported gone in non-microcaps after the mid-2000s ([Martineau 2022](https://nowpublishers.com/article/Details/CFR-0122)); contested by a later replication ([UCLA Anderson Review](https://anderson-review.ucla.edu/is-post-earnings-announcement-drift-a-thing-again)) | Yahoo earningsHistory, free | Dot on the price chart at each report date, colored by sign; context, not a buy trigger | NEW |
| Short interest and days to cover | DTC = short interest / average daily volume | Long-short DTC earns about 1.2% per month; DTC beats the plain short ratio ([Hong et al., NBER w21166](https://nber.org/papers/w21166)) | FINRA consolidated short interest, free, twice monthly, published seven business days after settlement with FINRA's own ADV and DTC ([SEC Release 34-105482](https://www.sec.gov/files/rules/sro/finra/2026/34-105482.pdf)); keyless API ([FINRA consolidatedShortInterest](https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest)) | Short-interest bars vs price line, DTC on hover, publication dates marked | IMPROVE (see Section 5) |
| Short volume ratio | Short volume / total volume per day | A flow, not a position | FINRA Reg SHO daily file (already used) | Small separate line, never blended into "short interest" | IMPROVE |
| Opportunistic insider buys | Routine = traded in the same calendar month in each of the prior three years; opportunistic = everyone else | Opportunistic trades earn about 82 bp per month value-weighted; routine about zero; routine is roughly 55% of trades ([Cohen, Malloy, Pomorski](https://www.nber.org/papers/w16454.pdf)) | Form 4, free; SEC quarterly Insider Transactions Data Sets for history, with a 10b5-1 affirmation field added July 2025 ([SEC](https://www.sec.gov/data-research/sec-markets-data/insider-transactions-data-sets)) | Chart markers: green up-triangle for opportunistic buys, gray for routine, hollow for 10b5-1, sized by dollars | HAVE; IMPROVE (Section 5) |
| Cluster buys | Three or more distinct insiders buying within 30 days (design choice; no effect size verified) | Practitioner screen | Form 4 | Badge on the insider card | NEW |
| Form 144 notices | Planned sales filed before the Form 4 | Not researched | Form 144 XML (spec exists) ([SEC technical specifications](https://www.sec.gov/submit-filings/technical-specifications)) | Early-warning row in the ownership tab | NEW |
| 13F breadth change | Change in the number of filers holding the stock, on a stable filer set | Lowest breadth-change decile trailed the top decile by 6.38% over 12 months (4.95% risk-adjusted), 1979 to 1998 mutual fund data ([Chen, Hong, Stein 2002](https://ideas.repec.org/p/nbr/nberwo/8151.html)) | Live 13F ingest (HAVE) | Sorted bars of breadth change per holding, filing-lag date marked | HAVE; IMPROVE: exclude passive filers |
| 13F best ideas | Rank by overweight: portfolio weight minus market-cap weight, among concentrated active filers | Best ideas beat the market by about 1 to 2.5% per quarter by specification ([Cohen, Polk, Silli](https://personal.lse.ac.uk/polk/research/BestIdeas.pdf)) | 13F plus market cap from XBRL shares outstanding x price | Table of filers whose best idea is a PIF holding | IMPROVE (Section 5) |
| Lazy Prices 10-K change | Cosine similarity of this year's vs last year's sections | Shorting changers and buying non-changers earned up to 188 bp per month; no announcement effect; Risk Factors, litigation and management-team language most informative ([Cohen, Malloy, Nguyen 2020](https://www.nber.org/papers/w25084.pdf)) | EDGAR (HAVE) | Redline diff with a header strip: similarity, tone change, Risk Factors length change | HAVE |
| Loughran-McDonald tone | Share of negative and uncertainty words in Risk Factors and MD&A, and change vs prior year | Dictionary updated March 2026, covers 1993 to 2025; free for academic research, license needed for commercial use ([Notre Dame SRAF](https://sraf.nd.edu/loughranmcdonald-master-dictionary/)) | Free CSV | Tone line by year; LM-negative words highlighted in added text | NEW |
| Capex intent from calls | LLM answers "how will capex change next year" on a 5-point scale, with the quotes it used | One SD higher score goes with 0.034 SD higher next-quarter capex; high-score firms have negative future abnormal returns ([Jha et al., NBER w32161](https://ideas.repec.org/p/nbr/nberwo/32161.html)) | Needs transcripts | Score per call with quotes; research aid only | NEW |
| Management evasiveness | Share of analyst questions that get non-answers | A 4B model reached 81.3% on EvasionBench; single-model labeling without human checks raises reliability concerns ([EvasionBench](https://arxiv.org/html/2601.09142v1)) | Needs transcripts | Per-call bar vs company history | NEW, later |
| News headline sentiment | LLM labels good, bad, neutral | Predicts next-day returns, mostly in small stocks and after bad news; returns fall as LLM adoption rises ([Lopez-Lira & Tang](https://arxiv.org/abs/2304.07619v5)) | Finnhub news (HAVE) | Already in news triage; do not present as a return signal | HAVE |
| Attention spikes | z-score of Wikipedia page views vs a 90-day baseline (design choice) | A 2013 study on the 30 Dow stocks found page-view patterns before moves; small sample ([Moat et al.](https://ui.adsabs.harvard.edu/abs/2013NatSR...3E1801M/abstract)) | Wikimedia API, free, keyless ([pageviews](https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/Nvidia/daily/20261001/20261003)) | Spike markers in the crowding monitor | IMPROVE (crowding monitor exists) |

Two regulatory facts shape the short-interest design. FINRA's May 2026 proposal to move to weekly reporting was **withdrawn on August 5, 2026**, so the twice-monthly schedule stands ([SEC SR-FINRA-2026-012](https://www.sec.gov/rules-regulations/self-regulatory-organization-rulemaking/sr-finra-2026-012)). The SEC's Form SHO large-short-position reporting is not in effect: after a Fifth Circuit remand, compliance moved to January 2, 2028, with first filings due February 14, 2028 ([Morgan Lewis, Dec 2025](https://www.morganlewis.com/pubs/2025/12/short-sale-reporting-on-form-sho-compliance-date-further-extended-to-2028)). Borrow fees and utilization have no free source.

For LLM text signals, backtests face look-ahead bias (the model saw later data) and a "distraction" effect where general knowledge about a company skews the reading; anonymizing company names improved in-sample results in one study ([Glasserman & Lin](https://arxiv.org/abs/2309.17322)). Any PIF backtest of an AI score should anonymize tickers and use only dates after the model's training cutoff.

## 5. Problems found in the existing code

These issues come from reading the code during research, plus a spot check of the same lines while writing this report. None of it came from running the app against real holdings, so each item is a likely cause to confirm, not a confirmed diagnosis. **No code was changed.**

| # | Issue | Where | Why it matters | Suggested fix |
|---|---|---|---|---|
| 1 | FCF treats a missing capex value as zero: `freeCashFlow: ocf !== null ? ocf - orZero(capex) : null` | `lib/fundamentals.js` line 50 | A missing capex tag makes FCF equal CFO, which overstates FCF and FCF yield. A likely contributor to the FCF mismatches seen on tech holdings | Return null when capex is missing, or fall back through more tags |
| 2 | Capex maps to only two tags (`PaymentsToAcquirePropertyPlantAndEquipment`, `PaymentsToAcquireProductiveAssets`) | `lib/sources/sec.js` tag map | Firms that tag capex differently, or with a company extension (which companyfacts drops), get no capex, which then hits issue 1 | Add optional components such as `PaymentsToAcquireIntangibleAssets`; check the filing's own label |
| 3 | 10-Q year-to-date cash-flow periods are dropped. `durationPeriod()` keeps 75 to 105 day spans and 340 to 380 day spans only | `lib/sources/sec.js` lines 47 to 52 | 10-Q cash-flow statements are year-to-date, so Q2 (about 6 months) and Q3 (about 9 months) are discarded; only Q1 and the full year survive. The code comment shows dropping YTD was deliberate to avoid collisions, but quarterly and TTM cash flow then cannot be built | Keep YTD facts in their own bucket and difference them (Q2 = 6M YTD - Q1; Q4 = FY - 9M YTD) |
| 4 | Short-term debt tags are picked, not summed: `shortTermDebt: ["LongTermDebtCurrent", "DebtCurrent", "ShortTermBorrowings"]`, merged per period with the latest filing winning | `lib/sources/sec.js` line 115 | A company that reports both current long-term debt and short-term borrowings can show either one depending on filing order. `DebtCurrent` can already include both, so naive summing would double count | Build financial debt explicitly: current LTD + short-term borrowings + commercial paper, or `DebtCurrent` alone when present; verify per company |
| 5 | No tags for leases, noncontrolling interest, preferred stock, equity-method investments or SBC | `lib/sources/sec.js` tag map | EV and net debt omit items that pro EV definitions include; Yahoo's total debt includes leases, which explains part of the debt mismatch; SBC-adjusted FCF cannot be computed | Add `OperatingLeaseLiability` (current and noncurrent), finance lease liabilities, `MinorityInterest`, `PreferredStockValue`, `EquityMethodInvestments`, `ShareBasedCompensation`; check each name at the FASB taxonomy viewer, since the notes did not verify every tag |
| 6 | Interest expense falls back from `InterestExpense` to `InterestExpenseNonoperating`; some filers report only net interest | `lib/sources/sec.js` | Cost-of-debt estimates break for those filers | Use a synthetic rating (coverage to spread) only when gross interest expense is present |
| 7 | Days to cover comes from Yahoo `defaultKeyStatistics`, with an unclear as-of date | `lib/shortPressure.js` | FINRA publishes its own DTC and ADV per symbol, free, tied to a settlement date. Yahoo's figure cannot be placed in time, so it cannot be backtested point-in-time | Pull FINRA `consolidatedShortInterest`, store each release with settlement and publication dates |
| 8 | FINRA daily short sale volume is a flow (shares sold short that day), not short interest (open positions) | `lib/shortPressure.js` (`finraTrendSlope` feeds the score) | The code's reason text correctly calls it a "short-volume ratio," but the trend still feeds a positioning score next to DTC and short % of float. Mixing a daily flow into a position-based score makes the score harder to read and to backtest | Show it as a separate line, or give it a small, labeled weight; base the score on FINRA positions |
| 9 | 13F "best ideas" rank by raw in-portfolio weight | `lib/thirteenF.js` (`computeWeights`, `topConviction`) | Cohen, Polk and Silli rank by overweight vs market weight. Raw weight tags mega-caps as best ideas for index-like filers. The code comment says this is a proxy because free EDGAR data lacks market caps | Market cap is available free: XBRL `dei/EntityCommonStockSharesOutstanding` (frames endpoint returned HTTP 200 in testing) x price. Rank by (portfolio weight - market weight) and restrict to concentrated, active filers |
| 10 | New insiders get weight 0.6: `WEIGHT = { opportunistic: 1, new: 0.6, routine: 0 }` | `lib/insiderSignals.js` line 46 | The routine test needs three prior years of history. Cohen, Malloy and Pomorski would treat insiders without that history as unclassifiable, not as partly opportunistic | Label "new / unclassified" in the UI and score it separately, or default it to a neutral weight with an explanation |
| 11 | The 10b5-1 flag is unused | No match for "10b5" in `lib/` or `routes/` | The SEC added a 10b5-1 affirmation element to its insider data sets in July 2025. A 10b5-1 sale is pre-planned by construction, so the flag sharpens the routine test for free | Parse the Form 4 10b5-1 checkbox; treat flagged trades as routine |
| 12 | The revision score has no stored history | `lib/estimateRevision.js`; no revision table found in `db.js` | Yahoo's 7-day and 30-day revision counts are a snapshot, so the backtester cannot test revisions point-in-time | Persist a daily snapshot table so history accumulates from now on |
| 13 | The factor scorecard ranks within holdings plus watchlist | `lib/factors.js` | Ranks are relative to a small, pre-selected universe and are not exposures | Add the regressions in Section 4; keep percentiles as a secondary view |

The XBRL "latest filed wins" dedupe may also pick a restated value over an original one in some periods; how often that happens was not researched.

## 6. Daily tracking for 39 holdings: tier every alert and scale moves by each stock's own volatility

### What pros watch, and what applies to a $160K fund

Vendor risk documentation centers daily monitoring on ex-ante tracking error, the split between factor and stock-specific risk, active exposures and each holding's contribution to risk ([MSCI Barra Analytics on FactSet](https://www.msci.com/resources/factsheets/Barra_Analytics_on_FactSet.pdf), search snippet only). The research found no citable account of a PM's morning routine, so this report does not present one as an industry standard. Liquidity checks matter less here: days to liquidate = position size / (ADV x participation rate), with participation rates in the sources from 5% under stress to 20% ([Man Group](https://www.man.com/insights/limitations-liquidity-risk-frameworks); [Mazars](https://www.mazars.co.uk/industries/financial-services/quantitative-solutions/mazars-liquidity-tool)). With about $4,000 per position, any US large or mid cap liquidates in well under a day, so a liquidity alert only matters for microcaps, thin ETFs or a name that moves to OTC.

Student fund IPS documents set the governance rules PIF should mirror. Carlson's fund caps any stock at 10% and requires a breach to be cured within ten business days, sets sector bands relative to the benchmark (±50% of benchmark weight for sectors over 10%, ±100% for smaller ones), and caps cash at 10% ([Carlson IPS](https://carlsonschool.umn.edu/sites/carlsonschool.umn.edu/files/inline-files/CGF%20investment%20policy%20statement%20-%20APPROVED%2020150924.pdf)). Loughborough's constitution asks for a stop-loss trigger and action plan per stock and lets the Chair call an emergency meeting when one fires ([Loughborough constitution](https://lsmf.lboro.ac.uk/wp-content/uploads/2024/11/The-Loughborough-Student-Initiative-Fund-Constitution-updated-Dec-2023.pdf)). UConn's fund describes the usual stop-loss review level as 10 to 20% below the buy price, which forced managers to update models and reassess ([UConn SMF Fall 2024](https://smf-business.media.uconn.edu/wp-content/uploads/sites/818/2025/01/SMF-Team-White-Fall-2024-Long-Report.pdf)). In every fund found, a stop loss opens a review and a meeting item; it does not sell automatically. That fits PIF, where trades need a vote.

### Alert fatigue research says send fewer alerts and make each one actionable

Google's SRE book says every page should be actionable, email alerts are rarely read or acted on, and ongoing sub-critical problems belong on a dashboard ([Google SRE Book, ch. 6](https://sre.google/sre-book/monitoring-distributed-systems/)). The clinical literature says the same thing with numbers: AHRQ cites about 187 ICU monitor warnings per patient per day and recommends tiering by severity and interrupting only for the severe tier ([AHRQ PSNet](https://psnet.ahrq.gov/primer/alert-fatigue)); a review of 23 articles found order-entry alert override rates from 46.2% to 96.2% ([JMIR Med Inform 2020](https://medinform.jmir.org/2020/7/e15653/), search snippet only). PIF should run three tiers: **push** for hard events, **inbox** for things to look at today, **digest** for the Today page and weekly brief. It should merge all events on one ticker on one day into one card, send no pushes outside market hours except a hard event before the open (hours are a design choice), and log how often each alert type is opened or acted on, demoting types nobody uses each quarter.

### Moves should be measured against each stock's own volatility

PIF's personal move alerts appear to use fixed percentage moves. A 3% day is routine for a high-volatility name and rare for a utility. The event-study standard is the standardized abnormal return: fit return = alpha + beta x market over a quiet window, typically 120 to 250 trading days, and divide today's residual by the residual standard deviation ([EventStudyTools](https://www.eventstudytools.com/introduction-event-study-methodology), search snippet only). Event days inflate volatility and make the test over-reject if they stay in the estimation window ([EventStudyTools significance tests](https://www.eventstudytools.com/significance-tests), search snippet only), so earnings days should be excluded. PIF should compute three versions: raw z (today's return over 60-day volatility), **idiosyncratic z** (residual vs SPY over about 250 days) and **sector-relative z** (residual vs the holding's sector SPDR). ETFs get raw z only. No source sets the cutoff, so 2 sigma to inbox and 3 sigma to push is a design choice to tune using the engagement log.

### 8-K items have measured price effects, so tier them by the data

Lerman and Livnat measured three-day abnormal returns around the filing date for 8-Ks filed 1994 through 2007 ([Lerman & Livnat](https://archive.nyu.edu/bitstream/2451/27579/2/SSRN-id1126816.pdf)):

| Item | Event | 3-day abnormal return around filing | Suggested PIF tier |
|---|---|---|---|
| 1.03 | Bankruptcy | -11.90% | Push |
| 3.01 | Delisting notice | -2.90% | Push |
| 2.06 | Material impairment | -1.65% (and -1.95% drift over 90 days) | Push |
| 4.02 | Non-reliance on prior financials | -1.61% | Push |
| 2.05 | Exit or disposal costs | -1.08% | Inbox |
| 2.04 | Acceleration of an obligation | -1.05% (not significant at filing; -2.00% event to filing) | Push |
| 5.01 | Change in control | 90-day drift -3.44% | Push |
| 4.01 | Auditor change | -0.59% | Inbox |
| 5.02 | Officer or director change | -0.11%, but significant abnormal volume | Inbox; push if CEO or CFO (design choice) |
| 1.01 | Material agreement | +0.41% | Inbox |
| 2.02 | Results | 88% abnormal volume | Earnings workflow |
| 7.01, 8.01, 5.07 | Reg FD, other, vote results | Small | Digest |

Reactions grew with the number of items in one 8-K (abnormal volume rose from 53% for one item to 95% for four), so multi-item filings deserve a severity bump. The sample ends in 2007 and does not cover Item 1.05 (cybersecurity, effective 2023). The items are already in EDGAR's submissions JSON (an NVIDIA probe returned values such as `5.02,9.01` and `2.02,9.01`) ([NVDA submissions](https://data.sec.gov/submissions/CIK0001045810.json)), so this is a re-mapping of PIF's existing red-flag tiers, not new parsing. Dividend cuts show no reliable drift after the announcement once earnings are controlled for ([Liu, Szewczyk, Zantout via IDEAS](https://ideas.repec.org/a/bla/jfinan/v63y2008i2p987-1020.html), search snippet only), so a cut on a holding is a thesis-review alert, and a push only for income ETFs.

### The check list

| Check | Cadence | Trigger | Data | Tier | Status |
|---|---|---|---|---|---|
| Idiosyncratic move | Intraday and close | abs(residual z) over cutoff vs SPY, about 250-day window | Prices, SPY | Push at high cutoff, inbox at lower | NEW (replaces fixed-% for team alerts) |
| Sector-relative move | Close | Residual vs sector SPDR | Sector ETFs | Inbox | NEW |
| IPS hard breach with cure clock | Daily | Weight over cap, cash under minimum; countdown to a cure deadline | Holdings | Push | IMPROVE (breaches exist, add countdown) |
| Near-limit warning | Daily | Within a set margin of a cap (design choice) | Holdings | Inbox | NEW |
| Tier-1 8-K items | On filing | 1.03, 3.01, 4.02, 2.06, 2.04, 5.01 | EDGAR submissions | Push | IMPROVE (realign tiers) |
| Drawdown review trigger | Daily | Decline from cost in the fund's chosen 10 to 20% range, and from 52-week high | Prices, cost basis | Inbox, adds a meeting agenda item | NEW |
| Earnings gap | Earnings day | Earnings-day move z-score | Prices, calendar | Inbox | IMPROVE (calendar exists) |
| Dividend cut or omission | On announcement | Any declared cut | Dividend data, 8-K | Push for income ETFs, inbox otherwise | NEW |
| Liquidity | Weekly | Position vs 20-day dollar ADV x participation | Volume | Digest | NEW, low value at this size |
| Existing alerts | As now | Price, targets, insider buys, short pressure, revisions, crowding, 13D/13G, votes | As now | Keep, assign tiers | HAVE |
| Tracking error and top risk contributors | Weekly | Week-over-week change | Prices, benchmark | Weekly brief | NEW |
| Attribution by holding and sector | Weekly | Allocation vs selection vs benchmark sectors | Prices, sector ETFs | Weekly brief | IMPROVE (move x weight exists) |
| Review queue | Weekly | Every name that crossed a trigger, with owner and last-review date | Internal | Weekly brief | NEW |
| Automated IPS compliance report | Quarterly | Standard report, as Loughborough describes | Internal | Report | IMPROVE |
| Alert engagement review | Quarterly | Demote alert types with low open or act rates | Notification logs | Report | NEW |
| Semester handoff per holding | Term end | Thesis, targets, triggers, owner, open promises | Internal | Report | NEW |

The morning view for 39 holdings then has a simple order: push-tier events since the last close, idiosyncratic movers, IPS status with any cure clocks, earnings today and this week with their briefs, and the review queue. Everything else goes to the digest.

## 7. PIF's own metrics: grade the process, not only the returns

The student fund literature mostly grades funds on returns and notes that direct assessment of learning is scarce ([Ramsey & Isengildina-Massa, AETR 2020](https://www.aaea.org/UserFiles/file/AETR_2020_016RRissue6.docx.pdf); [Belcher & Jones, JKMP](https://journals.klalliance.org/index.php/JKMP/article/view/615)). Process metrics are a way for PIF to measure learning, and the app already captures the inputs: confidence %, horizon, bull/base/bear targets, pre-mortem, bear checklist, paper trades with reasons, and IC votes. Three caveats apply to all of them. A student fund produces perhaps tens of decided pitches a year, so per-analyst numbers are noisy; show n and an interval on every number. No source gives a minimum sample for a calibration curve; real examples use 48 to 64 resolved questions and still found wide intervals ([Metaculus 2016](https://www.metaculus.com/news/2016/10/15/prediction-analysis/); [EA Forum](https://forum.effectivealtruism.org/posts/e9htD7txe8RDdcehm/exploring-metaculus-s-ai-track-record)). And any metric on a leaderboard invites gaming, so pair each with a counter-metric.

### Standard metrics to add first (not inventions)

Three decision-level metrics have real literature and should be labeled as standard. **PGR and PLR** measure the disposition effect: PGR = realized gains / (realized gains + paper gains), PLR the same for losses, and the effect is PGR > PLR; Odean's retail sample had PGR 0.148 and PLR 0.098 ([CFA Digest on Odean 1998](https://rpc.cfainstitute.org/-/media/documents/article/cfa-digest/1999/dig-v29-n2-469-pdf.pdf)). PIF can compute both from paper trading with daily position snapshots; show them as two bars per semester. **Selling skill vs random** follows Akepanidtaworn et al., who found institutional managers buy well but sell worse than a random-selling benchmark ([NBER w29076](https://nber.org/papers/w29076)): for each sale, compare the sold stock's next-period return with a randomly chosen holding that was kept; show the distribution as a histogram with zero marked. **Payoff ratio** (average gain on winners / average loss on losers) belongs next to every hit rate, since Essentia found only 18% of 76 managers had a hit rate above 50% while 68% made more when right than they lost when wrong ([Institutional Investor](https://www.institutionalinvestor.com/article/b1zsqjnqsxx2fd/Were-Those-Great-Returns-the-Result-of-Skill-or-Just-Luck)); that sample is Essentia's own clients.

### Pitch calibration report

**PIF's own metric (not an industry standard)**, built on standard parts. The Brier score and calibration buckets are already HAVE. The new pieces: the Murphy decomposition, BS = REL - RES + UNC, where reliability is miscalibration, resolution rewards forecasts that move with outcomes, and uncertainty depends only on outcomes ([Siegert, arXiv 1303.6182](https://arxiv.org/pdf/1303.6182)); wide buckets (for example 50 to 60, 60 to 75, 75+) with n and a binomial interval on each; pooling across semesters; and scoring each confidence revision, not just the first, since belief updating improved accuracy in the Good Judgment Project ([AI Impacts](https://aiimpacts.org/evidence-on-good-forecasting-practices-from-the-good-judgment-project/)). Data: pitches (confidence, horizon, base target), price history for outcomes, `lib/calibration.js`. Precedent: GJP, where a training module under an hour improved Brier scores by 6 to 11% over control ([Chang et al. 2016](https://dlab.sauder.ubc.ca/sjdm/journal/16/16511/jdm16511.html)). Visualize as a reliability diagram (stated vs observed, diagonal reference, interval whiskers, bubble size = n) plus a REL/RES bar pair per analyst. Pitfalls: decomposition terms are estimated by binning and carry their own error; an analyst can avoid Brier penalties by always saying 50%, which the resolution term exposes; small samples make per-analyst rankings mostly noise.

### Learning curve

**PIF's own metric (not an industry standard).** Formula: change in an analyst's Brier score from their first semester to later semesters (negative is better). Data: track record by analyst. Precedent: a St. Thomas study measured learning as the change in risk-adjusted returns between early and later decisions ([St. Thomas](https://researchonline.stthomas.edu/esploro/outputs/journalArticle/Using-Performance-Data-to-Evaluate-Student/991015131090403691)); GJP found practice improves accuracy. Visualize as a slope chart per analyst. Pitfalls: market regime changes between semesters; few pitches per semester; survivorship (members who stay longer may differ).

### Thesis health score

**PIF's own metric (not an industry standard).** At pitch time, require two to four pillars, each with a state-and-date check and the consensus number it disagrees with, plus kill criteria. Formula: H = sum(w_p x s_p) / sum(w_p), where s_p = 1 intact, 0.5 weakened, 0 broken at the latest check, and pillars past their check date with no review count as "unknown" and are shown separately rather than as intact. Any fired kill criterion sets a red flag until the IC records a decision. Data: pitches table (new pillar fields), notes, earnings and filing events tagged to pillars, IC votes. Precedent: Duke's "state and date" kill criteria ([Bobby Powers review of Quit](https://bobbypowers.net/review-quit/)), Mauboussin's decision journal ([Farnam Street](https://fs.blog/how-to-improve-the-quality-of-our-decision-making/)), Steinhardt's variant perception ([Acquirer's Multiple](https://acquirersmultiple.com/2021/12/michael-steinhardt-develop-a-variant-perception)). No public source shows how buy-side firms score pillars. Visualize as a per-holding row of pillar chips (green, amber, red, gray for unknown) and a 0 to 100 gauge on the holdings table. Pitfalls: pillar status is subjective and the pitch owner has an incentive to mark it intact, so a second member (or the red team) marks status; vague pillars are easy to keep, so each needs a checkable state.

### Promise-kept ratio

**PIF's own metric (not an industry standard).** Extract management commitments that have a checkable state and date (launch by Q3, capex of $X, margin target by FY27) from calls, 8-K exhibit 99 releases and MD&A, then check them when the date passes. Formula: P = kept / (kept + broken), counting only resolved, checkable promises; "dropped, never mentioned again" is its own status, not excluded. Show optimistic and pessimistic promises separately and show the spread, not only the ratio. Data: filing text via `lib/filingText.js`, transcripts once a source exists, LLM extraction with quote verification. Precedent: prior forecast accuracy strengthens price and analyst reactions to later forecasts ([Williams 1996, via citing paper](https://core.ac.uk/download/18443582.pdf)); investors discount optimistic forecasts but take bad-news forecasts at face value at first ([Knowledge at Wharton on Rogers & Stocken](https://knowledge.wharton.upenn.edu/article/how-credible-are-management-forecasts-not-very/)); consistency may matter more than accuracy ([HKUST Business Insight](https://bm.hkust.edu.hk/bizinsight/2016/11/consistency-more-useful-accuracy-earnings-forecasts)); LLMs can already extract CEO promises (74,017 found in over 69,000 transcripts) and stated targets from calls ([MetaTOC listing](https://metatoc.com/papers/120672-shaping-expectations-losing-flexibility-a-study-of-ceo-promises-as-strategic-communication-tools); [arXiv 2510.03195](https://arxiv.org/html/2510.03195v1)). No paper found scores promise fulfillment systematically. Visualize as a promise ledger table (promise, quote link, due date, status) and a timeline of kept vs broken by quarter. Pitfalls: companies choose easy promises; extraction errors, so a human reviews a sample before scores show; restrict to management statements, not analyst questions ([aifinhub note](https://aifinhub-monorepo.pages.dev/articles/prompt-patterns-earnings-calls/), practitioner blog); a candor-style score should not be presented as a return predictor, since the best-known candor ranking's track record is its founder's own claim ([CFA Institute Enterprising Investor](https://rpc.cfainstitute.org/blogs/enterprising-investor/2014/how-understanding-ceo-candor-can-make-you-money)).

### Variant perception score

**PIF's own metric (not an industry standard).** Formula: gap V = (analyst base target - consensus target at pitch) / price at pitch; outcome credit C = (abs(actual - consensus target) - abs(actual - analyst target)) / price at horizon. Positive C means the analyst was closer than the Street. Show V only next to C. Data: pitch targets, Street consensus snapshot at pitch time (needs to be stored), price at horizon. Precedent: Steinhardt's variant perception and Mauboussin and Rappaport's reverse DCF reading of expectations ([Motley Fool Q&A](https://www.fool.com/investing/2022/01/19/expectations-investing-qanda-mauboussin-rappaport)). Visualize as a scatter: x = V, y = C, quadrants labeled. Pitfalls: on its own V rewards contrarianism; consensus targets for small caps can be thin or missing.

### Catalyst hit rate and time-to-thesis-check

**PIF's own metrics (not industry standards).** Catalyst hit rate = catalysts that happened by their stated date / catalysts whose date has passed, reported next to the average price reaction, since a catalyst can occur with no price effect. Time-to-thesis-check = median days between a pillar's check date and the date someone recorded a review; a pure discipline metric. Data: pitch catalyst and pillar fields, notes, review log. Precedent: Duke's state-and-date criteria ([Bobby Powers](https://bobbypowers.net/review-quit/)); UConn's weekly per-stock updates ([UConn SMF](https://smf-business.media.uconn.edu/wp-content/uploads/sites/818/2025/01/SMF-Team-White-Fall-2024-Long-Report.pdf)). Visualize the hit rate as a stacked bar (happened on time, late, did not happen) and time-to-check as a box plot by owner. Pitfalls: members may name only safe catalysts (scheduled earnings); a quick "still fine" review games time-to-check, so require a sentence of evidence.

### Pre-mortem hit rate

**PIF's own metric (not an industry standard).** For pitches that resolved wrong, the share where the actual failure reason matches an item in the pre-mortem. A second member judges the match; an LLM can suggest it with quotes. Data: pre-mortem field, post-mortem notes. Precedent: Klein's premortem, which Mauboussin credits with surfacing more problems than other methods ([Acquirer's Multiple](https://acquirersmultiple.com/2020/07/michael-mauboussin-perform-a-premortem-before-you-invest)); no source measures this outcome. Visualize as a bar per semester with n. Pitfalls: long, generic pre-mortems "hit" more often, so cap the list at five specific items; hindsight matching.

### Red-team survival rate

**PIF's own metric (not an industry standard).** Share of red-team objections rated material that the pitch author answered with evidence before the vote, and, over time, whether pitches with unanswered material objections underperform. Data: red-team agent output (Section 8), author responses, outcomes. Precedent: premortem research ([Acquirer's Multiple](https://acquirersmultiple.com/2020/07/michael-mauboussin-perform-a-premortem-before-you-invest)); TradingAgents' bull/bear debate, whose evidence is backtest only ([arXiv 2412.20138](https://arxiv.org/html/2412.20138v4)). Visualize as an objection checklist on the pitch page and a two-bar outcome comparison. Pitfalls: authors can "answer" objections with words; the AI red team can raise weak objections that inflate the count.

### Conviction resolution and idea decay

**PIF's own metrics (not industry standards).** Conviction resolution = Spearman correlation between stated confidence % (or position size) and realized excess return; equivalently, the excess return of the top-third confidence pitches minus the bottom third. This is the resolution idea from the Brier decomposition applied to returns. Idea decay = average excess return of pitched names vs the benchmark by month since pitch, in event time. Data: pitches, prices, positions. Precedent: Essentia's sizing and scaling decision types ([Global Trading](https://www.globaltrading.net/?p=29575)); the idea-decay curve has no collected source. Visualize conviction as a scatter with a fitted line, idea decay as a cumulative excess return curve with a confidence band. Pitfalls: tiny samples; overlapping horizons make returns correlated.

### Thesis drift flag

**PIF's own metric (not an industry standard).** Flag a holding when the stated reason for holding it in weekly updates no longer matches the original pillars and no new pitch was filed. An LLM compares the latest update with the pillars and quotes both. Precedent: decision journals make drift visible because the original reasons are written down ([Farnam Street](https://fs.blog/how-to-improve-the-quality-of-our-decision-making/)); no source names or measures thesis drift. Visualize as an amber "drift" badge with side-by-side quotes. Pitfalls: legitimate updates look like drift; LLM judgment needs a human decision.

### Alert acceptance and AI acceptance rates

**PIF's own metrics (not industry standards).** Alert acceptance = alerts opened or acted on / alerts delivered, per type per quarter. AI acceptance = agent findings accepted / (accepted + overridden + discarded), per agent, plus the share of citations that passed verification. Precedent: the clinical alert-fatigue literature measures override and acceptance rates ([Ray, Wilson et al. 2026](https://www.metrohealth.org/globalassets/metrohealth-documents/population-health-research-institute/ray-wilson-et-al-2026-alert-fatigue-systematic-review.pdf), search snippet only); Google SRE's review of pages ([SRE book](https://sre.google/sre-book/monitoring-distributed-systems/)). Visualize as a table per type with a sparkline. Pitfalls: members click to clear the inbox, which inflates "opened"; count "acted" (note, vote, review) separately.

### Alpha per hour of research

**PIF's own metric (not an industry standard)**, lowest priority. It needs self-reported hours, which are unreliable, and the sample is tiny. Skip it unless the fund wants it for recruiting stories.

## 8. The agentic system: events, a code router, narrow tools and verified citations

The November 12 proposal sketched seven agents, an events table, a rules-based router and the right rails (code does the math, every claim is cited and quote-checked, agents run only on events, members decide). This section keeps those rails and fills in what it left open: what the evidence says agents can do in finance, a target architecture, a model and cost comparison, a full tool catalog over PIF's data sources, and a larger set of workflows built on that catalog.

### 8.1 What agents can and cannot do on filings today

The best published score on realistic SEC-filing research tasks is **64.37%** (Claude Opus 4.7 on the Vals AI Finance Agent benchmark, version 1.1, updated June 4, 2026, 537 questions built with Stanford researchers and a large bank), so roughly one in three entry-level analyst tasks still fails, at $0.59 to $1.44 and 4.5 to 10 minutes per task among the top five models ([Vals AI Finance Agent](https://www.vals.ai/benchmarks/finance_agent)). That leaderboard predates the 5.5-generation Claude models and the gpt-6 models, and no official score for them was found. FinanceBench shows that retrieval design matters more than model choice: the same GPT-4-Turbo answered **19% correctly with a shared vector store, 50% with a per-document store, 79% with the whole filing in long context and 85% when handed the right page**, and even that "oracle" setup was wrong 15% of the time ([FinanceBench](https://arxiv.org/html/2311.11944)). Return-prediction claims are weaker than they look: the LLM news signal fades as adoption rises ([Lopez-Lira & Tang](https://arxiv.org/abs/2304.07619v5)), the best-known financial-statement paper is withdrawn (Section 4), and multi-agent trading systems such as TradingAgents report gains only in historical backtests ([arXiv 2412.20138](https://arxiv.org/html/2412.20138v4)).

Four design rules follow. Scope retrieval to one filing or pass the whole relevant section in long context; never run a cross-company vector index for filing questions. Never show a number from model text as fact unless it matches a tool result or a verbatim quote. Present every agent output as a research aid with its evidence, never as a signal. Keep a human decision between any agent output and any change to the fund.

### 8.2 Target architecture

Anthropic's guidance separates **workflows** (models and tools run through code-defined paths) from **agents** (models that choose their own tool calls in a loop), and recommends the simplest option that works, because agents use about 4 times the tokens of chat and multi-agent systems about 15 times ([Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents); [Anthropic: multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)). For PIF that means most "agents" are workflows: triage, filing briefs, earnings flash, weekly memo and the macro brief follow fixed steps. Only Ask PIF, the screener scout, the red team and deep research on a new name need an open tool loop.

```
Sources (EDGAR feeds, 13F live, FINRA, Finnhub, Yahoo cache, FRED, USAspending, House/Senate, internal app writes)
   |
   v
[1] Event intake (code)  ->  events table: id, ticker, type, item codes, source_url, as_of, dedupe key, tier
   |
   v
[2] Router (plain code rules)  ->  picks a workflow, model tier and budget; most events end here as a digest row
   |
   v
[3] Workflows and agents  ->  call tools only through [4]; each run is a job row with steps, tool calls, tokens, cost, status
   |
   v
[4] Tool layer over lib/  ->  typed functions returning {data, source_url, as_of, cached}; shared rate limiter; read-only by default
   |
   v
[5] Verification (code)  ->  quote match against cached source text, number match against tool results, schema validation
   |
   v
[6] Outputs  ->  cards, briefs, inbox items with "verified" badges; writes go to an approval queue
   |
   v
[7] Memory  ->  per-holding dossier updated only from verified, member-accepted outputs
```

**Events and router.** Every upstream change becomes one events row with a dedupe key (ticker, event type, day), which also implements the "one card per ticker per day" rule from Section 6. The router is plain code: 8-K item codes, z-score thresholds, IPS rules and calendar dates decide the tier and the workflow. An LLM may propose an escalation for free-text items (news, 8.01 filings) but cannot send a push on its own; a push needs a rule match. This is the routing pattern from Anthropic's guide, and it keeps cost proportional to events rather than to time.

**Job records and checkpoints.** Agents are stateful and errors compound, so Anthropic resumes long runs from checkpoints and traces every run ([Anthropic: multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)). A `agent_runs` table (workflow, trigger event, step, tool calls, tokens, cost, status, output id) gives PIF resume, audit and the cost log in one place. Long jobs run in the background with a status row and a notification, which suits a single Render instance. If PIF adopts the OpenAI Agents SDK, note that one practitioner report says its built-in tracer writes to OpenAI's platform rather than yours ([DEV Community](https://dev.to/gabrielanhaia/the-openai-agents-sdk-in-production-what-it-gives-you-and-what-it-hides-16a9)); keep PIF's own trace table either way.

**Tool layer over existing code.** Tools are thin wrappers over functions already in `lib/` (for example `fundamentals.js`, `filingDiff.js`, `insiderSignals.js`, `thirteenFBreadth.js`, `shortPressure.js`, `govContracts.js`, `congressTrades.js`, `calibration.js`, `backtest.js`). Each returns `{data, source_url, as_of, cached}`, copying sec-edgar-mcp's practice of returning filing URLs for verification and lzinga's `meta.sources` ([sec-edgar-mcp](https://github.com/stefanoamorelli/sec-edgar-mcp); [us-gov-open-data-mcp](https://github.com/lzinga/us-gov-open-data-mcp)). Tool descriptions get the same care as a UI: examples, edge cases, strict inputs ([Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)); Anthropic reports a rewritten tool description cut task time by 40% in its research system. All SEC calls go through `lib/fetchWithLimit.js` with one shared token bucket under SEC's 10 requests per second, because several agent runs at once could otherwise burst past it ([SEC: Accessing EDGAR Data](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data)). Agents never call Yahoo directly in loops; they read the cached price layer (`lib/prices.js`), because Yahoo has no official public market-data API and its terms reserve rate limits at its discretion ([Yahoo API terms](https://legal.yahoo.com/us/en/yahoo/terms/product-atos/apiforydn/index.html)). Once the catalog passes about 30 tools, switch to a small discovery surface (`find_tool`, `call_tool`) or give each agent role only its own tools, as Massive's MCP and lzinga's server do ([mcp_massive](https://github.com/massive-com/mcp_massive)).

**An MCP server for the app.** Exposing the read-only tools as a PIF MCP server lets the in-app agents, Claude Code, Claude's apps and OpenAI's Responses API (which accepts a remote MCP `server_url`) share one tool definition ([OpenAI: Connectors and MCP](https://developers.openai.com/api/docs/guides/tools-connectors-mcp), search snippet only). The MCP revision dated 2026-07-28 drops the protocol-level session, so a remote server is a plain HTTP service behind any load balancer, and authorization is optional, with OAuth 2.0 Protected Resource Metadata required when it is used ([MCP spec: Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization); [MCP blog](https://blog.modelcontextprotocol.io/posts/2026-07-28/)). Secondary sources disagree on whether that revision is final, so check the changelog before building. For PIF: members-only auth, read-only tools only, no write tools over MCP, and the same rate limiter. FactSet and S&P both expose data to agents through MCP now ([The AI Innovator](https://theaiinnovator.com/inside-factsets-push-to-build-an-agentic-future/); [A-Team Insight](https://a-teaminsight.com/blog/sp-global-bets-on-agent-native-architecture-as-capital-iq-pro-consolidation-accelerates/?brand=ati)), so this matches where the industry is going.

**Memory per holding.** FinMem's design pairs a short working memory with layered long-term memory sorted by recency and importance ([FinMem](https://arxiv.org/pdf/2311.13743.pdf)). PIF's version is a per-holding dossier: thesis pillars with status history, kill criteria, the promise ledger, accepted agent findings (with citations), open questions, the last N member decisions (accept, override, discard) and a short running summary rewritten after each accepted change. Agents read the dossier first and the raw sources second. Only verified, member-accepted outputs enter memory, so one bad brief cannot poison later runs. Keep memory in `pif.db`, not in a vendor's hosted thread.

**Citations and number checks.** Two paths work. On the current OpenAI path, every brief's JSON schema has quote fields, and server code checks each quote appears verbatim (after whitespace normalization) in the cached filing text; misses are dropped or flagged. On Anthropic's API, the Citations feature guarantees valid pointers into supplied documents and does not bill `cited_text` as output tokens, but **citations cannot be combined with structured outputs**, so a brief needing both runs as a cited prose pass followed by a JSON extraction pass ([Claude docs: Citations](https://platform.claude.com/docs/en/build-with-claude/citations)). Anthropic's own research system uses a separate citation step after the research is done ([Anthropic: multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)). Numbers follow one rule: code computes them from XBRL or price data, the model only narrates, and any number in model text that does not match a tool result gets flagged in the UI. Like ASKB returning BQL, every Ask PIF answer shows the tool calls or SQL it ran.

**Evals.** Anthropic started its research-agent evals with about 20 real queries, because large effects show in small samples, and used one LLM-judge prompt returning a 0 to 1 score plus pass/fail on factual accuracy, citation accuracy, completeness, source quality and tool efficiency ([Anthropic: multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)). PIF should write 20 to 50 golden questions per workflow from real holdings, each with an answer and an evidence quote, run them on every prompt or model change and nightly, store scores next to cost in the database, and add human review for whatever the judge misses. Bloomberg evaluates per sub-agent and per full workflow the same way ([Fortune](https://fortune.com/2026/04/28/bloomberg-askb-ai-agents-lessons-from-bloomberg-cto-shawn-edwards-eye-on-ai/)). Members' accept/override rates (Section 7) are the live eval.

**Cost caps.** The levers are model tiering, prompt caching (put the stable system prompt, fund policy, holdings list and schema first; the changing filing text last), Batch for anything overnight (50% off at both vendors), programmatic tool calling to keep intermediate tool output out of context, and avoiding multi-agent fan-out except for deep research ([Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing); [OpenAI pricing](https://developers.openai.com/api/docs/pricing); [Claude docs: Programmatic tool calling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling)). Enforce a per-member daily budget for Ask PIF and deep research, and a fund-wide monthly cap read from the existing per-call cost log, before opening chat to all members. The router should refuse new runs, not just warn, once the cap is hit.

**Prompt-injection defenses.** OWASP's LLM01 separates direct injection from indirect injection through external content such as a filing or web page, and lists the mitigations: constrain behavior in the system prompt, validate outputs in code, filter inputs and outputs, keep privileged functions in code, require human approval for high-risk actions, segregate and label untrusted content, and test adversarially ([OWASP LLM01](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)). For PIF: wrap every filing, news item, chat message and disclosure in labeled "untrusted data" blocks; give any agent that reads external text read-only tools only; route every write (note, thesis status, alert, paper trade, message) to an approval queue; and do not attach third-party MCP servers to agents that see member data, since OpenAI warns a malicious MCP server can exfiltrate anything in the model's context ([OpenAI: Connectors and MCP](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)). Anthropic's programmatic tool calling is not zero-data-retention eligible (data retained up to 30 days), which matters if member notes or chat flow through it ([Claude docs: Programmatic tool calling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling)).

**Data-use limits.** Senate and House financial disclosure reports carry a statutory restriction against commercial use and solicitation, with a civil penalty up to $10,000 ([5 U.S.C. § 13107](https://www.law.cornell.edu/uscode/text/5/13107); [Senate eFD](https://efdsearch.senate.gov/search/home/)). Tools over Congress trades should be labeled internal research, and those pages should not be monetized. This is a reading of the statute, not legal advice; a faculty adviser or Pitzer counsel should confirm.

### 8.3 Providers and models

Both vendors' official pricing pages (fetched November 13, 2026) give these per-million-token prices. Anthropic's page says prompts over 100,000 tokens cost more only on Haiku 5.5; other 4.6-and-later models include 1M-token context at standard price ([Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing); [OpenAI pricing](https://developers.openai.com/api/docs/pricing)).

| Model | Input | Cached input (hit) | Output | Batch in / out | Fit for PIF |
|---|---|---|---|---|---|
| Claude Fable 5.2 | $8 | $0.20 | $40 | $4 / $20 | Hard to justify on a student budget |
| Claude Opus 5.5 | $4 | $0.20 | $20 | $2 / $10 | Weekly memo editor, deep-research lead |
| Claude Sonnet 5.5 | $2 | $0.10 | $10 | $1 / $5 | Briefs, red team, Ask PIF |
| Claude Haiku 5.5 (prompt up to 100K tokens) | $0.10 | $0.01 | $0.50 | $0.05 / $0.25 | Triage, extraction, NL-to-filter |
| Claude Haiku 5.5 (prompt over 100K tokens) | $0.50 | $0.05 | $2.50 | $0.25 / $1.25 | Avoid: a full 10-K can cross this line |
| gpt-6-astra | $10.00 | $1.00 | $50.00 | $5.00 / $25.00 | Not needed |
| gpt-6.1-sol | $2.00 | $0.10 | $10.00 | $1.00 / $5.00 | Mid tier, same list price as Sonnet 5.5 |
| gpt-6.1-terra | $1.00 | $0.05 | $5.00 | $0.50 / $2.50 | Option between tiers |
| gpt-6-luna (current app model) | $0.10 | $0.01 | $0.50 | $0.05 / $0.25 | Triage, same list price as Haiku 5.5 short prompts |

Cache writes cost extra on Anthropic (for Opus 5.5, $5 for a 5-minute write and $8 for a 1-hour write vs $4 base input), and web search is $10 per 1,000 searches on both platforms. Because gpt-6-luna and Haiku 5.5 have identical short-prompt prices, choosing a provider for the cheap tier is a feature decision, not a cost decision: OpenAI's strict `json_schema` (already used) against Anthropic's native citations and programmatic tool calling. A sensible split is cheap tier for triage and extraction, mid tier for briefs and chat, top tier only for the weekly editor and deep-research lead, which mirrors Anthropic's Opus-lead, Sonnet-worker research setup and Bloomberg's cheapest-model routing. The router can use both providers, with the provider recorded per run.

The following is illustrative arithmetic using the official prices above; the token counts are assumptions, not measurements. A 10-K change brief that reads 80,000 input tokens and writes 2,000 output tokens costs 80,000 x $2/M + 2,000 x $10/M = $0.16 + $0.02 = **$0.18 on Sonnet 5.5, or $0.09 on Batch**; one 10-K per holding per year for 39 holdings is then about $3.51 a year on Batch. Thirty triage calls a day of 3,000 input and 300 output tokens each on gpt-6-luna cost 90,000 x $0.10/M + 9,000 x $0.50/M, about $0.0135 a day. The Haiku 5.5 threshold is a cliff: a 99,000-token prompt costs about $0.0099 in input, while a 120,000-token prompt costs $0.06, about six times more, so long documents should go to the mid tier or be split by section. Vals' $0.59 to $1.44 per agentic research task gives an order of magnitude for deep research runs. The November 12 proposal's $152.43 a month for 10 members came from that page's own assumptions and was not rechecked here.

### 8.4 Build in Node, borrow designs from existing MCP servers

The credible maintained projects are EdgarTools (MIT, 2,850 stars, Python, local and hosted MCP, covers full-text search, XBRL, Forms 3/4/5, 13F, N-PORT and 13D/G), Alpha Vantage's official remote MCP (MIT, free 25 requests a day), Massive's MCP (MIT), Alpaca's MCP for paper trading (MIT, 1,082 stars), OpenBB's `openbb-mcp-server`, and lzinga's `us-gov-open-data-mcp` (MIT, TypeScript, 300+ tools over 40+ government APIs, with its own warning that AI scaffolded it and some endpoints may misbehave) ([edgartools](https://github.com/dgunning/edgartools); [alpha_vantage_mcp](https://github.com/alphavantage/alpha_vantage_mcp); [mcp_massive](https://github.com/massive-com/mcp_massive); [alpaca-mcp-server](https://github.com/alpacahq/alpaca-mcp-server); [OpenBB](https://github.com/OpenBB-finance/OpenBB); [us-gov-open-data-mcp](https://github.com/lzinga/us-gov-open-data-mcp)). Two popular servers, sec-edgar-mcp and fred-mcp-server, are **AGPL-3.0**, so copying their code into a hosted app can trigger source-sharing duties; reading their tool lists is fine ([sec-edgar-mcp](https://github.com/stefanoamorelli/sec-edgar-mcp); [fred-mcp-server](https://github.com/stefanoamorelli/fred-mcp-server)). Financial Datasets' MCP is popular but needs a paid key and was last pushed June 5, 2025 ([financial-datasets/mcp-server](https://github.com/financial-datasets/mcp-server)).

PIF already has working Node clients for SEC, FRED, Finnhub, Yahoo, FINRA, USAspending and the House and Senate sites, so the practical path is to wrap `lib/` as tools in Node and avoid a second Python process on Render. Two exceptions are worth considering: EdgarTools as an offline job (not a live dependency) for parsing PIF does not do yet, such as 13D/G XML, N-PORT and proxy sections; and lzinga's typed TypeScript clients imported as a library for the government long tail, after spot-checking each endpoint. Two sources moved in the past year: the Senate lobbying API now answers at `lda.gov` (the old host returned 503) and PatentsView's API redirects to a USPTO transition guide ([lda.gov API](https://lda.gov/api/); [USPTO transition guide](https://data.uspto.gov/support/transition-guide/patentsview)). That is why every tool returns the URL it called and why a source-health check belongs in the workflow list.

### 8.5 Tool catalog

Tool names and designs are proposals. "EXISTING" means the app already calls that source today; "NEW" means a new source; "PIF code" means a wrapper over an app feature that already exists ("have") or a new computation ("new"). Every tool returns `{data, source_url, as_of, cached}`. Read-only unless marked. Ticker examples come from the research notes' holdings coverage check.

#### A. SEC EDGAR (EXISTING; free, no key, 10 requests/s with a declared User-Agent)

| Tool | Inputs | Output | Data source | Source | Purpose | How it helps PIF |
|---|---|---|---|---|---|---|
| `resolve_company` | ticker or name | CIK, name, exchange, SIC | `company_tickers_exchange.json` | EXISTING | Map tickers to CIKs | Every SEC tool needs a CIK |
| `get_filing_history` | ticker, forms[], since | accession, form, date, items, document URL | submissions JSON | EXISTING | List filings | "What did HOOD file since our last meeting?" |
| `get_8k_events` | tickers[], items[], since | 8-Ks with decoded item names and tier | submissions `items` field | EXISTING | Typed event feed | Drives the 8-K tiers in Section 6 without reading text |
| `get_latest_filings_feed` | form, count | newest filings | EDGAR Atom feed | EXISTING | Near-real-time intake | Event intake for holdings and watchlist |
| `get_form_index` | date or quarter, form | index rows | daily and full index | EXISTING | Backfill | Gap check after downtime |
| `get_financial_concept` | ticker, concept, unit | values with fy, fp, form, filed date | companyconcept | EXISTING | Point-in-time fundamentals | The filed date shows when a number became public |
| `get_company_facts_summary` | ticker, concepts[] | latest annual and quarterly values | companyfacts (`fundamentals.js`) | EXISTING | Fundamentals card | Pitch fact sheet |
| `get_xbrl_frame` | concept, unit, period | one value per filer | frames API | EXISTING | Cross-section | Universe for the screener and peer ranks |
| `rank_peers` | ticker, concepts, period, peer set | percentile, rank, table | several frames calls | EXISTING | Peer ranking | "Where does STRL's growth rank among all filers?" |
| `get_market_cap_universe` | period | shares outstanding x price per filer | frames `dei/EntityCommonStockSharesOutstanding` plus price cache | EXISTING | Market caps | Fixes best-ideas ranking (Section 5); screener size filters |
| `get_pay_vs_performance` | ticker or SIC, year | CEO pay, compensation actually paid, TSR, peer TSR | companyfacts `ecd` concepts; frames `ecd/PeoActuallyPaidCompAmt` | EXISTING | Governance | Flags pay out of line with returns |
| `search_filings_fulltext` | query, forms[], dates, ciks[] | hits with snippet and URL | `efts.sec.gov` full-text search | EXISTING | Theme and keyword search | Keyword alerts and the qualitative screener |
| `get_filing_text` | accession, section | clean section text | `filingText.js` | EXISTING | Read one document | Single-document scope for Q&A (FinanceBench rule) |
| `diff_filing_sections` | ticker, form, section | added and removed sentences, similarity | `filingDiff.js` | EXISTING | Lazy Prices diff | "What changed in META's risk factors?" |
| `get_insider_trades` | ticker, since, codes | Form 4 rows with role, code, price, 10b5-1 flag | Form 4 XML; Insider Transactions Data Sets | EXISTING | Insider history | Feeds the improved insider score |
| `get_form144_notices` | ticker, since | planned sales | Form 144 filings | EXISTING (new form) | Early warning | Seen before the Form 4 |
| `get_13f_holders` | ticker, quarter | holders, shares, value, change | live 13F ingest (`thirteenFLive.js`) | EXISTING | Ownership | Crowding and breadth context |
| `get_13f_filer_portfolio` | filer CIK, quarter | holdings with weights and overweights | 13F plus market caps | EXISTING | Manager view | Corrected best ideas |
| `get_beneficial_owners` | ticker, since | 13D/13G filers, percent, Item 4 purpose | Schedule 13D/G XML | EXISTING | Activists | `activistFilings.js` could move to XML parsing |
| `get_fund_holdings_nport` | fund or ETF, period | holdings and weights | N-PORT data sets | EXISTING (new data set) | Look-through | X-Ray-style overlap for PIF's ETFs |
| `get_statement_notes` | quarter, accession, tags | note values (leases, segments) | Financial Statement and Notes data sets | EXISTING (new data set) | Off-face items | Segment revenue, lease detail |
| `get_proxy_section` | ticker, year, section | excerpt plus URL | DEF 14A via `filingText.js` | EXISTING | Governance | Student governance write-ups |
| `get_customer_concentration` | ticker | named 10% customers with percent | `supplyChain.js` | PIF code (have) | Supply chain | Second-order monitor in 8.6 |

#### B. Market data (EXISTING Yahoo and Finnhub; NEW fallbacks)

| Tool | Inputs | Output | Data source | Source | Purpose | How it helps PIF |
|---|---|---|---|---|---|---|
| `get_price_history` | ticker, range, interval | OHLCV | Yahoo via `prices.js` cache | EXISTING | Prices | Every return, z-score and chart |
| `get_quote_summary` | ticker, modules | profile, estimates, holders | Yahoo quoteSummary | EXISTING | Estimates, key stats | Revisions, dispersion proxy |
| `get_estimate_snapshot` | ticker, date | stored revision counts, high/low/mean | new daily snapshot table | PIF code (new) | Point-in-time estimates | Makes revisions backtestable |
| `get_company_news` | ticker, since | headlines | Finnhub | EXISTING | News | Triage input |
| `get_earnings_calendar` | dates, tickers | dates, EPS estimates | Finnhub | EXISTING | Calendar | Earnings workflows |
| `get_basic_metrics` | ticker | valuation and margin metrics | Finnhub | EXISTING | Quick screens | Cross-check XBRL numbers |
| `get_options_positioning` | ticker | existing options view | app options module | PIF code (have) | Positioning | Red team context |
| `get_earnings_transcript` | ticker, quarter | transcript text | Alpha Vantage `EARNINGS_CALL_TRANSCRIPT` (25/day free; coverage unverified) | NEW | Transcripts | Call recap and promise extraction |
| `get_eod_prices_fallback` | ticker, date | EOD bar | Massive Basic (5 calls/min) or Alpha Vantage | NEW | Backup | If Yahoo breaks |
| `get_screener_export` | Finviz screen | CSV rows | Finviz Elite export ($299.50/yr) | NEW | Whole-market prices and filters | Only if the fund pays and terms allow |

#### C. Short interest and market structure (EXISTING FINRA CDN; NEW keyless query API)

| Tool | Inputs | Output | Data source | Source | Purpose | How it helps PIF |
|---|---|---|---|---|---|---|
| `get_short_interest` | ticker, periods | position, change, DTC, settlement and publication dates | FINRA `consolidatedShortInterest` | NEW | Positions | Replaces Yahoo DTC |
| `get_short_volume` | ticker, days | daily short volume ratio | FINRA Reg SHO files (`finra.js`) | EXISTING | Flow | Shown separately from positions |
| `get_cot_positioning` | market, weeks | net positions by trader type | CFTC Socrata | NEW | Commodity positioning | Crude and gas for XOM, TALO; cocoa for HSY |

#### D. Macro and rates (EXISTING FRED and Fed; NEW Treasury, BLS, BEA, Census, EIA)

| Tool | Inputs | Output | Data source | Source | Purpose | How it helps PIF |
|---|---|---|---|---|---|---|
| `get_fred_series` | series id, dates, transform | observations | FRED `series/observations` | EXISTING | Macro | DGS10, T10Y2Y, HY OAS on the macro page |
| `get_fred_vintage` | series id, as-of date | series as known then | ALFRED real-time periods | EXISTING | Point-in-time macro | Honest macro backtests |
| `list_fred_vintage_dates` | series id | revision dates | `series/vintagedates` | EXISTING | Revisions | Shows how much payrolls or GDP got revised |
| `search_fred` | text | series ids | FRED search | EXISTING | Discovery | Agent finds series instead of guessing |
| `get_macro_regime` | none | curve slope, HY spread, inflation trend with labels | FRED composite | PIF code (new) | One-line context | Macro line in every pitch |
| `get_fomc_calendar` | year | meetings | `fed.js` | EXISTING | Event risk | Rate-sensitive names |
| `get_fed_press_releases` | since | releases | Fed RSS | EXISTING | Fed news | Statement alerts |
| `diff_fed_statement` | meeting date | sentence diff vs prior statement | Fed press release text | EXISTING | Teaching | Macro analyst briefing |
| `get_yield_curve` | date or range | par yields 1 month to 30 years | Treasury daily CSV, no key | NEW | Curve | DCF discount-rate input |
| `get_curve_change` | two dates | bp change by tenor | same | NEW | Moves | Explains long-duration tech and utility moves |
| `get_fiscal_data` | dataset, filters | rows | Fiscal Data API, no key | NEW | Fiscal context | Meeting topics |
| `get_bls_series` | series ids, years | values | BLS v2 (free key, 500 queries/day) | NEW | CPI, payrolls | Macro page |
| `get_cpi_components` | components | YoY by component | BLS | NEW | Pricing power | HSY, COST, WMT, TJX |
| `get_bea_table` | table, frequency, years | rows | BEA (free UserID) | NEW | GDP, PCE | Consumer names |
| `get_retail_sales` | NAICS, months | monthly sales | Census EITS (key required) | NEW | Retail demand | COST, WMT, TJX |
| `get_construction_spending` | category | monthly value | Census EITS | NEW | Construction demand | STRL |
| `get_grid_demand` | grid operator, dates | hourly demand and generation | EIA `v2/electricity/rto` (free key) | NEW | Power demand | Data-center load context for CEG |
| `get_oil_gas_prices` | product, period | spot prices | EIA (route names to confirm) | NEW | Energy drivers | XOM, TALO |

#### E. Government, policy and regulatory (EXISTING USAspending and House/Senate; NEW others)

| Tool | Inputs | Output | Data source | Source | Purpose | How it helps PIF |
|---|---|---|---|---|---|---|
| `get_federal_awards` | recipient, since, type | awards, amounts, agencies | USAspending (`govContracts.js`) | EXISTING | Contracts | PLTR, ORCL, STRL, WM government revenue |
| `get_award_trend` | recipient, years | obligations by year and agency | USAspending | EXISTING | Trend | Is PLTR's government revenue growing? |
| `get_congress_trades` | ticker or member, since | trades with ranges and lag | House Clerk, Senate eFD (`congressTrades.js`, `senateDisclosures.js`) | EXISTING | Disclosures | Labeled internal research under the statute |
| `get_member_committee_overlap` | ticker | trading members on relevant committees | trades plus committee lists | EXISTING plus list | Conflicts | Teaching tool, same restriction |
| `get_lobbying` | client, years | filings, amounts, issues, agencies | `lda.gov/api/v1/filings` | NEW | Policy exposure | ORCL, META, GOOG, HOOD, SOFI, APO |
| `get_pac_activity` | committee, cycle | receipts, disbursements | OpenFEC (api.data.gov key, 1,000/hr) | NEW | Political spending | Governance context, not a signal |
| `search_federal_register` | term, agencies, type, since | rules, comment deadlines, links | Federal Register API, no key | NEW | Rules | EPA for WM, FERC/NRC for CEG, SEC/CFPB for HOOD, SOFI |
| `get_adverse_events` | drug, since | counts by reaction | openFDA (key optional) | NEW | Drug safety | GLP-1 context for HIMS |
| `get_drug_shortages` | drug | shortage status | openFDA (endpoint not probed) | NEW | Compounding risk | Core HIMS risk |
| `get_fda_enforcement` | firm or product | recalls, enforcement | openFDA (not probed) | NEW | Regulatory risk | HIMS, HSY, CELH |
| `get_clinical_trials` | sponsor, status | studies, phase, completion dates | ClinicalTrials.gov v2, no key | NEW | Catalysts | Competitor trials (Novo, Lilly) for HIMS |
| `get_patent_grants` | assignee, since | grants by class | USPTO Open Data Portal (endpoint unverified) | NEW | Innovation | NVDA, GOOG, META, ORCL |

#### F. Factor, valuation and attention data (NEW, free)

| Tool | Inputs | Output | Data source | Source | Purpose | How it helps PIF |
|---|---|---|---|---|---|---|
| `get_ff_factors` | model, frequency | factor returns | French library CSVs | NEW | Factor returns | Regressions in Section 4 |
| `get_industry_portfolios` | count, frequency | industry returns | French library | NEW | Benchmarks | Sector attribution check |
| `get_damodaran_industry` | industry, metric | beta, WACC, margins, multiples | Damodaran datasets | NEW | Sanity bands | Flags pitch inputs far from industry |
| `get_implied_erp` | month | ERP and alternatives | Damodaran monthly file (filename pattern undocumented) | NEW | WACC input | Dated ERP in the DCF |
| `get_wikipedia_pageviews` | article, dates | daily views | Wikimedia API, no key | NEW | Attention | Crowding monitor |
| `get_attention_spike` | ticker | z-score vs 90-day baseline | same | PIF code (new) | Spike detection | Unusual attention before earnings |
| `get_news_volume` | query, span | article count, tone | GDELT (one request per 5 s) | NEW | News flow | Context beyond Finnhub |
| `get_github_activity` | org or repo | stars, commits over time | GitHub REST | NEW | Developer traction | NVDA, META, GOOG |
| `get_app_rank` | app id | chart rank | Apple marketing RSS | NEW | Consumer traction | HOOD, SOFI, HIMS (rank only, not downloads) |

#### G. PIF internal: portfolio, research and process (PIF code)

| Tool | Inputs | Output | Data source | Source | Purpose | How it helps PIF |
|---|---|---|---|---|---|---|
| `get_portfolio` | date | holdings, weights, cost, cash, time frames | `portfolio.js` | PIF code (have) | Ground truth | Every answer starts from the real book |
| `get_performance` | range | TWR, beta, Sharpe, IR, drawdown, contribution | `analytics.js`, `benchmarks.js` | PIF code (have) | Results | Weekly memo, Ask PIF |
| `get_ips_status` | none | each rule, value, limit, breach, days left to cure | IPS checks | PIF code (have, add cure clock) | Compliance | Push alerts and IC page |
| `simulate_trade_ips` | ticker, side, amount | before/after weights, sector drift, beta, TE, IPS results | portfolio plus risk tools | PIF code (new) | Pre-trade | Attached to every IC vote |
| `compute_factor_exposure` | ticker or portfolio, window | betas, SEs, CIs | French factors plus prices | PIF code (new) | Exposures | Replaces percentile-only view |
| `compute_brinson` | period | allocation, selection, interaction by sector | holdings plus sector ETFs | PIF code (new) | Attribution | Weekly brief, commentary agent |
| `compute_tracking_error` | window | ex-ante TE, contribution to risk | prices, factor model | PIF code (new) | Risk | Weekly brief |
| `compute_var` | window, confidence | historical VaR and expected shortfall | prices | PIF code (new) | Risk | Risk section |
| `run_scenario_replay` | scenario (2008, 2020, 2022) | portfolio P&L under past moves | prices | PIF code (new) | Stress | Meeting discussion |
| `compute_move_zscore` | ticker, date | raw, idiosyncratic, sector-relative z | prices, SPY, sector ETFs | PIF code (new) | Move alerts | Section 6 tiers |
| `run_dcf` / `run_reverse_dcf` | ticker, inputs | value, sensitivity grid, implied growth | DCF workbench | PIF code (have) | Valuation | Red team, pitch drafts |
| `compute_ev_bridge` | ticker | each EV component with source tag | XBRL plus price | PIF code (new) | EV transparency | Explains Yahoo vs XBRL gaps |
| `compute_epv` / `compute_residual_income` | ticker, WACC | EPV, franchise value; RI value, implied r | XBRL | PIF code (new) | Valuation | Football field bars |
| `get_comps` | ticker | peer multiples with medians | peer comps | PIF code (have) | Relative value | Pitch drafts |
| `get_quality_scores` | ticker | Piotroski, Altman, Beneish | existing scores | PIF code (have) | Quality | Red team |
| `get_factor_scorecard` | ticker | percentile ranks | `factors.js` | PIF code (have) | Factors | Context |
| `get_insider_score` | ticker | opportunistic score with reasons | `insiderSignals.js` | PIF code (have) | Insider | Ownership watcher |
| `get_short_pressure` | ticker | score with reasons | `shortPressure.js` | PIF code (have) | Shorts | Red team |
| `get_red_flags` | ticker | tiered red flags | `redFlags.js` | PIF code (have) | Risk | Triage, red team |
| `get_filing_brief` | accession | existing AI brief | filings tab | PIF code (have) | Summaries | Reuse instead of re-reading |
| `get_crowding` / `get_13f_breadth` | ticker | attention, crowding, breadth | `crowding.js`, `thirteenFBreadth.js` | PIF code (have) | Positioning | Red team |
| `get_index_radar` / `get_forced_sellers` | ticker | index events, forced-seller flags | `indexRadar.js`, `forcedSellers.js` | PIF code (have) | Flow events | Event intake |
| `get_base_rate` | condition | historical frequency | `baseRate.js` | PIF code (have) | Outside view | Pitch base-rate field; GJP comparison classes |
| `run_backtest` | rule, universe, dates | results | `backtest.js` | PIF code (have) | Testing | Scoring-model weights; AI signal tests with anonymized tickers |
| `run_screen` | JSON filter | ranked results with reasons | new screener over frames | PIF code (new) | Discovery | Scout and NL screener |
| `diff_screen` | screen id | entered and left | stored screen runs | PIF code (new) | Screen alerts | Inbox cards |
| `get_calendar` | dates | earnings, dividends, FOMC, votes | `calendar.js` | PIF code (have) | Events | Previews |
| `get_today_edition` / `get_meeting_brief` | date | existing outputs | `today.js`, `meetingBrief.js` | PIF code (have) | Reuse | Weekly memo |
| `get_pitch` | pitch id or ticker | targets, confidence, horizon, scenarios, pre-mortem, bear checklist, votes | pitches | PIF code (have) | Thesis record | Thesis checker, red team |
| `get_track_record` | analyst or sector | Brier, hit rate, buckets | `calibration.js`, track record | PIF code (have) | Calibration | Calibration coach |
| `get_paper_trades` | member | trades with reasons, targets, stops | `paperTrading.js` | PIF code (have) | Process | PGR/PLR, selling skill |
| `search_notes` | query, ticker | matching notes with links | `notes.js` | PIF code (have) | Own content | Ask PIF |
| `search_club_chat` | query, dates, ticker | messages with links | `chat.js` | PIF code (have) | Own content | Ask PIF, ASKB-style catch-up |
| `get_holding_dossier` | ticker | pillars, promises, accepted findings, decisions, summary | new dossier tables | PIF code (new) | Memory | First read for every holding agent |
| `verify_quote` | text, source id | match yes/no, location | cached source text | PIF code (new) | Verification | Badge on every quote |
| `verify_number` | value, tool result id | match yes/no | tool results | PIF code (new) | Verification | Flags unsupported numbers |
| `find_tool` / `call_tool` | query; name and args | tool list; result | tool registry | PIF code (new) | Discovery | Keeps the model's tool list short |
| `propose_note` | ticker, text, citations | queued item | approval queue | PIF code (new), write | Gated write | Member approves before it saves |
| `propose_pillar_status` | pillar, status, evidence | queued item | approval queue | PIF code (new), write | Gated write | Second member confirms |
| `propose_alert` | ticker, tier, text | queued item | approval queue | PIF code (new), write | Gated write | Escalations need a rule or a human |
| `draft_message` | audience, text | draft | approval queue | PIF code (new), write | Gated write | Nothing is sent without a member |

There is deliberately no tool that places a paper trade, edits holdings or sends a message directly.

### 8.6 Agents and workflows built on the catalog

Tiers: cheap = Haiku 5.5 or gpt-6-luna; mid = Sonnet 5.5 or gpt-6.1-sol; top = Opus 5.5. "Workflow" means fixed code steps; "agent" means an open tool loop with a step and budget cap.

| Name | Type | Trigger | Main tools | Output | Model tier | Human checkpoint |
|---|---|---|---|---|---|---|
| Event intake and router | Code, no model | Every feed poll | `get_latest_filings_feed`, `get_8k_events`, 13F live, FINRA dates, news, USAspending, Congress, internal writes | Events rows with tier and dedupe key | None | Rules reviewed quarterly with the engagement log |
| Triage | Workflow | Events the rules cannot classify (news, 8.01, 7.01) | `get_company_news`, `get_filing_text`, `get_holding_dossier` | Materiality 0 to 10, tier proposal, one cited sentence | Cheap, batched | Cannot push alone; push needs a rule match |
| Filing and 10-K change brief | Workflow | New 10-K, 10-Q or material 8-K on a holding | `get_filing_text`, `diff_filing_sections`, LM tone, `verify_quote` | Brief with verified quotes and tone and length deltas | Mid on Batch overnight; mid real-time for push-tier 8-Ks | Holding owner marks reviewed |
| Earnings flash | Workflow | 8-K Item 2.02 on a holding | `get_filing_text` (exhibit 99), `get_quote_summary`, `compute_move_zscore`, dossier | Actual vs consensus, KPI table with links, pillars touched | Mid, real-time | Owner confirms any pillar change |
| Earnings preview | Workflow | 7 days before a holding reports | Calendar, revisions, dispersion, dossier, promises due | One-page preview with "what would break the thesis" | Mid, Batch | Owner adds their own call |
| Call recap and promise extraction | Workflow | Transcript available | `get_earnings_transcript`, `verify_quote`, dossier | Guidance changes, evasive answers, new promises with dates | Cheap extract, mid summarize | Human reviews a sample of extracted promises before scoring |
| Promise checker | Workflow | A promise's due date passes | Filings full-text, transcripts, dossier | Proposed status: kept, broken, dropped, with evidence | Mid | Second member confirms |
| Thesis checker | Workflow | Pillar check date, or an event tagged to a pillar | Dossier, filings, prices, revisions | Proposed pillar status with evidence | Mid | A member other than the owner confirms |
| Red team | Agent | Pitch submitted for IC | `run_reverse_dcf`, `get_base_rate`, `get_short_pressure`, `get_red_flags`, `get_quality_scores`, `get_insider_score`, `get_13f_breadth`, `diff_filing_sections`, `get_comps` | Ranked objections, each cited | Mid | Author answers each; IC sees unanswered ones |
| Pitch primer | Workflow | Member starts a pitch | Fundamentals, comps, DCF, EV bridge, ownership, base rates | Draft template with cited facts and football-field data | Mid | Author edits; AI text is labeled |
| Scout and NL screener | Agent for NL, workflow for nightly runs | Member query, or nightly saved screens | `run_screen`, `get_xbrl_frame`, `rank_peers`, insider and 13F tools | Ranked ideas with "why it is on the list" | Cheap for text-to-filter | Member adds to watchlist |
| Screen diff alerts | Code | After each nightly screen | `diff_screen` | Entered/left cards | None | None |
| Compare matrix | Workflow, parallel per cell | Member picks rows (companies) and columns (questions) | `get_filing_text`, `verify_quote` | Grid of cited answers | Cheap or mid per cell | Read-only; verified badges |
| Ownership watcher | Workflow | 13F season, 13D/G, Form 144, insider clusters | 13F, 13D/G, Form 144, insider tools | Ownership digest | Cheap | None |
| Policy and government watcher | Workflow | Weekly, plus Federal Register hits | Congress trades, USAspending, lobbying, Federal Register, openFDA | Policy section for the weekly memo | Cheap | Labeled internal research |
| Macro briefing | Workflow | FOMC, CPI, payrolls, curve moves | FRED, Treasury, BLS, Fed releases, `diff_fed_statement` | Macro section with rate-sensitive holdings | Cheap or mid | Macro lead reviews |
| Risk and attribution commentary | Workflow | Weekly close | `compute_brinson`, `compute_tracking_error`, `compute_factor_exposure`, `compute_var` | Narrative where every number comes from code | Mid | Risk lead approves for the brief |
| Pre-trade check | Code plus optional narration | IC vote opened | `simulate_trade_ips` | Before/after table and IPS results | None or cheap | The IC vote |
| Second-order monitor | Workflow | 8-K or guidance change at a named customer, supplier or peer of a holding | `get_customer_concentration`, peers, `get_8k_events` | "May matter for X" card with quote | Mid | Owner accepts or dismisses |
| Data QA | Code plus explanation | Nightly | XBRL vs Yahoo vs Finnhub for debt, FCF, shares | Mismatch list with likely cause | Cheap | Will reviews |
| Weekly editor memo | Workflow | Friday, Batch | Verified outputs from the week only | Draft memo | Top | Editor approves before it goes out |
| Ask PIF | Agent | Member question | Read-only catalog, `search_notes`, `search_club_chat`, `get_pitch`, discovery tools | Cited answer with the tool calls shown | Mid, escalates on request | Writes go to the approval queue; per-member budget |
| Deep research on a new name | Agent, orchestrator-worker | Member request, capped per month | Full read-only catalog | Dossier draft with citations | Top lead, cheap or mid workers | Member reviews before it enters memory |
| Post-mortem and calibration coach | Workflow | Pitch reaches its horizon | `get_pitch`, prices, `get_track_record` | What happened vs pillars, pre-mortem match suggestion, Brier update | Mid | Analyst writes a reflection; second member judges the pre-mortem match |
| Semester handoff writer | Workflow | Term end | Dossier, pitches, alerts | Handoff per holding (thesis, targets, triggers, owner, open promises) | Mid | Outgoing owner signs off |
| Eval runner | Code plus judge | Nightly and on prompt or model change | Golden sets | Scores per workflow in the database | Cheap or mid judge | Will on regressions |
| Source health check | Code | Daily | Probe of each upstream endpoint | Alert when a host moves or a schema changes | None | Will |

### 8.7 What not to build

Skip anything that needs data PIF cannot license: broker research, Visible Alpha consensus, alternative-data nowcasting, licensed news and expert calls. Skip agent-run trading of any kind, including automated paper trades; Alpaca's MCP is the credible option only if paper trading ever moves to a broker paper account, and it should stay paper-only. Skip a shared cross-company vector index for filings. Skip any feature claiming an LLM beats analysts. Skip fully autonomous multi-agent loops for routine work; the token multiplier buys nothing on fixed-path tasks.

## 9. Roadmap

Costs are list prices or free sources from Sections 2 and 8. AI costs are per call under the existing cost log, using the tiers above.

| Priority | Item | Impact | Effort | Cost | Depends on |
|---|---|---|---|---|---|
| P0 | Fix FCF null-on-missing-capex, add capex tags, difference YTD cash flows | High: numbers members see today | S | $0 | None |
| P0 | Rebuild debt and EV from explicit XBRL tags (leases, NCI, preferred, equity investments, SBC) plus EV bridge view | High | M | $0 | Tag checks at the FASB viewer |
| P0 | Store daily estimate snapshots | Medium, grows with time | S | $0 | None |
| P0 | FINRA consolidated short interest with dates; separate short-volume line | Medium | S | $0 | None |
| P1 | Re-tier 8-K alerts by item; three-tier delivery, dedupe, quiet hours, engagement log | High | M | $0 | Events table |
| P1 | Volatility-scaled move alerts (raw, idiosyncratic, sector-relative z) | High | M | $0 | Sector ETF prices |
| P1 | IPS cure clock and near-limit warnings; drawdown review trigger | High | S | $0 | Fund picks thresholds |
| P1 | Annotated price chart with 8-K, Form 4, earnings and pitch markers | Medium | S | $0 | None |
| P1 | Insider fixes: 10b5-1 flag, "unclassified" new insiders, cluster badge | Medium | S | $0 | None |
| P1 | 13F best ideas by overweight vs market cap | Medium | S | $0 | Market cap universe tool |
| P1 | Apply to the Quartr student program | High for earnings work | S | Free (official) | Faculty or org contact |
| P2 | Events table, code router, `agent_runs` job table, approval queue | Foundation for all agents | M | $0 | None |
| P2 | Tool layer over `lib/` with `{data, source_url, as_of, cached}` and shared SEC limiter | Foundation | M | $0 | Events table |
| P2 | Quote and number verification service | Foundation, trust | S | $0 | Tool layer |
| P2 | Golden sets and nightly eval runner | Foundation | M | Cents per run | Tool layer |
| P2 | Monthly AI cap and per-member budgets enforced in the router | Required before chat | S | $0 | Cost log |
| P2 | Earnings flash, filing brief upgrade, triage on the new rails | High | M | Low per call | P2 foundation |
| P2 | Factor regressions with CIs; Brinson attribution; tracking error | High | M | $0 | French data, sector ETFs |
| P2 | Thesis pillars and kill criteria fields; thesis health score; thesis checker | High | M | Low | Pitch schema change |
| P3 | Whole-market screener over XBRL frames, NL screening, saved screens, diff alerts | High | L | $0, or Finviz Elite $299.50/yr | Price coverage decision |
| P3 | Red team, pitch primer, compare matrix | High | M | Mid-tier calls | P2 foundation |
| P3 | Ask PIF over notes, chat, pitches with shown tool calls | High | M | Mid-tier calls, capped | Budgets, injection defenses |
| P3 | Valuation additions: EPV, residual income, implied cost of capital, football field, star bands | Medium | M | $0 | EV fixes |
| P3 | LM tone and Risk Factors length on the Lazy Prices view | Medium | S | $0 (confirm academic terms) | None |
| P3 | Promise extraction and checker; promise-kept ratio | Medium | M | Low | Transcript source |
| P3 | Calibration report upgrade (Murphy decomposition, intervals, revisions); PGR/PLR; selling skill | Medium | S | $0 | Paper trading snapshots |
| P4 | PIF MCP server (read-only) | Medium | S | $0 | Tool layer, auth |
| P4 | Per-holding dossier memory | Medium | M | $0 | Accepted outputs |
| P4 | Government long tail (lobbying, Federal Register, openFDA, EIA, BLS, Census, CFTC) | Medium for specific holdings | M | Free keys | `.env.example` updates |
| P4 | Deep research on a new name (orchestrator-worker) | Medium | M | About $1 per run order of magnitude | Caps, evals |
| P4 | VaR, scenario replays, pre-trade what-if | Medium | M | $0 | Risk tools |
| P4 | Semester handoff writer, post-mortem coach, source health check | Medium | S | Low | Dossier |

## 10. Decisions only the fund can make

The fund needs to decide whether to buy **Finviz Elite** ($39.50 a month or $299.50 a year, official) for whole-market prices and export; its page shows no API or data-use terms, so the fund should read the terms before letting the app ingest the export. It needs someone to **apply to Quartr's student program** and to ask whether its terms allow pulling transcripts into PIF's own app. It should check with the Claremont libraries whether Bloomberg, Capital IQ or WRDS access already exists. It must pick the **monthly AI spending cap** and per-member budgets; note that the project memory says the production AI key is unset, so confirm what is live before costing anything. It must choose a provider policy: stay on OpenAI, add Anthropic for citations, or route between both by task.

The IPS-level choices also belong to the fund: the drawdown review threshold (the student funds found use 10 to 20% from cost), the sigma cutoffs for push and inbox alerts, whether sector limits become benchmark-relative, and the cure deadline for breaches. On data use, the fund should confirm with a faculty adviser that Congress trade pages stay internal and unmonetized, and that the Loughran-McDonald dictionary falls under academic terms for a member-only app. On process metrics, it should decide whether scores appear on a public leaderboard or stay private to each analyst, who marks pillar status (a second member is the recommendation), and whether AI output can ever enter the weekly memo without an editor's approval (the recommendation is no).

## 11. Conclusion

The gap between PIF and a professional desk is narrower on data than it looks and wider on discipline. Almost every number the pros use can be rebuilt from SEC, FINRA, French, Damodaran and Treasury files at no cost, but only if the numbers are right first; the FCF, debt and cash-flow issues in Section 5 feed directly into DCFs, multiples and any agent that narrates them, so fixing them is the cheapest AI improvement available. The pro vendors' shift to agents is mostly a shift to typed events, shared tools and verified citations, which is plumbing PIF can own outright rather than rent.

What the fund can have that no terminal sells is a record of its own reasoning: pillars with dates, promises with outcomes, confidence that gets graded, red-team objections that get answered. Agents are most useful as the clerks that keep that record current and cite their evidence, with members making every call. Built that way, the platform measures whether members are getting better at judgment, which is the outcome the student-fund literature says is rarely measured.

## 12. Sources

**Pro terminals and vendor AI**
- [NYU Stern Bloomberg guide](https://guides.nyu.edu/bloombergguide/popular-commands)
- [UDel Lerner Bloomberg functions list (2018)](https://lerner.udel.edu/seeing-opportunity/bloomberg-functions-list/)
- [S&P Capital IQ Platform Brochure](https://www.spglobal.com/content/dam/spglobal/mi/en/documents/general/S-P-Capital-IQ-Platform-Brochure.pdf)
- [WRDS: Introduction to Capital IQ](https://wrds-www.wharton.upenn.edu/pages/grid-items/introduction-capital-iq)
- [CBS Capital IQ user guide 2025](https://www.cbs.dk/sites/default/files/2025-11/sp_capital_iq_-_user_guide.pdf)
- [S&P press release, Oct 22, 2025](https://press.spglobal.com/2025-10-22-S-P-Global-Redefines-Financial-Insights-with-New-AI-Powered-Multi-Document-Research-and-Analysis-Tool-in-Capital-IQ-Pro-ChatIQ)
- [S&P press release, Mar 25, 2025 (Visible Alpha)](https://press.spglobal.com/2025-03-25-S-P-Global-Market-Intelligence-Launches-Visible-Alpha-on-S-P-Capital-IQ-Pro-Platform)
- [S&P Global: Nomura on Visible Alpha](https://www.spglobal.com/market-intelligence/en/news-insights/research/2025/10/nomura-securities-is-now-available-in-s-and-p-globals-visible-alpha-models-consensus)
- [StreetAccount brochure](https://go.factset.com/hubfs/Website/Resources%20Section/Brochures/streetaccount-brochure.pdf)
- [StreetAccount web help PDF](https://www.streetaccount.com/helpdocs/factset_streetaccount_web.pdf)
- [FactSet Insight: active management part one](https://insight.factset.com/demonstrating-the-benefits-of-active-managements-part-one)
- [The AI Innovator: FactSet agentic push](https://theaiinnovator.com/inside-factsets-push-to-build-an-agentic-future/)
- [Google Cloud press corner: FactSet partnership](https://www.googlecloudpresscorner.com/2026-06-30-FactSet-Announces-Strategic-Partnership-with-Google-Cloud-to-Bring-Advanced-AI-to-Financial-Intelligence)
- [Bloomberg PORT](https://professional.bloomberg.com/products/bloomberg-terminal/portfolio-analytics)
- [Traders Magazine: ASKB beta](https://www.tradersmagazine.com/xtra/bloomberg-introduces-agentic-ai-to-the-terminal/)
- [Fortune: Bloomberg ASKB, Apr 28, 2026](https://fortune.com/2026/04/28/bloomberg-askb-ai-agents-lessons-from-bloomberg-cto-shawn-edwards-eye-on-ai/)
- [PR Newswire: ASKB GA, Oct 15, 2026](https://www.prnewswire.com/news-releases/the-next-evolution-of-askb-your-insights-bloombergs-intelligence-one-conversation-302909392.html)
- [A-Team Insight: S&P MCP](https://a-teaminsight.com/blog/sp-global-bets-on-agent-native-architecture-as-capital-iq-pro-consolidation-accelerates/?brand=ati)
- [Koyfin blog: Bloomberg Terminal cost](https://www.koyfin.com/blog/bloomberg-terminal-cost/)
- [Costbench: Bloomberg Terminal](https://www.costbench.com/software/financial-data-terminals/bloomberg-terminal/)
- [Eulerpool blog](https://eulerpool.com/blog/bloomberg-terminal-cost)

**Research apps**
- [Koyfin plans comparison](https://www.koyfin.com/pricing/plans-comparison/)
- [Koyfin release notes](https://www.koyfin.com/help/topic/release-notes/)
- [Koyfin blog: earnings call transcript platforms](https://www.koyfin.com/blog/top-earnings-call-transcripts-platforms)
- [YCharts plans](https://get.ycharts.com/plans)
- [YCharts KB: Scatter Plot](https://go.ycharts.com/knowledge-base/scatter-plot-overview)
- [YCharts KB: Scoring Models](https://go.ycharts.com/knowledge-base/scoring-models-overview)
- [DEV Community: YCharts review](https://dev.to/pickuma/ycharts-review-financial-research-and-stock-screening-for-data-driven-investors-32en)
- [Morningstar equity research definitions](https://advisor.morningstar.com/Enterprise/VTC/UpdatedEquityResearchDefinitions.pdf)
- [Morningstar.ca: how Morningstar values stocks](https://morningstar.ca/ca/news/188241/how-morningstar-values-stocks.aspx)
- [Morningstar UK: style box](https://morningstar.co.uk/uk/news/59616/diversification-matters-how-to-use-the-morningstar-style-box.aspx)
- [Morningstar help: X-Ray](https://www.morningstar.com/help-center/portfolio/xray)
- [Finviz Elite](https://finviz.com/elite)
- [Finviz blog: new maps](https://finviz.com/blog/new-stock-market-maps-for-market-cap-52-week-highs-lows-themes-and-insider-trading)
- [ChartingLens: Finviz Elite review](https://chartinglens.com/blog/is-finviz-elite-worth-it)
- [Quartr students](https://quartr.com/students)
- [Quartr keyword alerts](https://quartr.com/features/keyword-alerts)
- [Quartr pricing](https://quartr.com/pricing)
- [Quartr API pricing](https://quartr.com/pricing/api)
- [AlphaSense help: tone shifts](https://help.alpha-sense.com/hc/en-us/articles/41711901352211)
- [AlphaSummit 2025 announcements](https://alpha-sense.com/resources/product-articles/alphasummit-2025-product-announcements/)
- [IntuitionLabs: AlphaSense](https://intuitionlabs.ai/software/pdfs/alphasense.pdf)
- [Seeking Alpha Quant Ratings FAQ](https://help.seekingalpha.com/premium/quant-ratings-and-factor-grades-faq)
- [Claude marketplace: Daloopa](https://claude.com/marketplace/connectors/daloopa)
- [Hebbia: financial research platforms](https://www.hebbia.com/resources/financial-research-platforms)
- [Brightwave platform](https://www.brightwave.io/platform)
- [AllMind: Fintool alternatives](https://allmind.ai/research/fintool-alternatives)
- [G2: Stratosphere.io](https://www.g2.com/products/stratosphere-io/reviews)
- [Day Trading Toolkit: FinChat review](https://daytradingtoolkit.com/reviews/finchat-review)
- [Anthropic: finance agents, May 5, 2026](https://www.anthropic.com/news/finance-agents)

**Valuation**
- [Damodaran variable definitions](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/variable.htm)
- [Damodaran valuation session 8 slides](https://pages.stern.nyu.edu/~adamodar/pdfiles/valonlineslides/session8.pdf)
- [Damodaran blog: SBC, Feb 2014](https://aswathdamodaran.blogspot.com/2014/02/stock-based-employee-compensation-value.html)
- [Damodaran home page](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/home.htm)
- [Damodaran blog: ERP, March 2026](https://aswathdamodaran.blogspot.com/2026/03/the-price-of-risk-equity-risk-premium.html)
- [Damodaran current data](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datacurrent.html)
- [Damodaran wacc.html](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/wacc.html)
- [Damodaran lease effect](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/leaseeffect.html)
- [BVWire: Kroll reaffirms 5.0% ERP](https://www.bvresources.com/articles/bvwire/kroll-reaffirms-50-us-erp-sticks-with-treasury-risk-free-rate)
- [Capterra: Kroll Cost of Capital Navigator](https://www.capterra.com/p/241024/Cost-of-Capital-Navigator/)
- [FRED DGS10](https://fred.stlouisfed.org/series/DGS10)
- [Jennergren: value driver formulas](https://research.hhs.se/esploro/outputs/workingPaper/Value-Driver-Formulas-for-Continuing-Value/991001535499306056)
- [Bodmer: McKinsey value driver distortions](https://edbodmer.com/mckinsey-value-driver-formula-distortions/)
- [Expectations Investing](https://expectationsinvesting.com/)
- [GuruFocus: Mauboussin on ROIC persistence](https://www.gurufocus.com/news/19462/mauboussin-on-strategy-roic-patterns-luck-persistence-and-what-to-do-about-it)
- [Measuring the Moat (Morgan Stanley)](https://www.morganstanley.com/im/publication/insights/articles/article_measuringthemoat.pdf)
- [Kellogg practicum lecture notes on EPV](https://kellogg.northwestern.edu/faculty/jagannathan/teaching/practicum/2006/files/Week3/VI_Lecture_3.pdf)
- [Feltham-Ohlson 1995](https://u.osu.edu/schroeder.9/files/2017/07/Feltham1995-1kngbjq.pdf)
- [Gebhardt, Lee, Swaminathan 2001 (IDEAS)](https://ideas.repec.org/a/bla/joares/v39y2001i1p135-176.html)
- [NBER w15950](https://www.nber.org/papers/w15950.pdf)
- [Hribar and Collins 2002 (EconPapers)](https://econpapers.repec.org/RePEc:bla:joares:v:40:y:2002:i:1:p:105-134)
- [Green, Hand, Soliman 2011 (IDEAS)](https://ideas.repec.org/a/inm/ormnsc/v57y2011i5p797-816.html)
- [Novy-Marx 2013 (EconPapers)](https://econpapers.repec.org/RePEc:eee:jfinec:v:108:y:2013:i:1:p:1-28)
- [YCharts glossary: Graham number](https://ycharts.com/glossary/terms/graham_number)
- [CFI: Rule of 40](https://corporatefinanceinstitute.com/resources/valuation/rule-of-40)
- [FE Training: football field](https://www.fe.training/free-resources/valuation/football-field-analysis/)
- [XBRL US DQC_0087](https://xbrl.us/data-rule/dqc_0087/)
- [XBRL US NCI guidance](https://xbrl.us/guidance/specific-non-controlling-interest-elements/)

**Signals**
- [Kenneth French Data Library](https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html)
- [McLean & Pontiff 2016](https://Www.Gwern.net/doc/economics/2016-mclean.pdf)
- [Diether, Malloy, Scherbina 2002](https://www.kellogg.northwestern.edu/faculty/mcdonald/ftp/practicum/papers/dms3.pdf)
- [Martineau 2022, Critical Finance Review](https://nowpublishers.com/article/Details/CFR-0122)
- [UCLA Anderson Review on PEAD](https://anderson-review.ucla.edu/is-post-earnings-announcement-drift-a-thing-again)
- [Hong et al., Days to Cover, NBER w21166](https://nber.org/papers/w21166)
- [SEC Release 34-105482 (FINRA proposal)](https://www.sec.gov/files/rules/sro/finra/2026/34-105482.pdf)
- [SEC SR-FINRA-2026-012 page](https://www.sec.gov/rules-regulations/self-regulatory-organization-rulemaking/sr-finra-2026-012)
- [Morgan Lewis: Form SHO extended to 2028](https://www.morganlewis.com/pubs/2025/12/short-sale-reporting-on-form-sho-compliance-date-further-extended-to-2028)
- [FINRA consolidated short interest API](https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest)
- [Cohen, Malloy, Pomorski, NBER w16454](https://www.nber.org/papers/w16454.pdf)
- [SEC Insider Transactions Data Sets](https://www.sec.gov/data-research/sec-markets-data/insider-transactions-data-sets)
- [SEC technical specifications](https://www.sec.gov/submit-filings/technical-specifications)
- [Chen, Hong, Stein 2002 (IDEAS)](https://ideas.repec.org/p/nbr/nberwo/8151.html)
- [Cohen, Polk, Silli: Best Ideas](https://personal.lse.ac.uk/polk/research/BestIdeas.pdf)
- [Cohen, Malloy, Nguyen: Lazy Prices, NBER w25084](https://www.nber.org/papers/w25084.pdf)
- [Notre Dame SRAF: Loughran-McDonald dictionary](https://sraf.nd.edu/loughranmcdonald-master-dictionary/)
- [Jha et al., ChatGPT and Corporate Policies (IDEAS)](https://ideas.repec.org/p/nbr/nberwo/32161.html)
- [EvasionBench, arXiv 2601.09142](https://arxiv.org/html/2601.09142v1)
- [Lopez-Lira & Tang, arXiv 2304.07619](https://arxiv.org/abs/2304.07619v5)
- [Kim, Muhn, Nikolaev, arXiv 2407.17866v2](https://arxiv.org/abs/2407.17866v2)
- [Kim, Muhn, Nikolaev withdrawal notice, arXiv 2407.17866v3](https://arxiv.org/abs/2407.17866v3)
- [Glasserman & Lin, arXiv 2309.17322](https://arxiv.org/abs/2309.17322)
- [Moat et al. 2013 (ADS)](https://ui.adsabs.harvard.edu/abs/2013NatSR...3E1801M/abstract)

**Monitoring and alerts**
- [MSCI: Barra Analytics on FactSet](https://www.msci.com/resources/factsheets/Barra_Analytics_on_FactSet.pdf)
- [Man Group: liquidity risk frameworks](https://www.man.com/insights/limitations-liquidity-risk-frameworks)
- [Mazars Liquidity Tool](https://www.mazars.co.uk/industries/financial-services/quantitative-solutions/mazars-liquidity-tool)
- [Carlson Growth Fund IPS](https://carlsonschool.umn.edu/sites/carlsonschool.umn.edu/files/inline-files/CGF%20investment%20policy%20statement%20-%20APPROVED%2020150924.pdf)
- [Loughborough Student Initiative Fund constitution](https://lsmf.lboro.ac.uk/wp-content/uploads/2024/11/The-Loughborough-Student-Initiative-Fund-Constitution-updated-Dec-2023.pdf)
- [UConn SMF Fall 2024 report](https://smf-business.media.uconn.edu/wp-content/uploads/sites/818/2025/01/SMF-Team-White-Fall-2024-Long-Report.pdf)
- [Google SRE Book, ch. 6](https://sre.google/sre-book/monitoring-distributed-systems/)
- [AHRQ PSNet: alert fatigue](https://psnet.ahrq.gov/primer/alert-fatigue)
- [JMIR Med Inform 2020](https://medinform.jmir.org/2020/7/e15653/)
- [Ray, Wilson et al. 2026](https://www.metrohealth.org/globalassets/metrohealth-documents/population-health-research-institute/ray-wilson-et-al-2026-alert-fatigue-systematic-review.pdf)
- [EventStudyTools: methodology](https://www.eventstudytools.com/introduction-event-study-methodology)
- [EventStudyTools: significance tests](https://www.eventstudytools.com/significance-tests)
- [Lerman & Livnat: The New Form 8-K Disclosures](https://archive.nyu.edu/bitstream/2451/27579/2/SSRN-id1126816.pdf)
- [Liu, Szewczyk, Zantout 2008 (IDEAS)](https://ideas.repec.org/a/bla/jfinan/v63y2008i2p987-1020.html)

**Process metrics**
- [Siegert, arXiv 1303.6182](https://arxiv.org/pdf/1303.6182)
- [AI Impacts: Good Judgment Project evidence](https://aiimpacts.org/evidence-on-good-forecasting-practices-from-the-good-judgment-project/)
- [Chang et al. 2016, Judgment and Decision Making](https://dlab.sauder.ubc.ca/sjdm/journal/16/16511/jdm16511.html)
- [Metaculus: analysis of 20,000 predictions](https://www.metaculus.com/news/2016/10/15/prediction-analysis/)
- [EA Forum: Metaculus AI track record](https://forum.effectivealtruism.org/posts/e9htD7txe8RDdcehm/exploring-metaculus-s-ai-track-record)
- [Paper citing Williams 1996 (core.ac.uk)](https://core.ac.uk/download/18443582.pdf)
- [Knowledge at Wharton: Rogers & Stocken](https://knowledge.wharton.upenn.edu/article/how-credible-are-management-forecasts-not-very/)
- [HKUST Business Insight: consistency vs accuracy](https://bm.hkust.edu.hk/bizinsight/2016/11/consistency-more-useful-accuracy-earnings-forecasts)
- [CFA Institute Enterprising Investor: CEO candor](https://rpc.cfainstitute.org/blogs/enterprising-investor/2014/how-understanding-ceo-candor-can-make-you-money)
- [MetaTOC: CEO promises study](https://metatoc.com/papers/120672-shaping-expectations-losing-flexibility-a-study-of-ceo-promises-as-strategic-communication-tools)
- [arXiv 2510.03195: Can LLMs Hit Moving Targets?](https://arxiv.org/html/2510.03195v1)
- [aifinhub: prompt patterns for earnings calls](https://aifinhub-monorepo.pages.dev/articles/prompt-patterns-earnings-calls/)
- [Farnam Street: decision journals](https://fs.blog/how-to-improve-the-quality-of-our-decision-making/)
- [Acquirer's Multiple: Mauboussin on premortems](https://acquirersmultiple.com/2020/07/michael-mauboussin-perform-a-premortem-before-you-invest)
- [Bobby Powers: review of Quit](https://bobbypowers.net/review-quit/)
- [Acquirer's Multiple: Steinhardt variant perception](https://acquirersmultiple.com/2021/12/michael-steinhardt-develop-a-variant-perception)
- [Motley Fool: Expectations Investing Q&A](https://www.fool.com/investing/2022/01/19/expectations-investing-qanda-mauboussin-rappaport)
- [CFA Digest: Odean 1998](https://rpc.cfainstitute.org/-/media/documents/article/cfa-digest/1999/dig-v29-n2-469-pdf.pdf)
- [Akepanidtaworn et al., NBER w29076](https://nber.org/papers/w29076)
- [Institutional Investor: Essentia study](https://www.institutionalinvestor.com/article/b1zsqjnqsxx2fd/Were-Those-Great-Returns-the-Result-of-Skill-or-Just-Luck)
- [Global Trading: Essentia Behavioral Alpha](https://www.globaltrading.net/?p=29575)
- [Ramsey & Isengildina-Massa, AETR 2020](https://www.aaea.org/UserFiles/file/AETR_2020_016RRissue6.docx.pdf)
- [Belcher & Jones, JKMP](https://journals.klalliance.org/index.php/JKMP/article/view/615)
- [University of St. Thomas study](https://researchonline.stthomas.edu/esploro/outputs/journalArticle/Using-Performance-Data-to-Evaluate-Student/991015131090403691)

**AI architecture, models and evaluation**
- [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- [Anthropic: How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- [MCP spec 2026-07-28: Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [MCP blog, 2026-07-28](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- [OpenAI: Connectors and MCP servers](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)
- [DEV Community: OpenAI Agents SDK in production](https://dev.to/gabrielanhaia/the-openai-agents-sdk-in-production-what-it-gives-you-and-what-it-hides-16a9)
- [Claude docs: Programmatic tool calling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling)
- [Claude docs: Citations](https://platform.claude.com/docs/en/build-with-claude/citations)
- [Claude pricing docs](https://platform.claude.com/docs/en/about-claude/pricing)
- [OpenAI API pricing](https://developers.openai.com/api/docs/pricing)
- [FinMem, arXiv 2311.13743](https://arxiv.org/pdf/2311.13743.pdf)
- [Vals AI Finance Agent benchmark](https://www.vals.ai/benchmarks/finance_agent)
- [FinanceBench, arXiv 2311.11944](https://arxiv.org/html/2311.11944)
- [TradingAgents, arXiv 2412.20138](https://arxiv.org/html/2412.20138v4)
- [OWASP GenAI: LLM01 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)

**Data sources, terms and MCP projects**
- [SEC: Accessing EDGAR Data](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data)
- [SEC: EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
- [SEC: Financial Statement and Notes data sets](https://www.sec.gov/data-research/sec-markets-data/financial-statement-notes-data-sets)
- [SEC submissions JSON example (NVIDIA)](https://data.sec.gov/submissions/CIK0001045810.json)
- [SEC frames example: shares outstanding](https://data.sec.gov/api/xbrl/frames/dei/EntityCommonStockSharesOutstanding/shares/CY2025Q3I.json)
- [Wikimedia pageviews example](https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/Nvidia/daily/20261001/20261003)
- [Yahoo API terms](https://legal.yahoo.com/us/en/yahoo/terms/product-atos/apiforydn/index.html)
- [5 U.S.C. § 13107 (Cornell LII)](https://www.law.cornell.edu/uscode/text/5/13107)
- [Senate eFD search](https://efdsearch.senate.gov/search/home/)
- [lda.gov API](https://lda.gov/api/)
- [USPTO PatentsView transition guide](https://data.uspto.gov/support/transition-guide/patentsview)
- [sec-api.io pricing](https://sec-api.io/pricing)
- [Massive pricing](https://massive.com/pricing)
- [Alpha Vantage support](https://www.alphavantage.co/support/)
- [dgunning/edgartools](https://github.com/dgunning/edgartools)
- [stefanoamorelli/sec-edgar-mcp](https://github.com/stefanoamorelli/sec-edgar-mcp)
- [stefanoamorelli/fred-mcp-server](https://github.com/stefanoamorelli/fred-mcp-server)
- [financial-datasets/mcp-server](https://github.com/financial-datasets/mcp-server)
- [alphavantage/alpha_vantage_mcp](https://github.com/alphavantage/alpha_vantage_mcp)
- [massive-com/mcp_massive](https://github.com/massive-com/mcp_massive)
- [alpacahq/alpaca-mcp-server](https://github.com/alpacahq/alpaca-mcp-server)
- [OpenBB](https://github.com/OpenBB-finance/OpenBB)
- [lzinga/us-gov-open-data-mcp](https://github.com/lzinga/us-gov-open-data-mcp)
