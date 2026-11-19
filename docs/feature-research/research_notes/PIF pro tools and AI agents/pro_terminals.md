# Pro terminals (Bloomberg, FactSet, S&P Capital IQ Pro, Visible Alpha): screens, alerts, workflows, AI agents, and free-data feasibility

Research date: 2026-11-13. About 27 search/fetch calls. Two Bloomberg pages (ASKB roadmap, Hedge Fund Alpha interview) returned HTTP 403 and could not be read; their content is only known from search snippets. Sources older than 2024 are flagged "(possibly outdated)".

PIF overlap key used below: **[HAVE]** = PIF platform already has an equivalent; **[PARTIAL]** = PIF has part of it; **[NEW]** = not in PIF today.

## 1. Most-used screens/functions per vendor (buy-side analysts and PMs)

### Takeaway
No source ranks functions by actual usage. University library guides converge on a core Bloomberg equity set (DES, FA, EE/ERN, ANR, RV, HDS, GP/HP, CN/TOP, EQS, PORT, SPLC) and a Capital IQ set (company profile, screening, comps builder, transcripts, Key Developments, annotated stock chart). Most of these PIF already covers with free data; the gaps are supply chain (SPLC), broker research, people search, and KPI/segment consensus.

### Cited Findings

**Bloomberg: library-guide core set**
- NYU Stern library "Frequently Used at Stern" list (page updated Aug 31, 2026): ANR (analyst recommendations), BETA (beta calculation), EQS (equity screener by financial criteria), ESG (ESG data portal), GC3D (3D curve surface), GP (price chart), LEAG (league tables), PEOP (people search), PIB (Public Information Books, which bundle a company's public documents into one PDF), PORT (create and track portfolios), SPLC (supply chain analysis), WACC (weighted average cost of capital). [NYU guide](https://guides.nyu.edu/bloombergguide/popular-commands)
- Same NYU page, "Stay Informed" section: DS RES (analyst/broker research), NI BRIEF (Bloomberg Briefs daily newsletters), KI ("Key insights", AI-flagged notable news on a company), QUIC ("Quick Takes" one-page guides to news topics), TOP (most popular news), BBG (Bloomberg.com articles). [NYU guide](https://guides.nyu.edu/bloombergguide/popular-commands)
- University of Delaware Lerner list (dated May 14, 2018, possibly outdated): DES (description), FA (financial analysis templates), EE (earnings estimates), ERN (earnings summary), ANR (analyst recommendations), RV (relative valuation vs. competitors), HDS ("all large shareholders"), HP (historical price/volume), GP/GPO/GIP/GEG (graphs), CN (company news), ALRT ("alerts you to price movements"), WEI/WEIF (world equity indexes/futures), ECO (economic releases by country), DVD (dividends), OMON (options), TOP (real-time news), CACS (corporate actions), SIDE (advertised institutional buyers/sellers). [UDel Lerner](https://lerner.udel.edu/seeing-opportunity/bloomberg-functions-list/)
- DES is described as the usual starting point for single-company research; RV is described as one of the most widely used functions for comparing a company to peers (summarized from Scranton and York guides via search; not fetched directly). [Scranton PDF](https://www.scranton.edu/academics/ksom/alperin/Equity-Fundamental%20Analysis.pdf); [York guide](https://researchguides.library.yorku.ca/bloomberg/equities)
- HDS is defined inconsistently across guides: "all large shareholders" (UDel) vs. institutional holdings (a Yale-linked list per search summary). [UDel Lerner](https://lerner.udel.edu/seeing-opportunity/bloomberg-functions-list/); [Texas State list](https://yiclass.wp.txstate.edu/?p=481)
- Other library guides found but not fetched: [Columbia basic commands](https://guides.library.columbia.edu/bloomberg/basic), [Duke functions](https://guides.library.duke.edu/bloomberg/functions), [HKUST function codes](https://libguides.hkust.edu.hk/bloomberg/function-codes), [CFI functions list](https://corporatefinanceinstitute.com/resources/data/bloomberg-functions-shortcuts-list).

**Bloomberg: mnemonics from the assignment that I could NOT verify from a fetched source this session:** EVTS, BI, MODL, BQL-as-function (BQL appears only as the query language, see section 4), WECO, CACT, BRC, NI (as standalone), MARS-in-Terminal. These are left in Gaps rather than described from memory.

**S&P Capital IQ (classic and Pro): core set**
- Key Developments: 125 development types, including 32 event types, from over 2,000 news sources (S&P brochure, per search summary). WRDS version describes over 160 Key Development types, such as executive changes and M&A rumors. Filterable by industry, development type, date range and geography. [S&P Capital IQ Platform Brochure](https://www.spglobal.com/content/dam/spglobal/mi/en/documents/general/S-P-Capital-IQ-Platform-Brochure.pdf); [WRDS intro](https://wrds-www.wharton.upenn.edu/pages/grid-items/introduction-capital-iq); [CBS user guide 2025](https://www.cbs.dk/sites/default/files/2025-11/sp_capital_iq_-_user_guide.pdf)
- Screening combines company, people, key development and transaction criteria in one search. [CBS user guide 2025](https://www.cbs.dk/sites/default/files/2025-11/sp_capital_iq_-_user_guide.pdf)
- Comps builder: "Comparable Company Analysis", build by entering tickers or from a company screen. [CBS user guide 2025](https://www.cbs.dk/sites/default/files/2025-11/sp_capital_iq_-_user_guide.pdf)
- Transcripts: PDF, Word, audio and presentation formats; competitors' transcripts one click away; WRDS description cites transcript history for 10,600 companies. [CBS user guide 2025](https://www.cbs.dk/sites/default/files/2025-11/sp_capital_iq_-_user_guide.pdf); [WRDS intro](https://wrds-www.wharton.upenn.edu/pages/grid-items/introduction-capital-iq)
- Annotated Stock Chart on every public company profile, lining up price moves with news and corporate actions. [CBS user guide 2025](https://www.cbs.dk/sites/default/files/2025-11/sp_capital_iq_-_user_guide.pdf)
- Capital IQ Pro Natural Language Screening converts a plain-English query into screening criteria (Oct 2025). [S&P press release Oct 22, 2025](https://press.spglobal.com/2025-10-22-S-P-Global-Redefines-Financial-Insights-with-New-AI-Powered-Multi-Document-Research-and-Analysis-Tool-in-Capital-IQ-Pro-ChatIQ)
- Other guides found, not fetched: [CMU Capital IQ guide](https://guides.library.cmu.edu/CapitalIQ/Overview), [Yale CapIQ guide](https://guides.library.yale.edu/CapIQ).

**FactSet: core set**
- StreetAccount: real-time company/market news summaries, with email delivery real-time or batched every couple of hours. [StreetAccount brochure](https://go.factset.com/hubfs/Website/Resources%20Section/Brochures/streetaccount-brochure.pdf)
- FactSet Estimates data can show broker revisions after new information and flag out-of-consensus views. [FactSet solutions for research brochure](https://insight.factset.com/hubfs/Resources%20Section/Brochures/solutions-for-research-brochure.pdf)
- I did not reach a FactSet source that lists its most-used Workstation screens by name (e.g., "Company Snapshot", "Universal Screening"). Left as a gap.

**Visible Alpha**
- Consensus estimates and financials on over 1 million line items, an average of 156 line items per company, covering KPI, segment, income statement, balance sheet and cash flow, across over 7,300 companies and 170+ industries with 200+ contributors (Mar 25, 2025). Line-item search, curated peer groups, and click-through from a number to the source document and broker model. [S&P press release Mar 25, 2025](https://press.spglobal.com/2025-03-25-S-P-Global-Market-Intelligence-Launches-Visible-Alpha-on-S-P-Capital-IQ-Pro-Platform)
- Later figures: over 260 model contributors; Nomura models added via the "Visible Alpha Insights" offering; 50+ new contributors in the prior 12 months (Oct 2025). [S&P Global, Nomura on Visible Alpha](https://www.spglobal.com/market-intelligence/en/news-insights/research/2025/10/nomura-securities-is-now-available-in-s-and-p-globals-visible-alpha-models-consensus)
- In the S&P AI Data Portal, Visible Alpha consensus includes revenue by product, margin assumptions and operating KPIs, with contributor counts and estimate dispersion per figure; 8,000+ companies, 200M+ data points. [PR Newswire, Visible Alpha in AI Data Portal](https://www.prnewswire.com/news-releases/sp-global-brings-visible-alpha-data-to-the-sp-global-ai-data-portal-302909006.html); [Kensho](https://kensho.com/news/visible-alpha-data-available-ai-data-portal)
- Capital IQ Pro Oct 2025 release added Visible Alpha "Estimates Summary pages" and "NAV Estimates". [S&P press release Oct 22, 2025](https://press.spglobal.com/2025-10-22-S-P-Global-Redefines-Financial-Insights-with-New-AI-Powered-Multi-Document-Research-and-Analysis-Tool-in-Capital-IQ-Pro-ChatIQ)
- S&P acquired Visible Alpha in May 2024. [S&P press release Mar 25, 2025](https://press.spglobal.com/2025-03-25-S-P-Global-Market-Intelligence-Launches-Visible-Alpha-on-S-P-Capital-IQ-Pro-Platform)

### Inferences

Feature-by-feature mapping to workflows and PIF overlap (my judgment, built on the cited descriptions):

| Feature | What it shows | Workflow | PIF overlap | Free-data feasible? |
|---|---|---|---|---|
| DES (Bloomberg) / CIQ company profile | Business description, key stats, ownership snippets | Idea generation, IC memo | [HAVE] research overview | Yes (EDGAR company facts + Yahoo/Finnhub quote) |
| FA (Bloomberg) | Standardized financial statements and ratios | Earnings prep, IC memo | [HAVE] 5y SEC financials | Yes for US filers via EDGAR XBRL; non-US and pre-XBRL history weak |
| EE / ERN (Bloomberg), FactSet Estimates | Consensus EPS/revenue, surprise history | Earnings prep | [HAVE] Street consensus and revisions | Partial. Free consensus (Yahoo, Finnhub free) gives headline EPS/revenue only, no broker-level detail |
| ANR (Bloomberg) | Broker ratings, target prices, rating changes | Earnings prep, morning routine | [PARTIAL] targets on alerts page | Partial. Aggregate rating counts available free; per-broker history mostly not |
| RV (Bloomberg) / CIQ Comparable Company Analysis | Peer multiples table | IC memo, valuation | [HAVE] peer comps | Yes for multiples computed from EDGAR + price |
| HDS (Bloomberg) | Large/institutional holders | Ownership review | [HAVE] 13F live ingest, Form 4 | Yes (13F, 13D/G, Form 4 on EDGAR) |
| GP / HP / Annotated Stock Chart (CIQ) | Price chart; CIQ overlays news and corporate actions on the chart | Morning routine, post-mortem | [PARTIAL] charts exist; event annotation likely missing | Yes. Overlay 8-K dates, Form 4 trades, earnings dates on the price chart. Strong [NEW] candidate |
| CN / TOP / KI / StreetAccount | Company news; KI is AI-flagged "key insights" | Morning routine | [PARTIAL] Today page AI recap | Partial. Free news APIs exist but no curated StreetAccount-style summaries; LLM summarization of 8-Ks and free headlines can approximate |
| EQS / CIQ screening / NL Screening | Multi-criteria stock screens; CIQ adds people, key-dev and transaction criteria; NL screening turns English into criteria | Idea generation | [PARTIAL] factor scorecard is within holdings+watchlist only | Yes for a universe screener on EDGAR fundamentals; NL-to-screen via LLM is a strong [NEW] agent tool |
| SPLC (Bloomberg) | Supplier/customer relationships | Idea generation, risk review | [NEW] | Partial. 10-K "major customers" disclosures (ASC 280 10% customers) can be text-mined; no full graph |
| Key Developments (CIQ) | Typed event stream (exec changes, M&A rumors, buybacks, guidance) | Morning routine, alerts | [PARTIAL] red-flag filing scanner, filings AI briefs | Yes for filing-driven events (8-K item codes map well to many types); rumor/news types no |
| Transcripts (CIQ, FactSet) | Earnings call text, audio | Earnings prep | [NEW] | Weak. No reliable free full-transcript source confirmed this session |
| Visible Alpha KPI/segment consensus | Street forecasts for operating KPIs (units, same-store sales, ARPU), segment revenue, dispersion, link to broker model | Earnings prep, thesis tracking | [NEW] | No. Broker models are licensed. PIF can show reported KPI history from 10-K/10-Q XBRL segments and let members log their own KPI forecasts ("club consensus") |
| PIB (Bloomberg) | One-PDF bundle of a company's public documents | IC memo prep | [PARTIAL] filings tab | Yes. Generate a packet from EDGAR filings + PIF notes |
| PEOP / LEAG (Bloomberg) | People search; league tables | Networking/banking, less PM-relevant | [NEW] | Low priority for a fund |

### Gaps
- No usage-ranked list per vendor exists in the sources found; the "most-used" set is inferred from overlapping library guides.
- Not verified this session: EVTS, BI, MODL, WECO, CACT, BRC, NI, MARS as a Terminal function. The Bloomberg Intelligence (BI) and MODL descriptions need a fetched Bloomberg or library source.
- FactSet Workstation screen names (snapshot, screening, PA report names) not confirmed from a fetched page.
- Capital IQ Excel plug-in details not fetched.

## 2. Alert types and delivery

### Takeaway
Capital IQ has the best-documented alert taxonomy (Key Developments, news, filings, transcripts, events calendar, investment research, stock price moves, and screen entry/exit). StreetAccount documents news, keyword and portfolio-level email alerts with real-time or batched delivery. Bloomberg's ALRT is documented only as price-movement alerts in a 2018 list. Three alert types PIF lacks: screen entry/exit alerts, estimate-revision thresholds, and an AI "earnings IQ"-style instant summary when results drop.

### Cited Findings
- Capital IQ alerts cover company news including Key Developments, Filings & Annual Reports, Activity Logs, Events Calendar, Transcripts, Investment Research and Stock Price Moves. [CBS user guide 2025](https://www.cbs.dk/sites/default/files/2025-11/sp_capital_iq_-_user_guide.pdf)
- Capital IQ screening alerts notify when a company is added to or removed from a saved screen's results. [CBS user guide 2025](https://www.cbs.dk/sites/default/files/2025-11/sp_capital_iq_-_user_guide.pdf)
- Capital IQ Pro "Earnings IQ Alerts": instant notifications with earnings metrics and summaries when results are announced (Oct 2025). [S&P press release Oct 22, 2025](https://press.spglobal.com/2025-10-22-S-P-Global-Redefines-Financial-Insights-with-New-AI-Powered-Multi-Document-Research-and-Analysis-Tool-in-Capital-IQ-Pro-ChatIQ)
- S&P markets "Real-Time, Personalized Market Monitoring" in Capital IQ Pro (page found, not fetched). [S&P page](https://pages.marketintelligence.spglobal.com/FinPro_Personalized-Market-Monitoring.html)
- StreetAccount email alerts configured under My Account > My Email Alerts: overnight and end-of-day summaries, daily top-news email, country/index portfolio alerts, keyword alerts. [StreetAccount web help PDF](https://www.streetaccount.com/helpdocs/factset_streetaccount_web.pdf)
- StreetAccount delivery: real-time or batched every couple of hours; available via Workstation, web, email, app and API. [StreetAccount brochure](https://go.factset.com/hubfs/Website/Resources%20Section/Brochures/streetaccount-brochure.pdf); [TrustRadius FactSet](https://tr-web.dev.trustradius.com/products/factset)
- FactSet also has a Microsoft Teams integration brochure (delivery channel; not fetched). [FactSet for Microsoft Teams](https://go.factset.com/hubfs/Website/Resources%20Section/Brochures/factset-for-microsoft-teams-brochure.pdf)
- Bloomberg ALRT: "Alerts you to price movements" (2018 list, possibly outdated). [UDel Lerner](https://lerner.udel.edu/seeing-opportunity/bloomberg-functions-list/)
- A Bloomberg video describes a market alerts function that flags when the price difference between two securities blows out (2019, possibly outdated; the mnemonic in the transcript is garbled). [Bloomberg video](https://www.bloomberg.com/news/videos/2019-04-05/get-alerts-when-price-or-yield-gaps-flag-opportunities-warnings-video)
- Bloomberg's integration API (OpenFin) exposes alert objects with conditions, expiry, frequency and time range fields. [OpenFin Bloomberg API](https://cdn.openfin.co/docs/integrations/bloomberg/2.0.0/interfaces/TerminalConnectApiTypes.Alert.html)
- Bloomberg's stated ASKB direction includes "always-on data monitoring", with the CTO describing ASKB as clients' "eyes and ears" that flags second- and third-order effects before they ask. [Fortune, Apr 28, 2026](https://fortune.com/2026/04/28/bloomberg-askb-ai-agents-lessons-from-bloomberg-cto-shawn-edwards-eye-on-ai/)
- For reference only (not a pro terminal): Chaikin's Estimate Revision Alert fires when next-quarter consensus changes by at least $0.02 and 2%, which is a concrete threshold design. [Chaikin help](https://help.chaikinanalytics.com/360020779474-Alerts-and-Alert-View)

### Inferences
Alert type matrix (vendor support per cited sources; PIF overlap from the brief):

| Alert type | Vendor evidence | PIF | Free-data feasible |
|---|---|---|---|
| Price move / level | Bloomberg ALRT, CIQ Stock Price Moves | [HAVE] price + personal alerts | Yes |
| Spread/pair divergence | Bloomberg market alerts video | [NEW] | Yes (price ratios) |
| News keyword | StreetAccount keyword alerts | [NEW] | Partial (free news APIs, rate limits) |
| Filings | CIQ Filings & Annual Reports | [PARTIAL] red-flag scanner | Yes (EDGAR RSS/full-text search) |
| Key Development / event type | CIQ Key Developments | [PARTIAL] | Yes for 8-K item codes |
| Transcripts available | CIQ Transcripts alert | [NEW] | Weak |
| Events calendar (earnings, conferences) | CIQ Events Calendar | [HAVE] earnings in 7 days, .ics | Yes |
| Investment research published | CIQ Investment Research | [NEW] | No (broker research licensed) |
| Screen entry/exit | CIQ screening alerts | [NEW] | Yes. Re-run saved screens nightly and diff |
| Instant earnings summary | CIQ Earnings IQ Alerts | [PARTIAL] filing AI briefs | Yes. Trigger LLM brief on 8-K Item 2.02 |
| Estimate revision threshold | FactSet estimate revisions (no named alert type found) | [PARTIAL] revisions shown, alert unclear | Partial (free consensus snapshots, diff daily) |
| Rating/target change | ANR data | [PARTIAL] targets | Partial |
| Ownership change | HDS/13F data | [HAVE] insider buys, 13F breadth | Yes |
| Portfolio digest (overnight / end-of-day) | StreetAccount summaries | [PARTIAL] Today page recap | Yes |
| Proactive "second-order effect" agent | Bloomberg ASKB roadmap direction | [NEW] | Yes in principle (agent over PIF's own data) |
Delivery channels across vendors: in-app, email (real-time or batched), mobile app, API, Teams. PIF has an in-app notifications inbox; batched email digest and per-alert real-time/batched choice are the cheap additions.

### Gaps
- No fetched source lists Bloomberg's current (2024-2026) alert categories (news, rating, estimate) or delivery options. ALRT details rest on a 2018 list.
- No FactSet documentation found that names estimate-revision or rating-change alert types in Workstation.
- Visible Alpha alert features not found.

## 3. Portfolio, risk and attribution views

### Takeaway
Standard pro views are performance attribution (Brinson and factor-based), ex-ante tracking error from a multifactor risk model, VaR/expected shortfall, multiple scenario/stress types, and optimization/trade simulation. Both Bloomberg and FactSet now generate AI commentary from attribution output. PIF has performance stats and contribution but not Brinson attribution, a factor risk model, ex-ante TE or scenario analysis.

### Cited Findings
- Bloomberg PORT (current product page): "customizable performance attribution tools", "advanced multi-asset risk models" (linked to MAC3 risk modeling), "four different types of scenario analysis" (factor-based, full-valuation, macroeconomic, climate), an "integrated optimization framework", AI Portfolio Commentary that writes portfolio summaries from attribution data and media coverage, automated reporting with templates and scheduled delivery. [Bloomberg PORT page](https://professional.bloomberg.com/products/bloomberg-terminal/portfolio-analytics)
- PORT ex-ante risk includes Active Total Risk (Tracking Error) based on the selected multifactor risk model, on a Tracking Error tab (2019 brochure, possibly outdated). [PORT brochure](https://ftl.hsu.edu.hk/wp-content/uploads/2019/10/port_portfolio_and_risk_analytics-brochure.pdf)
- PORT scenarios: single-factor sensitivity, or simultaneous moves across a group of factors; two methodologies, with Full Valuation mainly for fixed income (2014-era fact sheet, possibly outdated). [PORT scenario fact sheet](https://ftl.hsu.edu.hk/wp-content/uploads/2019/10/port_scenario_analysis_fact_sheet.pdf); trade simulation and optimization: [PORT trade simulation](https://ftl.hsu.edu.hk/wp-content/uploads/2019/10/port-trade-simulation-and-optimization.pdf)
- Bloomberg MARS (Multi-Asset Risk System) is a separate enterprise risk suite: full-revaluation VaR and expected shortfall, Greeks, historical/hypothetical/predictive stress tests, ex-ante tracking error, regulatory capital. [MARS brochure](https://assets.bbhub.io/promo/sites/12/1274251_Multi-Asset-Risk-System-Leave-Nothing-To-Chance.pdf)
- Search snippets of Bloomberg's portfolio analytics marketing referenced "Brinson Total Return and Factor-Based Attribution" (not confirmed on the fetched page). [Bloomberg PORT page](https://professional.bloomberg.com/products/bloomberg-terminal/portfolio-analytics)
- FactSet: Brinson falls short for multi-asset attribution; FactSet blends top-down and fixed-income attribution models. [FactSet Insight, multi-asset analysis](https://insight.factset.com/multi-asset-analysis-within-asset-management)
- FactSet notes Brinson-Fachler captures skill on one factor per iteration and offers risk-based attribution splitting excess return into Factor Effect and Stock Specific Effect. [FactSet Insight, active management part one](https://insight.factset.com/demonstrating-the-benefits-of-active-managements-part-one); [part two](https://insight.factset.com/the-benefits-of-active-management-part-two)
- FactSet multi-asset class (MAC) factor risk models capture systematic shifts across asset classes. [FactSet Insight, MAC risk models](https://insight.factset.com/the-growing-necessity-for-multi-asset-class-risk-factor-models?hs_amp=true)
- FactSet case study: a $70B+ multi-asset manager adopted Brinson and balanced attribution plus a MAC risk model and reported cutting monthly reporting time by up to three days (vendor case study). [FactSet case study PDF](https://go.factset.com/hubfs/Resources%20Section/Case%20Studies/Global_Fixed_Income_Portfolio_Management_CS.pdf)
- FactSet Portfolio Commentary: AI commentary on drivers of portfolio performance; a vendor-style claim says it cuts attribution-summary time by nearly 90%. Source was a search summary, not a fetched page; treat as unverified. [Barchart, FactSet Pitch Creator item](https://www.barchart.com/story/news/30451243/factset-launches-ai-powered-pitch-creator)

### Inferences
- **Brinson attribution (allocation, selection, interaction) vs. S&P 500 sectors** [NEW, feasible]: PIF already has holdings, transactions, and S&P sector allocation; sector weights and sector returns of the benchmark can be approximated from SPDR sector ETFs (XLK, XLF, etc.) with free prices. Supports monthly risk review and the IC report.
- **AI attribution commentary** [NEW, feasible]: both Bloomberg (AI Portfolio Commentary) and FactSet (Portfolio Commentary) ship this. PIF can feed its contribution and Brinson outputs plus news to an LLM. Low cost, high visibility for the board/IC.
- **Factor risk model and ex-ante tracking error** [PARTIAL, feasible in simplified form]: PIF has a percentile factor scorecard but not a covariance-based risk model. A returns-based model (Fama-French factors from the Kenneth French data library, which is free) can produce ex-ante TE and factor risk decomposition. It will be cruder than MAC3 or FactSet MAC.
- **Scenario/stress tests** [NEW, feasible]: historical replays (2008, 2020, 2022) using free daily prices, and factor shocks (rates via FRED, oil, market) using regression betas. Climate and full-valuation scenarios are not realistic with free data.
- **VaR/expected shortfall** [NEW, feasible]: historical-simulation VaR from free prices is straightforward.
- **Optimization / trade simulation** [NEW, feasible]: "what if I add X% of ticker" pre-trade view showing IPS checks, sector drift, TE and beta change. Fits PIF's pitch and IC voting flow.
- **Not feasible with free data**: vendor-grade fundamental risk models, fixed-income full revaluation, regulatory capital.

### Gaps
- Current FactSet Portfolio Analysis (PA) product documentation, report names and risk model list not fetched.
- Capital IQ Pro portfolio analytics not researched (no source found this session).
- Exact current attribution methods listed on the Bloomberg PORT page not confirmed beyond "customizable".

## 4. AI and agent features launched 2024-2026

### Takeaway
All four vendors moved from chat assistants (2023-2024) to agentic, citation-first systems (2025-2026). Bloomberg ASKB (beta Feb 2026, GA Oct 15, 2026) runs a multi-agent network over Bloomberg data, gives citations, hands back BQL code, and supports saved "Workflows" and the client's own chats, watchlists and files. S&P has ChatIQ, Document Intelligence 2.0, Multi-Document ChatIQ (up to 20 docs), Earnings IQ Alerts and NL screening. FactSet moved from Mercury chat to an MCP server, an agent platform from its "AI Foundry", and a Google Gemini partnership. Visible Alpha's contribution is AI-ready consensus data.

### Cited Findings

**Bloomberg ASKB**
- Introduced in beta on Feb 23, 2026: a "coordinated network of AI agents working in parallel" over Bloomberg data, news, research and analytics, built on multiple commercial and open-weight LLMs. [Traders Magazine](https://www.tradersmagazine.com/xtra/bloomberg-introduces-agentic-ai-to-the-terminal/)
- Responses include "transparent attribution" to source research and news. When an answer includes data analysis, ASKB returns the underlying BQL (Bloomberg Query Language) code, which users can extend in Excel, BQuant Desktop or BQuant Enterprise. [Traders Magazine](https://www.tradersmagazine.com/xtra/bloomberg-introduces-agentic-ai-to-the-terminal/)
- Named beta features: "ASKB Workflows" with a Workflow Library for saving and sharing templates, aimed at pre-earnings preparation, post-earnings analysis and meeting prep; "Expanded Document Analysis" (upload PDF/Word to analyze alongside Bloomberg content); "Data Visualization" (charts/tables with annotations); "Community & Collaboration" via Instant Bloomberg; "Help, Built In" for in-context function help; mobile access including Apple Vision Pro. [Traders Magazine](https://www.tradersmagazine.com/xtra/bloomberg-introduces-agentic-ai-to-the-terminal/)
- April 2026 roadmap: agents to be applied inside the Terminal's existing financial analysis and portfolio management tools (from search snippet; page returned 403). [Bloomberg ASKB roadmap](https://www.bloomberg.com/professional/insights/press-announcement/bloomberg-unveils-askb-roadmap-for-clients-to-augment-their-investment-process-with-agentic-ai/)
- ASKB builds screens on the fly and produces full research reports including financial modeling and bull/bear cases; uses alternative data (card transactions, foot traffic, satellite parking-lot images, app usage) to "nowcast" quarterly KPIs (Sweetgreen Q4 2025 example); sell-side research from 800+ providers. [Fortune, Apr 28, 2026](https://fortune.com/2026/04/28/bloomberg-askb-ai-agents-lessons-from-bloomberg-cto-shawn-edwards-eye-on-ai/)
- Architecture: routes each query to the cheapest model that meets the workflow's reliability needs; mixes Bloomberg internal models, frontier models (Anthropic named) and open-weight models. Evaluations built by domain specialists (equity analysts, bond covenant experts, journalists) per sub-agent and per full workflow; LLM judges for easy cases, humans for the rest. Data ingestion went from 4.5 months to 2 days (CTO claim). Next: agent-to-agent workflows and always-on monitoring. [Fortune, Apr 28, 2026](https://fortune.com/2026/04/28/bloomberg-askb-ai-agents-lessons-from-bloomberg-cto-shawn-edwards-eye-on-ai/)
- GA on Oct 15, 2026. New client-content features: search over Instant Bloomberg chats (3 months of history, cited to the source chat; examples: summarize contacts' views on oil, catch up on overnight chats, surface a dissenting bearish view); questions over Worksheets (watchlists), e.g. top performers, largest movers, who reports earnings this week; "Bloomberg Drive in ASKB" for persistent files and folders that can be queried with file/passage citations and shared within a firm. Bloomberg's CTO called ASKB its "most rapidly adopted" functionality (no figure given). Clients send about 40 million IB chats a day. [PR Newswire, Oct 15, 2026](https://www.prnewswire.com/news-releases/the-next-evolution-of-askb-your-insights-bloombergs-intelligence-one-conversation-302909392.html)
- Bloomberg "KI" (Key insights) flags notable company news using AI. [NYU guide](https://guides.nyu.edu/bloombergguide/popular-commands)
- Bloomberg PORT "AI Portfolio Commentary" generates portfolio summaries from attribution data and media coverage. [Bloomberg PORT page](https://professional.bloomberg.com/products/bloomberg-terminal/portfolio-analytics)

**S&P Global Capital IQ Pro**
- ChatIQ and Document Intelligence introduced Nov 2024 over filings, transcripts, investor presentations, news and research; ChatIQ made available to all users Feb 2025 (per release notes, via search summary). [Feb 2025 release notes](https://capitaliq.spglobal.com/releasenotes/announcements/february-2025-capital-iq-pro-release-notes)
- Oct 22, 2025: Document Intelligence 2.0 (analyzes large document repositories, "precise citations for full auditability"), Multi-Document ChatIQ (compare across documents, companies or industries for competitive positioning and trends), Earnings IQ Alerts, Natural Language Screening. [S&P press release Oct 22, 2025](https://press.spglobal.com/2025-10-22-S-P-Global-Redefines-Financial-Insights-with-New-AI-Powered-Multi-Document-Research-and-Analysis-Tool-in-Capital-IQ-Pro-ChatIQ)
- Multi-Document ChatIQ handles up to 20 documents at once; excluded sources include Dow Jones & Nikkei news, insurance statutory/product filings and scanned documents (Oct 2025 release notes, via search summary). [Oct 2025 release notes](https://capitaliq.spglobal.com/releasenotes/announcements/october-2025-capital-iq-pro-release-notes)
- Oct 14, 2025: Capital IQ Pro Document Intelligence on Salesforce AgentExchange, bringing transcripts and filings insights and sentiment analysis into Salesforce; full access needs an S&P license. [S&P press release Oct 14, 2025](https://press.spglobal.com/2025-10-14-S-P-Global-Launches-S-P-Capital-IQ-Pro-Document-Intelligence-on-Salesforces-AgentExchange,-Transforming-Document-Analysis-with-Generative-AI)
- Visible Alpha data now in the S&P Global AI Data Portal (AI-ready consensus with dispersion and contributor counts). [PR Newswire](https://www.prnewswire.com/news-releases/sp-global-brings-visible-alpha-data-to-the-sp-global-ai-data-portal-302909006.html)

**FactSet**
- FactSet Mercury: LLM-based knowledge agent announced in beta Dec 2023 for junior bankers (fundamentals, pricing, bank regulatory data via chat, plus a Chart Creator), buy-side release planned for spring 2024 (older, possibly outdated). [Finextra](https://www.finextra.com/pressarticle/99157/factset-launches-ai-chatbot-to-drive-efficient-workflows-for-junior-bankers); [FactSet Insight](https://insight.factset.com/how-we-use-llm-technology-to-supercharge-junior-banker-workflows)
- A conversational search agent based on Mercury was slated for early 2025 to help with pitch decks, research, memos and reports. [WatersTechnology](https://www.waterstechnology.com/emerging-technologies/7952116/factset-launches-conversational-ai-for-increased-productivity)
- Pitch Creator (2025): AI tool for bankers to give directives, use templates, build slides and surface auditable insights (search summary, not fetched). [Barchart](https://www.barchart.com/story/news/30451243/factset-launches-ai-powered-pitch-creator)
- "FactSet Intelligence" (May 2026) is the umbrella with three pillars: Data Layer, Agent Platform, Intelligent Workflows (search summary; the fetched page returned only a title). [FactSet product blog](https://www.factset.com/product-blog/launches/factset-intelligence-ai-built-for-the-way-financial-professionals-actually-work)
- Q3 FY2026 earnings call: users can discover FactSet agents and will soon build, test and publish their own agents and integrate third-party agents (search summary). [Investing.com transcript](https://www.investing.com/news/transcripts/earnings-call-transcript-factset-beats-q3-2026-estimates-as-ai-growth-lifts-outlook-93CH-4770804)
- June 30, 2026 Google Cloud partnership: Gemini models and Google enterprise search embedded in FactSet Workstation; deep research, multi-modal experiences, Google grounding; joint agents for portfolio operations, deal advisory and corporate finance on Gemini Enterprise Agent Platform; "MCP and agent sharing functionality". [Google Cloud press corner](https://www.googlecloudpresscorner.com/2026-06-30-FactSet-Announces-Strategic-Partnership-with-Google-Cloud-to-Bring-Advanced-AI-to-Financial-Intelligence)
- Sep 25, 2026: FactSet launched a public MCP server so AI models/agents can connect to FactSet data and tools, and is rolling more data onto it; agent platform built by an "AI Foundry" formed in 2026; FactSet was a partner in Anthropic's Claude for Financial Services launch (July 2025). [The AI Innovator](https://theaiinnovator.com/inside-factsets-push-to-build-an-agentic-future/)
- FactSet built its GenAI platform with Databricks (background). [Databricks blog](https://www.databricks.com/blog/factset-genai)

### Inferences
Design patterns PIF's agentic system can copy (all buildable on PIF's existing data):
1. **Citations on every answer** (ASKB, Document Intelligence 2.0). Every agent claim links to the filing section, Form 4, 13F row or PIF note it came from. Pairs with PIF's existing filing AI briefs.
2. **Show the query** (ASKB returns BQL). PIF agent should return the SQL or API call it ran against `pif.db`, so members can audit and reuse it in the backtester.
3. **Saved, shareable workflows** (ASKB Workflows / Workflow Library). Templates such as "pre-earnings prep for TICKER", "post-earnings review", "IC memo draft", "weekly holdings digest". Club members share templates.
4. **Ask your own content** (ASKB over IB chats, Worksheets, Drive). PIF equivalent: agent over club chat, notes, pitches, IC votes and watchlist. This is the most direct 1:1 copy and is unique to PIF's data.
5. **Multi-document comparison** (Multi-Document ChatIQ, 20 docs). Compare two companies' 10-K risk factors or three quarters of MD&A. PIF's Lazy Prices diff is a narrow version.
6. **NL screening** (CIQ). English to screen criteria over PIF's fundamentals and factor data.
7. **Instant earnings brief** (Earnings IQ Alerts). On 8-K Item 2.02, generate a brief vs. consensus and push to the inbox.
8. **AI attribution commentary** (Bloomberg AI Portfolio Commentary, FactSet Portfolio Commentary).
9. **Proactive monitoring agent** (ASKB "eyes and ears" roadmap). Nightly agent that scans holdings for second-order effects, e.g. a supplier's 8-K or a peer's guidance cut.
10. **Model routing and evals** (Bloomberg). Cheap model for routing/summaries, stronger model for memos; small eval set written by club members for each sub-agent.
11. **MCP exposure** (FactSet MCP server). Exposing PIF data as an MCP server lets members use Claude or other clients against the fund's data.

Not replicable: broker research corpora (800+ providers), alternative data nowcasting, Visible Alpha broker models, licensed news (Dow Jones), IB chat network.

### Gaps
- Visible Alpha standalone AI features (beyond AI Data Portal availability) not found.
- Capital IQ Pro 2026 AI releases not found in this session; latest confirmed is Oct 2025.
- FactSet's named 2026 agents are not named in any fetched source.
- ASKB pricing (included vs. add-on) not stated in fetched sources.
- Accuracy and independent evaluations of any of these AI tools: none found; all claims are vendor-sourced.

## 5. Free-data replicability and pricing

### Takeaway
Most single-company and portfolio analytics are replicable with SEC EDGAR, free price APIs, FRED and FINRA (PIF already does much of this). Not replicable: broker-level estimates and KPI consensus, broker research, full transcripts at scale, curated news, supply-chain graphs, vendor risk models, and alternative data. Pricing is not published by any vendor; the only figures are third-party.

### Cited Findings
- Bloomberg Terminal: about $31,980/year for a single seat ($2,665/month) and about $28,320/seat multi-seat; Bloomberg does not publish a rate card; figures come from client letters reported in the press; price rises every two years by roughly 6-10%; two-year contracts typical (third-party). [Koyfin blog](https://www.koyfin.com/blog/bloomberg-terminal-cost/); [Costbench](https://www.costbench.com/software/financial-data-terminals/bloomberg-terminal/)
- One outlier source cites about $25,000/user/year for Bloomberg (third-party, lower quality). [Subger](https://subger.com/en/service/bloomberg)
- FactSet: one blog puts base subscription at $12,000-$18,000 per seat per year (third-party, appears low quality; unverified). [Eulerpool](https://eulerpool.com/blog/bloomberg-terminal-cost)
- Visible Alpha on Capital IQ Pro is a paid add-on (no price given). [S&P press release Mar 25, 2025](https://press.spglobal.com/2025-03-25-S-P-Global-Market-Intelligence-Launches-Visible-Alpha-on-S-P-Capital-IQ-Pro-Platform)
- Capital IQ Pro Document Intelligence on Salesforce requires an S&P Global Market Intelligence license; trials available. [S&P press release Oct 14, 2025](https://press.spglobal.com/2025-10-14-S-P-Global-Launches-S-P-Capital-IQ-Pro-Document-Intelligence-on-Salesforces-AgentExchange,-Transforming-Document-Analysis-with-Generative-AI)
- Capital IQ Key Developments is available to many universities through WRDS (e.g., Yale lists it among WRDS datasets). [Yale CapIQ guide](https://guides.library.yale.edu/CapIQ); [UAlberta](https://guides.library.ualberta.ca/az/capital-iq-key-developments-wrds)

### Inferences
- Claremont Colleges students may already have Bloomberg/Capital IQ/WRDS access through a library; worth checking the Claremont library guide before building (not verified this session).
- Highest-value [NEW] items buildable for free, ranked by effort vs. value: (1) screen entry/exit alerts, (2) instant earnings brief on 8-K 2.02, (3) annotated price chart with filing/insider/earnings markers, (4) Brinson attribution vs. sector ETFs plus AI commentary, (5) historical scenario replays and VaR, (6) "ask the fund" agent over club chat/notes/pitches with citations and visible SQL, (7) NL screener over an EDGAR fundamentals universe, (8) Key-Development-style typed event feed from 8-K item codes, (9) pre-trade what-if against IPS limits, (10) batched daily email digest.
- Items to skip or approximate: Visible Alpha KPI consensus (replace with reported-KPI history from XBRL plus member forecasts), transcripts (only if a free source is confirmed), SPLC (approximate from 10-K major-customer disclosures).

### Gaps
- No credible public pricing for FactSet, Capital IQ Pro or Visible Alpha.
- Free-data source terms (Yahoo, Finnhub free tier limits, free transcript sources) were not checked in this session; another researcher may cover them.
- Whether Claremont/Pitzer libraries license Bloomberg, Capital IQ or FactSet was not checked.
