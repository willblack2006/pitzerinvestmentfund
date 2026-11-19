# Pro research apps and AI research tools: feature catalog for the PIF platform

Research date: 2026-11-13. Most sources are vendor pages (self-reported). Third-party review and pricing sites are labeled as such. Where a page gave no date, that is noted. "Overlap" = the PIF platform already has something similar (per the brief). "Free-data feasibility" is my inference, not a vendor claim.

## Koyfin: dashboards, watchlists, model portfolios, graph templates, transcripts, alerts

### Takeaway
Koyfin's official plan grid confirms the product units (custom dashboards, watchlists, screens, graph templates, transcripts plus AI transcript summaries, alerts) and their per-tier caps. Recent release notes center on watchlist/screener columns (insider, estimates and surprises), portfolio contribution/attribution, report generation and an LLM "Compare Matrix" over transcripts and filings. I found no rigorous source on which features are "most praised".

### Cited Findings
- Official plans (monthly): Free $0, Plus $39, Premium $79, Advisor Core $209, Advisor Pro $299; "Save up to 30% with an annual plan" (annual prices not listed). Official, fetched 2026-11-13 Source: [Koyfin plans comparison](https://www.koyfin.com/pricing/plans-comparison/)
- Per-tier limits (official): custom dashboards 2 on Free, unlimited on paid; watchlists 2 / unlimited; screens 2 / unlimited; graph templates 2 / unlimited; graphs 5 (Free), 50 (Plus), unlimited (Premium+); alerts 5 / 50 / 500; company transcripts and transcript summaries 45-day history on Free, full history on paid Source: [Koyfin plans comparison](https://www.koyfin.com/pricing/plans-comparison/)
- Third-party price lists conflict with the official page: one shows Plus $49, Premium $110, Advisor Core $239, Advisor Pro $359 (likely different billing basis or stale) Source: [CostBench](https://costbench.com/software/financial-data-terminals/koyfin/); another matches the official $39/$79/$209/$299 Source: [PricingSaaS](https://pricingsaas.com/companies/koyfin). A review says Koyfin restructured tiers in 2026 and retired "Pro" for new users Source: [Quantum Algo review](https://www.quantum-algo.com/blog/guides/koyfin-review/)
- Release notes (no per-release dates on page; recap entries "What We Built in 2024" v3.51 and "What we built in 2025" v3.75) Source: [Koyfin release notes](https://www.koyfin.com/help/topic/release-notes/):
  - v3.90 Compact Table: dashboard widget that shows hundreds of tickers in a condensed view.
  - v3.96 Insider Ownership Data in Screener & Watchlist: insider buying/selling columns and filters.
  - v3.81 Historical Estimates, Actuals & Surprises as watchlist/screener columns.
  - v3.69 Transcript Summaries: structured summaries for all event types, paid plans.
  - Compare Matrix (Beta): LLM tool that answers natural-language questions across transcripts, filings, press releases and news.
  - v3.93 Contribution (per-holding contribution to return); Attribution (allocation, selection, interaction vs benchmark); Model Portfolio Groups; drifted weights / proxies; Orion sync.
  - v3.66 Desktop Alerts: price, valuation, technical indicators, and documents (press releases, news, transcripts, filings).
  - v3.76 One Pager Reports; v3.80 Comparison Reports (up to five securities side by side in one PDF); v3.84 Reports hub; v3.85 Report Sharing; v3.91 bulk export.
  - Check Ticker: shows which saved screen criteria a security passes or fails.
- Koyfin transcript feature description (Koyfin blog, updated 2026-01-23, self-promotional): coverage of 100,000+ stocks incl. earnings, analyst days, conferences, M&A calls; keyword search within a call plus advanced library search filtered by date, sector, watchlist or ETF constituents (paid); search-term highlighting in the transcript; AI summaries covering key metrics, guidance changes, risks and Q&A (deal terms for M&A calls); security- or watchlist-level alerts for transcripts, press releases, news and filings via in-app, email or push; no audio playback Source: [Koyfin blog](https://www.koyfin.com/blog/top-earnings-call-transcripts-platforms)
- Same blog's competitor notes: Seeking Alpha transcripts US-only, Premium $239/yr, Pro $2,400/yr; BamSEC Pro $69/month billed annually, free plan has no transcripts; MarketBeat transcripts limited to S&P 500; Motley Fool has a small free set of US earnings transcripts (vendor claims about competitors, Jan 2026) Source: [Koyfin blog](https://www.koyfin.com/blog/top-earnings-call-transcripts-platforms)
- Koyfin homepage says transcripts let users "evaluate critical sentiment" and search every transcript for keywords Source: [Koyfin](https://koyfin.com/). A Koyfin feature-request board shows LLM transcript summaries marked live Source: [Koyfin Canny](https://koyfin.canny.io/feature-requests/p/ai-llm-summaries-of-earnings-call-transcripts)

### Inferences
Feature catalog (workflow / visualization / free-data feasibility / overlap):
- **My Dashboards (widget grid of watchlist tables, charts, news)**: morning check. Grid of resizable widgets. Feasible with free data (prices via existing source). Partial overlap with PIF Today page; gap is user-configurable layout.
- **Watchlist custom columns (insider activity, estimate surprise, valuation)**: monitoring. Sortable table with column picker. Feasible: PIF already computes insider score, Street consensus and revisions per ticker; the gap is a multi-ticker column view.
- **Check Ticker (which screen rules a stock passes/fails)**: idea generation, IC memo. Pass/fail checklist. Feasible; maps well onto PIF IPS checks and factor scorecard.
- **Compare Matrix (LLM grid: rows = companies, columns = questions, sourced from transcripts/filings)**: earnings prep, IC memo. Matrix table with cited cells. Feasible on SEC filings now (PIF has filings + AI briefs); transcripts need a source. Strong fit for the agentic system.
- **Transcript Summaries with guidance changes / risks / Q&A sections**: earnings prep. Structured card. Needs transcript source (PIF gap).
- **Document alerts (new transcript, 8-K, press release on watchlist)**: monitoring. Feasible for filings via EDGAR; PIF alerts page has price/targets/insider but not "new filing" alerts per the brief.
- **Contribution / Attribution (Brinson allocation, selection, interaction)**: monitoring, IC reporting. Waterfall or bar. PIF already has contribution; Brinson attribution vs S&P sectors is a small extension (overlap partial).
- **Comparison Reports PDF (up to five securities)**: IC memo. Feasible from existing per-ticker data.
- **Graph templates (saved chart setups)**: PIF TradingView-style chart already has indicators/drawing; saved templates are a small add.

### Gaps
- No credible source ranks which Koyfin features users praise most; review sites in results were SEO pages. I did not find a Koyfin "FA charts" description in current notes (only an older v3.4 mention).
- Koyfin model portfolio, data export, Excel/Sheets add-in and student pricing were not stated on the official plan grid.
- Release-note dates are not on the page, so ordering by version is the only timeline.

## YCharts: Fundamental Charts, Scatter Plot, Scoring Models, Screener, Alerts, Excel add-in, Reports

### Takeaway
YCharts is an advisor-focused, quote-priced platform. Its knowledge base documents Fundamental Charts, Scatter Plot (point-in-time vs timeseries), and Scoring Models (weighted metric composites built from a Screener or Comp Table). It now lists an AI agent ("Y"). No official prices.

### Cited Findings
- Plan page lists tiers Enterprise, Professional, Presenter, Analyst; tools include Charting, Screeners, Scoring Models, Scenarios, Scatter Plot, Report Builder, Talking Points, Email Reports, Alerts, Excel Add-in (marked "+ $"), and "Y, our AI Agent"; several marked "View Only" on some tiers; no dollar prices, call sales Source: [YCharts plans](https://get.ycharts.com/plans)
- Scatter Plot: add securities or a saved list, choose Point in Time (one X/Y per security) or Timeseries plot type, set X and Y metrics, save; listed as Professional-only Source: [YCharts KB: Scatter Plot overview](https://go.ycharts.com/knowledge-base/scatter-plot-overview); product page [YCharts Scatter Plot](https://get.ycharts.com/platform/tools/scatter-plot/)
- Scoring Models: from a Screener or Comp Table click "Create New Scoring Model", pick a model type, add metric components with weights and a null-value treatment; editable via Save / Save As Source: [YCharts KB: Scoring Models overview](https://go.ycharts.com/knowledge-base/scoring-models-overview); [Edit scoring model](https://go.ycharts.com/knowledge-base/edit-scoring-model)
- Fundamental Chart is opened from the Tools menu; KB has a "How to Build a Chart" section (steps not captured) Source: [YCharts KB: Fundamental Charts overview](https://go.ycharts.com/knowledge-base/fundamental-charts-overview)
- Excel add-in "dynamically linked to pull in data and update your models with a single click"; Professional clients get in-house Excel wizards Source: [YCharts Excel add-in](https://get.ycharts.com/platform/tools/excel-add-in/)
- Third-party: add-in reportedly included with new Professional licenses from September 2025 (aggregator, unverified) : search result summary of [Capterra](https://www.capterra.com/p/210403/YCharts); Professional estimated about $6,000/yr by one third-party site (unverified) Source: [DEV Community review](https://dev.to/pickuma/ycharts-review-financial-research-and-stock-screening-for-data-driven-investors-32en); one reviewer says the add-in is Windows-only (unverified) : same review.

### Inferences
- **Fundamental Chart (any metric over time, multiple tickers, e.g. FCF margin of holdings vs peers)**: earnings prep, IC memo. Multi-line time series. Feasible from PIF's 5y SEC financials (XBRL companyfacts covers more years). Partial overlap with per-ticker financials; gap is cross-ticker metric overlays.
- **Scatter Plot (X metric vs Y metric across a list, point-in-time or animated timeseries)**: idea generation, peer comps. Scatter with optional time trail. Feasible from SEC fundamentals + prices; natural add to PIF peer comps (e.g., EV/EBIT vs ROIC).
- **Scoring Models (user-weighted composite score, null handling)**: idea generation. Ranked table with score column. Feasible; PIF factor scorecard is fixed-weight, so user-editable weights would be the new part.
- **Talking Points / Report Builder**: IC memo. Text + chart exports. PIF pitches could auto-generate a one-pager.
- **Excel add-in**: not a priority for a web platform; CSV export is the free-data equivalent.

### Gaps
- No official YCharts prices; tier-by-feature mapping was not readable from the plan page.
- I did not fetch details on YCharts Alerts or the "Y" AI agent's capabilities.

## Morningstar: fair value, economic moat, uncertainty, star rating, capital allocation, style box, Portfolio X-Ray

### Takeaway
The star rating is a mechanical function of price vs analyst fair value, with the margin-of-safety bands set by the Uncertainty Rating. Fair value comes from a three-stage DCF in which moat width controls how slowly excess returns fade toward WACC. These rules are public and can be reproduced (in a simplified, transparent form) on PIF's existing DCF.

### Cited Findings
- Equity research definitions PDF (file metadata dated 2020-09-22, older source): Uncertainty Rating levels low, medium, high, very high, extreme. Margin of safety for 5 stars / 1 star: Low 20% discount / 25% premium; Medium 30% / 35%; High 40% / 55%; Very High 50% / 75%; Extreme 75% discount / 300% premium Source: [Morningstar Updated Equity Research Definitions](https://advisor.morningstar.com/Enterprise/VTC/UpdatedEquityResearchDefinitions.pdf)
- Same doc: uncertainty is set from bull and bear scenarios chosen so there is a 25% probability of doing better than bull and 25% of doing worse than bear; distance between them indicates uncertainty; drivers include operating and financial leverage, sales cyclicality, product concentration, pricing power, ESG exposure Source: [Morningstar definitions](https://advisor.morningstar.com/Enterprise/VTC/UpdatedEquityResearchDefinitions.pdf)
- Same doc: moat = structural feature that sustains ROIC above WACC; five sources: intangible assets, switching costs, network effect, cost advantage, efficient scale. Narrow moat = more likely than not to earn normalized excess returns for at least 10 years; wide = very high confidence for 10 years and more likely than not for 20. Moat trend positive / stable / negative. A firm is denied a moat if a sufficiently likely value-destructive risk (ESG, disruption, financial health) exists Source: [Morningstar definitions](https://advisor.morningstar.com/Enterprise/VTC/UpdatedEquityResearchDefinitions.pdf)
- Same doc: Capital Allocation (Stewardship) Rating: Exemplary, Standard, Poor; covers balance sheet, investments, distributions; forward-looking, absolute; process changed on 2020-12-09 Source: [Morningstar definitions](https://advisor.morningstar.com/Enterprise/VTC/UpdatedEquityResearchDefinitions.pdf)
- Star rating has four components: moat, fair value estimate, uncertainty, and current market price : per search summary of the 2023 methodology PDF [Morningstar Equity Research Methodology 2023-06-14](https://s205.q4cdn.com/437373358/files/doc_downloads/2025/07/Morningstar-Equity-Research-Methodology-2023-06-14.pdf) (direct fetch returned 403; content not verified by me beyond the search snippet)
- Fair value: three-stage DCF. Stage I explicit forecast "can last from five to 10 years" Source: [Morningstar UK: how can you determine what a stock is really worth](https://www.morningstar.co.uk/uk/news/143830/how-can-you-determine-what-a-stock-is-really-worth.aspx); an older glossary describes the explicit period as years 1 to 5 Source: [Morningstar glossary: Fair Value](https://awgmain.morningstar.com/webhelp/glossary_definitions/stocks/stocksglossary_Morningstar_Fair_Value.html). Stage II uses a formula to approximate cash flows, and wide/narrow moat firms fade slower; Stage III assumes ROIC equals cost of capital; all stages discounted at WACC, minus debt and off-balance-sheet items gives equity value Source: [How Morningstar values stocks (Morningstar.ca)](https://morningstar.ca/ca/news/188241/how-morningstar-values-stocks.aspx); [Morningstar 2014 methodology PDF (older)](https://s21.q4cdn.com/198919461/files/doc_downloads/press_kits/2014/MorningstarEquityResearch_Methodology.pdf)
- Quantitative ratings (for stocks without analyst coverage): buffer of +/-5% between breakpoints; valuations estimated weekly, star rating daily : search summary of [Morningstar Quantitative Equity Research, effective 2 Dec 2024](https://s21.q4cdn.com/198919461/files/doc_downloads/2024/11/Quantative-Equity-Research-Effective-2-Dec-2024.pdf) (direct fetch returned 404; not verified)
- Style box: nine-square grid of three size by three style; horizontal style axis = growth score minus value score; fund style uses 10 factors (5 value, 5 growth) Source: [Morningstar UK: diversification and the style box](https://morningstar.co.uk/uk/news/59616/diversification-matters-how-to-use-the-morningstar-style-box.aspx); methodology PDF [Morningstar Style Box Methodology](https://www.morningstar.com/content/dam/marketing/apac/au/pdfs/Legal/MorningstarStyleBox_Methodology.pdf) (dated 2008 per search summary, older)
- Ownership Zone: each holding plotted in the style box; the portfolio centroid is the weighted average of holdings Source: [Morningstar glossary: Ownership Zone](https://awgmain.morningstar.com/webhelp/glossary_definitions/mutual_fund/mfglossary_ownership_zone.htm)
- Portfolio X-Ray: combines holdings across funds/ETFs/stocks; Stock Intersection shows underlying single-stock exposure across funds ranked by position size Source: [Morningstar help: X-Ray](https://www.morningstar.com/help-center/portfolio/xray); [Morningstar: hidden overlap](https://www.morningstar.com/whats-new/how-to-spot-hidden-overlap-in-your-funds-and-avoid-the-diversification-trap); [HumbleDollar walkthrough](https://humbledollar.com/forum/the-morningstar-experience-part-ii-does-your-portfolio-need-an-x-ray/)

### Inferences
- **"PIF Star" (price/fair value banded by uncertainty)**: morning check, monitoring, IC memo. A horizontal band chart: price marker over 1 to 5 star zones around the DCF value. Fully feasible: PIF has DCF with sensitivity, so the sensitivity range (bull/bear) can define uncertainty and then the published bands above. Overlap: extends existing DCF; nothing like it on holdings table today.
- **Moat checklist (five sources + trend + ROIC minus WACC spread chart)**: IC memo. 10y ROIC vs WACC line chart plus analyst-selected moat sources. Feasible from SEC financials; moat judgment stays human (IC vote).
- **Capital allocation grade (Exemplary/Standard/Poor)**: IC memo. Buybacks, dividends, net debt, M&A from SEC cash flow statement. Feasible.
- **Style box for the fund**: allocation. 3x3 heatmap with centroid dot. Feasible with market cap + simple value/growth scores from SEC data. New vs current allocation-vs-sectors view.
- **X-Ray Stock Intersection**: only matters if the fund holds ETFs; feasible via ETF holdings files (issuer sites) but lower priority.

### Gaps
- Could not read the current (2023) methodology PDF directly (403), so the exact current bands may differ from the 2020 definitions doc. Search summary did not contradict them.
- Morningstar Direct and Investor product screens and prices were not researched in depth.

## Finviz (and Finviz Elite): heatmaps, screener, signals, groups, insider, alerts, backtests

### Takeaway
Finviz's core free ideas (treemap heatmaps, groups, insider page, 60+ filter screener with signals) are directly copyable with free data. Elite adds real-time data, unlimited alerts (news, ratings, insider, SEC filings, price), export, and backtests. The January 2026 blog added insider, 52-week drawdown, market-cap and structural "themes" maps, plus theme filters in the screener. I found no official Finviz AI feature.

### Cited Findings
- Elite official page (fetched 2026-11-13): $39.50/month; annual $299.50/year ($24.96/mo); a Black Friday offer showed $149 for the first year. Features: real-time quotes incl. premarket 4:00 to 9:30 and aftermarket 4:00 to 8:00; email and push alerts for news, ratings, insider trading, SEC filings and price moves; unlimited stock, price, screener, portfolio and calendar alerts; peers, held-by, correlation and inverse correlation; Excel/CSV export; unlimited saved screener presets (50 on free); multi-layout up to 12 charts; full ETF holdings; ad-free Source: [Finviz Elite](https://finviz.com/elite)
- Backtests: not on the Elite page. Third-party claims conflict: 100+ indicators and 16 years of data vs up to 24 years across 102 indicators vs 20 years daily data; one says daily bars only, no intraday or complex multi-condition strategies Source: [Liberated Stock Trader](https://www.liberatedstocktrader.com/finviz-review/); [StockBrokers.com](https://stockbrokers.com/review/tools/finviz); [Stock Rover comparison (facts verified 2026-08-23)](https://www.stockrover.com/?p=46604)
- New maps (Finviz blog, 2026-01-23): Drawdown from 52-Week High and Gain from 52-Week Low maps (S&P 500); Insider Buying & Selling map over last six months, blue = buying, red = selling, deeper color = larger, free to all users; Market Capitalization map grouped mega to nano; Market Themes map grouping stocks by structural themes (e.g., AI split into Databases, DevOps, Compute, Model); Theme and Sub-theme filters added to screener Source: [Finviz blog: new maps](https://finviz.com/blog/new-stock-market-maps-for-market-cap-52-week-highs-lows-themes-and-insider-trading)
- Groups have heatmap views of aggregate performance by category to track rotation : per search summary of [Finviz blog](https://finviz.com/blog/new-stock-market-maps-for-market-cap-52-week-highs-lows-themes-and-insider-trading)
- Screener: one review says 67 fundamental criteria plus 30 signals; another cites 33 signals; signals include New Highs, Overbought, Insider Trading, Analyst Upgrades and chart patterns (third-party, counts conflict) Source: [FinMasters](https://finmasters.com/finviz-review/); [AAII](https://www.aaii.com/journal/article/FINVIZCOM)
- Insider page: latest insider trades and biggest trades of the week, execs and directors : per search summary of [Motley Fool: Finviz](https://www.fool.com/terms/f/finviz) and reviews above
- Elite blog mentions intraday timeframes and advanced indicators in the screener (details not captured) Source: [Finviz Elite blog: screeners](https://elite.finviz.com/blog/tag/screeners); custom chart templates for screener and stock pages Source: [Finviz blog: chart templates](https://finviz.com/blog/create-custom-chart-templates-for-screener-stock-pages-and-more/)
- "As of 2026, Finviz offers zero AI-powered capabilities" per a third-party review (single source) Source: [ChartingLens](https://chartinglens.com/blog/is-finviz-elite-worth-it)

### Inferences
- **Treemap heatmap (size = market cap, color = % change; S&P 500 by sector/industry)**: morning check. Treemap. Feasible with free daily prices for S&P 500. PIF has a correlation heatmap and sector allocation, not a market treemap. A "holdings-only" treemap (size = weight, color = day change) is a quick win.
- **Alternate map colorings (drawdown from 52w high, gain from 52w low, 6-month insider net buy/sell)**: monitoring, idea generation. Same treemap with different color metric. Feasible: PIF already ingests Form 4s and computes insider score.
- **Whole-market screener with descriptive/fundamental/technical tabs + signals (new highs, unusual volume, upgrades, insider buying)**: idea generation. Filter panel + results table + mini-chart grid. Feasible from SEC companyfacts + free prices; this is PIF's biggest gap ("no whole-market screener").
- **Groups (sector/industry/theme performance across 1W/1M/3M/YTD)**: morning check, macro. Bar chart and heatmap grid. Feasible from prices; overlaps partly with PIF macro and allocation views.
- **Themes map / theme filters**: idea generation. Requires a theme taxonomy; feasible if PIF curates theme lists (or derives from 10-K text with an LLM).
- **Screener-based alerts ("notify me when a new stock enters my saved screen")**: monitoring. Feasible once the screener exists; PIF alerts page has no screen alerts.
- **Backtest**: PIF already has a backtester (overlap).

### Gaps
- No official Finviz help page for the current signal list or filter count; numbers above are third-party and inconsistent.
- Backtest depth is unconfirmed by Finviz itself.

## Quartr (Pro): live calls, transcripts, slides, keyword alerts, student program terms

### Takeaway
Quartr Pro is free for student organizations (e.g., a student-run fund) and faculty, by application, and it is the most direct fix for PIF's missing transcripts. Pro includes live calls with real-time transcripts, slide search and slide-history comparison, keyword alerts that jump to the exact sentence with time-aligned audio, AI chat, automations and daily recaps. Exact program terms are not public.

### Cited Findings
- Student page: "Quartr Pro is free for student organizations and academic faculty"; apply via a form (organization name, university, business email) and Quartr sends a partnership proposal; includes live earnings calls and real-time transcripts for 17,000+ public companies in 65+ markets, AI chat over IR material with sourced answers, one-click live audio, automations that run a saved prompt when a company publishes or on a schedule, slide history comparison, export of charts/tables to Excel, summaries, daily recap, keyword alerts, desktop/mobile sync with offline mode. No usage limits, duration or renewal terms stated Source: [Quartr students](https://quartr.com/students)
- Note: a search-result snippet of the same page said 16,000+ companies; the fetched page said 17,000+ (page likely updated) Source: [Quartr students](https://quartr.com/students)
- Keyword alerts: notify when a word or phrase is mentioned in a public company event (earnings calls, CMDs, conferences); one click to the exact transcript sentence; audio is time-aligned; alert scope is followed companies or all public companies; desktop and mobile notifications. Other listed Pro features: AI chat, Automations, global/slide/transcript/filings search, live calls and transcripts, event calendar, watchlists, daily and weekly recaps, summaries, slide history comparison, transcript highlighting, export Source: [Quartr keyword alerts](https://quartr.com/features/keyword-alerts)
- Pricing: Pro and API are contact-sales with no published dollar figure; mobile app free Source: [Quartr pricing](https://quartr.com/pricing); [Quartr mobile](https://quartr.com/pricing/mobile); third-party listing also says contact sales Source: [GetApp](https://www.getapp.com/finance-accounting-software/a/quartr-pro/)
- Quartr says Pro and API offer live events with close to zero delay; one third-party review says Quartr MCP is included with Pro (unverified) : per search summary of [Quartr pricing/pro](https://quartr.com/pricing/pro) and [yespress](https://yespress.io/products/quartr.md)
- Brightwave announced a partnership with Quartr for earnings call data : per search summary of [Brightwave press](https://www.businesswire.com/news/home/20250409046301/en)

### Inferences
- **Apply for the Quartr student program** first: it gives PIF members transcripts, live calls and keyword alerts at no cost, inside Quartr. Whether the program allows pulling data into PIF's own app is unknown (API is a separate contact-sales product), so plan for members using Quartr alongside PIF rather than ingesting it.
- **Keyword/mention alerts across holdings' calls ("tariff", "pricing", "inventory")**: monitoring, earnings prep. Alert list with timestamp deep-links. Free-data version: feasible on SEC 8-K Exhibit 99 press releases and 10-Q/10-K text now; for calls, needs a transcript source.
- **Slide history comparison (same KPI slide across quarters)**: earnings prep. Side-by-side slide gallery. Free version: investor presentations are often filed as 8-K exhibits; partial feasibility.
- **Automations (saved prompt runs when a company publishes)**: monitoring. This is exactly an agent trigger; PIF can do the same on new EDGAR filings (it already writes AI briefs for filings, so overlap is partial; the gap is user-defined saved prompts).
- **Daily/weekly recap**: overlap with PIF Today AI recap.

### Gaps
- Program terms (duration, seats, renewal, whether data export/API is allowed, any attribution or reporting obligations) are not public; the FAQ answers did not render.
- Whether keyword alerts scan slides and filings, or only event transcripts, is not stated.

## AlphaSense (incl. Tegus): Smart Summaries, Generative Search, sentiment, expert insights, alerts, Deep Research

### Takeaway
AlphaSense's AI stack is: Smart Summaries (2023, cited bullets linked to transcript lines), Generative Search (beta by Nov 2024, later a multi-agent system with Auto Mode), Deep Research (launched 2025-06-10), Workflow Agents (Company Primer, Key Themes, Meeting Prep, etc., announced at AlphaSummit 2025), and sentence-level transcript sentiment with a normalized -99 to 99 score. Tegus adds a large expert-transcript library. Its sentiment scoring method is documented well enough to reproduce.

### Cited Findings
- Deep Research announced June 10, 2025 as an AI agent automating in-depth analysis on AlphaSense content Source: [AlphaSense press release](https://www.alpha-sense.com/press/alphasense-launches-deep-research-automating-in-depth-analysis-with-agentic-ai-on-high-value-content); coverage of it also over web and enterprise files Source: [VentureBeat](https://venturebeat.com/ai/alphasense-launches-its-own-deep-research-for-the-web-and-your-enterprise-files-heres-why-it-matters)
- Smart Summaries launched in 2023 for earnings, companies, searches and industries; summary bullets link to the exact transcript line : per search summary of [AlphaSense: AI future of research](https://www.alpha-sense.com/resources/product-articles/ai-future-of-research) and [AlphaSense GenAI](https://www.alpha-sense.com/genai). The June 15, 2023 date is from a single third-party site Source: [Vantaige](https://vantaige.io/ai-tool/alphasense)
- Generative Search open beta by November 2024, with Generative Grid in upcoming beta : per search summary of [AlphaSense blog: generative search](https://prod.alpha-sense.com/blog/product/genai-market-intelligence-generative-search)
- January 2026 updates: Generative Search over Financial Data (KPIs, funding, M&A alongside qualitative content); Channel Check Grids with period-over-period expert sentiment, 350+ tickers, 200+ grids; Workflow Agents for IB, PE/VC, IR; Auto Mode (default, matches reasoning depth to query); Verify and Ask Follow-Ups on selected text; Slide Builder exporting insights to slides; Expert Transcript Summaries in three sections (Expert Background, Expert Sentiment, Takeaways) for transcripts from Jan 2025 on Source: [AlphaSense Product Updates January 2026](https://help.alpha-sense.com/hc/en-us/articles/48824062007187-AlphaSense-Product-Updates-January-2026)
- AlphaSummit 2025 (article 2025-11-03): Workflow Agents incl. Company Primer, Industry Primer, Company Overview Slide, Key Themes, Meeting Prep, built on Deep Research; customizable scheduled agents planned; next-gen Generative Search as a "multi-agent research system"; AI-Led Expert Calls (AI Interviewer adding hundreds of calls weekly to the Tegus library of 220,000+ transcripts); acquisition of Carousel (AI Excel modeling) Source: [AlphaSummit 2025 announcements](https://alpha-sense.com/resources/product-articles/alphasummit-2025-product-announcements/)
- Expert library size conflicts across AlphaSense pages: 185,000+ vs 240,000+ vs 220,000+; experts must be at least six months out of their role at the target company : per search summary of [AlphaSense and Tegus](https://alpha-sense.com/compare/alphasense-and-tegus/) and [Expert calls](https://alpha-sense.com/solutions/expert-calls)
- Sentiment method: each sentence labeled positive/negative/neutral with confidence; document score = (positive minus negative) / total statements, adjusted for confidence, normalized against transcripts from the last two years to a -99 to 99 scale with 0 = average, ±40 = top/bottom 20%, ±99 = top/bottom 2%. Transcripts show green (positive) and red (negative) underlines with a "Hide Sentiment" toggle; Company Profile has an "Earnings Call Sentiment" section with a score per call; peers can be added for comparison; export to Excel Source: [AlphaSense help: tone shifts](https://help.alpha-sense.com/hc/en-us/articles/41711901352211)
- Search within positive or negative context for any keyword, company or watchlist Source: [AlphaSense help: sentiment search](https://help.alpha-sense.com/hc/en-us/articles/41711799773843)
- Third-party price: $10,000 to $20,000 per user per year as of April 2024 (dated, third-party) : per search summary of [IntuitionLabs](https://intuitionlabs.ai/software/pdfs/alphasense.pdf)

### Inferences
- **Sentence-level sentiment with normalized score per call/filing**: earnings prep, monitoring. Line chart of score by quarter vs peers, plus green/red sentence underlines in the document reader. Feasible today on 10-K/10-Q MD&A and 8-K press releases with an LLM or FinBERT-style classifier; reuse AlphaSense's published normalization (z-score against a 2-year cross-company window). Overlaps with PIF Lazy Prices 10-K diff (text change) but adds tone direction.
- **Search in positive/negative context ("pricing" said negatively across holdings)**: monitoring. Filtered snippet list. Feasible on filings.
- **Smart Summary with line-level citations**: earnings prep. Bulleted card where every bullet links to source text. PIF filing AI briefs exist (overlap); the gap is clickable sentence-level citations.
- **Workflow Agents (Company Primer, Key Themes, Meeting Prep)**: IC memo, earnings prep. Templated multi-step agent outputs. Directly maps to PIF agentic plans: "Pitch primer" agent that fills the pitch template from filings, DCF, ownership, insider data.
- **Generative Grid / Channel Check Grids**: IC memo. Company x question matrix. Same pattern as Koyfin Compare Matrix.
- **Verify selected text**: trust feature for student users; feasible (re-query source span).
- **Scheduled customizable agents**: monitoring; feasible via PIF scheduler (lib/scheduler.js exists).
- **Expert transcripts (Tegus)**: no free equivalent.

### Gaps
- Could not fetch the 2025 product-releases page (401), so month-by-month 2025 releases are missing.
- No official AlphaSense pricing; no student program found in this search.
- Whether sentiment scoring applies to Tegus expert transcripts is not confirmed (Jan 2026 notes mention an "Expert Sentiment" summary section only).

## Seeking Alpha Quant Ratings: factor grades methodology

### Takeaway
Five sector-relative factor grades (Value, Growth, Profitability, Momentum, EPS Revisions), A+ to F, roll up 100+ metrics into a weighted 1.0 to 5.0 Quant score (Strong Buy to Strong Sell), updated daily, with hard disqualifiers for weak grades. Weights and score cutoffs are not published. PIF's factor scorecard overlaps; the copyable parts are sector-relative grading, the disqualifier rule and the revisions factor.

### Cited Findings
- Factors: Value, Growth, Profitability, Momentum, EPS Revisions graded A+ to F, sector-relative; Value/Growth/Profitability flag mispricing, Momentum/Revisions flag timeliness; 100+ metrics total; overall rating "not a simple average", some factors weighted more, and size and risk also considered; scores 1.0 to 5.0 map to Strong Buy..Strong Sell (cutoffs not stated) Source: [SA Quant Ratings & Factor Grades FAQ](https://help.seekingalpha.com/premium/quant-ratings-and-factor-grades-faq)
- Disqualifiers: a stock cannot rate above Neutral (Hold) if Growth, Momentum or EPS Revisions is D+ or worse, or Value or Profitability is D- or worse Source: [SA FAQ](https://help.seekingalpha.com/premium/quant-ratings-and-factor-grades-faq)
- Updated once daily before market open; about 5,600 stocks; excludes stocks with no sell-side coverage (estimates and revisions are key inputs); ADRs covered, foreign-only listings not; does not use DCF or historical average multiples Source: [SA FAQ](https://help.seekingalpha.com/premium/quant-ratings-and-factor-grades-faq); coverage figure dated July 2024 per [SA article version of FAQ](https://seekingalpha.com/article/4263303-quant-ratings-factor-grades-faq)
- Designed by Steven Cress, Head of Quant Strategy Source: [SA FAQ](https://help.seekingalpha.com/premium/quant-ratings-and-factor-grades-faq)
- Seeking Alpha published a summary of a University of Kentucky study of seven years of quant ratings and factor grades (company-published) Source: [Seeking Alpha](https://seekingalpha.com/article/4683185-university-of-kentucky-study-finds-seeking-alpha-quant-ratings-beat-the-market-sa-quant)
- Seeking Alpha Premium $239/yr, Pro $2,400/yr (as reported by Koyfin's blog, Jan 2026, third-party) Source: [Koyfin blog](https://www.koyfin.com/blog/top-earnings-call-transcripts-platforms)

### Inferences
- **Factor grade card (A+ to F per factor, sector-relative percentile) + overall score + "capped at Hold because Momentum is D" explanation**: monitoring, idea generation. Five-letter-grade row and a sector percentile bar. Feasible: sector percentiles from SEC fundamentals and prices; revisions need estimates (PIF already has Street consensus and revisions). Overlap with PIF factor scorecard; the new pieces are letter grades, sector-relative ranking, and the disqualifier rule.
- Because weights are secret, PIF should publish its own weights (fits the Brier-score / track-record culture) and backtest them in the existing backtester.

### Gaps
- Metric list per factor, weights and score cutoffs are not public.
- I did not verify the University of Kentucky study itself.

## Newer AI research tools: Fiscal.ai (FinChat), Hebbia, Rogo, Brightwave, Fintool, Daloopa, BamSEC, Tikr, Stratosphere

### Takeaway
The common AI patterns are: chat over filings/transcripts with citations (Fiscal.ai, Fintool, Quartr), document-grid extraction (Hebbia Matrix), report builders and multi-agent research (Brightwave, AlphaSense), banker workflow agents with Excel (Rogo), and source-linked KPI datasets exposed to LLMs via MCP (Daloopa). Feature evidence for Fintool, Tikr and Stratosphere is thin and mostly third-party; Stratosphere appears to be the former name of FinChat/Fiscal.ai.

### Cited Findings
- Fiscal.ai: FinChat rebranded to Fiscal.ai (one source dates it 2025-06-17, with a $10M Series A led by Portage) Source: [Day Trading Toolkit review](https://daytradingtoolkit.com/reviews/finchat-review); [Ryan O'Connell review](https://ryanoconnellfinance.com/fiscal-ai-review/). Copilot answers natural-language questions over structured data and filings/transcripts/IR docs; distinctive segment and KPI data for roughly 2,000 to 2,300 companies (counts vary by source); free tier reportedly ~1 dashboard and 10 Copilot prompts/month; paid from about $24/mo (third-party, unverified) : same sources plus [Koyfin vs FinChat (TraderHQ)](https://traderhq.com/koyfin-vs-finchat/)
- Stratosphere.io: described as the same product line as FinChat/Fiscal.ai, with segment/KPI data for 2,250+ companies, AI copilot, dashboards, estimates, 13F data; conflicting prices (Free/$29/$79 vs from $19.99) (third-party) Source: [G2 Stratosphere.io](https://www.g2.com/products/stratosphere-io/reviews); [TechCompanyNews](https://www.techcompanynews.com/meet-stratosphere-io-the-best-place-for-investors-to-find-fundamental-data/); FinChat/YCharts data deal Source: [FinChat blog](https://finchat.io/blog/finchat-signs-deal-with-ycharts)
- Hebbia: Matrix runs multi-step research over large document sets with inline citations (vendor-described "Iterative Source Decomposition"); spreadsheet-like grid for document comparison; added PowerPoint/Word generation via FlashDocs acquisition in 2025; GPT-5 integration Aug 2025 (vendor benchmark claim) : per search summary of [Hebbia: What's New Oct 2025](https://www.hebbia.com/blog/the-disclosure-october-2025) and [Hebbia vs Rogo (Hebbia-authored)](https://www.hebbia.com/resources/hebbia-vs-rogo)
- Rogo: IB-focused; agent "Felix" builds models, drafts reports, assembles pitch decks; acquired Subset (Excel formula auditing / model roll-forward) in 2025 (per Hebbia-authored page, competitor source) Source: [Hebbia: Rogo competitors](https://www.hebbia.com/resources/rogo-competitors); ARR reportedly ~$2M (2024) to $15M+ (2025) to $50M+ (2026) (secondary news) Source: [CryptoBriefing](https://cryptobriefing.com/rogo-arr-triples-50m-surpasses-hebbia/)
- Brightwave: Report Builder and Blueprints (April 2025) produce shareable reports from deal-room materials; Research Agents (August 2025) multi-agent system producing reports, charts and tables; docs list Projects, Documents & Sources, Chat, Agents, Skills, Templates; $15M Series A; Quartr partnership Source: [Brightwave platform](https://www.brightwave.io/platform); [BusinessWire Apr 2025](https://www.businesswire.com/news/home/20250409046301/en); [TechIntelPro: Research Agents](https://techintelpro.com/news/ai/generative-ai/brightwave-research-agents-ai-powered-financial-analysis-tool)
- Fintool: pricing page lists unlimited AI queries, SEC filings and transcripts, advanced screening, real-time updates; third-party descriptions add an AI Feed pushing new 8-Ks and news, qualitative screening for mentions across calls and filings, and an 8-K dashboard; pricing not public; one review calls it more a historical reference than a current product (conflict) Source: [Fintool pricing](https://fintool.com/pricing); [Fintool: why](https://www.fintool.com/why); [AllMind: Fintool alternatives](https://allmind.ai/research/fintool-alternatives); vendor claim of outperforming analysts on SEC filings Source: [Fintool press](https://fintool.com/press/fintool-outperforms-analysts-sec-filings)
- Daloopa: extracts KPIs, GAAP to non-GAAP adjustments and guidance from filings and presentations into Excel with source links (vendor claims "4 to 10x" more history) Source: [Daloopa blog](https://daloopa.com/blog/analyst-best-practices/fundamental-analysis-software); Claude connector exposes discover_companies, discover_company_series, get_company_fundamentals, each value hyperlinked to its source location, most companies 10+ years; access requires contacting Daloopa Source: [Claude marketplace: Daloopa](https://claude.com/marketplace/connectors/daloopa); [Claude support: Using Daloopa](https://support.claude.com/en/articles/12220011-using-daloopa-for-financial-analysis)
- BamSEC: filings and transcripts search, alerts, highlighting, source links, table downloads; Pro $69/month billed annually, free plan without transcripts (per Koyfin blog, Jan 2026) Source: [Koyfin blog](https://www.koyfin.com/blog/top-earnings-call-transcripts-platforms); [DIYAI 2026 review](https://diyai.io/ai-tools/finance/best-equity-research-software/)
- Tikr: superinvestor tracking (10,000+ institutional investors), 100,000+ equities, 15+ years of financials, screener; Pro about $39.95/mo per one review, $19.95 per another (third-party, conflicting) Source: [TIKR](https://tikr.com/); [TraderHQ TIKR review](https://traderhq.com/tikr-terminal-review/); [DEV Community TIKR review](https://dev.to/pickuma/tikr-terminal-review-analyzing-65000-global-stocks-for-15-a-month-4epn)
- Benchmark of LLMs on extracting figures from earnings releases exists (general, not vendor-specific) Source: [Financial Datasets: EarningsBench](https://www.financialdatasets.ai/blogs/earningsbench)

### Inferences
- **KPI extraction with source links (Daloopa/Fiscal.ai pattern)**: earnings prep, IC memo. Table of company-specific KPIs (e.g., same-store sales, subscribers) by quarter with each cell linking to the sentence in the 10-Q/8-K. Feasible with an LLM over EDGAR text; validate against XBRL where tags exist. Highest-value AI feature for PIF that no current PIF view covers.
- **Document grid (Hebbia Matrix / AlphaSense Grid / Koyfin Compare Matrix)**: IC memo, peer comps. Rows = holdings or peers, columns = questions ("guidance change?", "capex plan?"), cells = cited answers. Feasible on filings.
- **Qualitative screener ("companies that mentioned X in last 10-Q")**: idea generation. Feasible via full-text search over EDGAR (SEC full-text search exists) plus LLM ranking; complements a quantitative screener.
- **8-K / filing feed with AI triage (Fintool AI Feed)**: morning check, monitoring. Overlap with PIF filings AI briefs; gap is a cross-holding feed ranked by importance.
- **Report Builder / Blueprints (Brightwave), Company Primer (AlphaSense)**: IC memo. Template-driven agent that drafts the pitch doc with citations; PIF pitches + IC voting already exist, so this is a drafting assistant inside that flow.
- **Superinvestor tracking (Tikr)**: overlap with PIF 13F live ingest and breadth.
- **Expose PIF data as MCP tools** (like Daloopa's three-tool design: discover companies, discover series, get fundamentals) so the agent system can call PIF's own data with source links.

### Gaps
- No primary-source feature docs fetched for Hebbia, Rogo, Tikr or Stratosphere; several Hebbia/Rogo claims come from Hebbia's own competitor pages.
- No public prices for Hebbia, Rogo, Brightwave, Fintool or Daloopa.
- Fintool's current operating status is contradictory across sources.

## Public pricing summary (as found 2026-11-13)

### Takeaway
Only Koyfin and Finviz publish self-serve prices officially. Quartr, YCharts, AlphaSense, Hebbia, Rogo, Brightwave and Daloopa are contact-sales. Quartr Pro is free for student organizations.

### Cited Findings
- Koyfin (official): Free / Plus $39 / Premium $79 / Advisor Core $209 / Advisor Pro $299 per month; annual saves up to 30% Source: [Koyfin plans](https://www.koyfin.com/pricing/plans-comparison/)
- Finviz Elite (official): $39.50/mo or $299.50/yr; Black Friday first-year $149 shown on 2026-11-13 Source: [Finviz Elite](https://finviz.com/elite)
- Quartr Pro: contact sales (official); free for student orgs and faculty (official) Source: [Quartr pricing](https://quartr.com/pricing); [Quartr students](https://quartr.com/students)
- YCharts: contact sales (official) Source: [YCharts plans](https://get.ycharts.com/plans)
- AlphaSense: $10k to $20k per user/yr as of April 2024 (third-party, dated) Source: [IntuitionLabs](https://intuitionlabs.ai/software/pdfs/alphasense.pdf)
- Seeking Alpha: Premium $239/yr, Pro $2,400/yr (third-party: Koyfin blog, Jan 2026) Source: [Koyfin blog](https://www.koyfin.com/blog/top-earnings-call-transcripts-platforms)
- BamSEC Pro: $69/mo billed annually (third-party: Koyfin blog, Jan 2026) Source: [Koyfin blog](https://www.koyfin.com/blog/top-earnings-call-transcripts-platforms)
- Fiscal.ai: paid from about $24/mo (third-party) Source: [Day Trading Toolkit](https://daytradingtoolkit.com/reviews/finchat-review); Tikr Pro $19.95 to $39.95/mo (third-party, conflicting) Source: [TraderHQ](https://traderhq.com/tikr-terminal-review/)

### Inferences
- For a student fund, the realistic paid-tool stack is Quartr (free via program) plus PIF's own free-data features; Koyfin Free (2 dashboards, 45-day transcripts) is a usable supplement for individual members.

### Gaps
- Morningstar Investor and Direct prices were not researched. Annual Koyfin prices are not shown on the official page.
