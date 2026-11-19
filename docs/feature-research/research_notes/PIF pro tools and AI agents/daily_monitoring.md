# Daily monitoring and alerting for a ~39-holding, long-only, ~$160K student-managed fund

Research date: 2026-11-13. Scope: what PIF should check daily, weekly, quarterly and on events, with trigger rules, data sources and alert-fatigue controls. Every cited line was read in a fetched page or PDF unless marked "(search snippet only)". Thresholds not traced to a source are labeled "design choice".

## What do PM morning routines and risk dashboards include (practitioner accounts, CFA Institute, MSCI/Axioma/FactSet)?

### Takeaway
Vendor risk documentation centers daily monitoring on ex-ante tracking error, risk decomposition (factor vs stock-specific), active exposures and each holding's contribution to risk, updated daily. I found no primary practitioner write-up of a PM "morning routine" good enough to cite. That part is a gap.

### Cited Findings
- MSCI's Barra-on-FactSet factsheet says daily model updates exist to improve "risk monitoring, exposure control, intra-month portfolio rebalancing, scenario/stress testing, and backtesting" (search snippet only) Source: [MSCI, Barra Analytics on FactSet](https://www.msci.com/resources/factsheets/Barra_Analytics_on_FactSet.pdf)
- Standard Barra analytics show portfolio, factor and asset-level risk in absolute and benchmark-relative terms: tracking error, risk split into common-factor and stock-specific parts, active exposures, and contributions to risk (search snippet only) Source: [MSCI, Barra Analytics on FactSet](https://www.msci.com/resources/factsheets/Barra_Analytics_on_FactSet.pdf)
- Barra Aegis uses marginal contribution to active risk (MCAR) to show which assets or factors diversify the portfolio and which concentrate its risk (search snippet only) Source: [MSCI, Barra Aegis Portfolio Manager and Optimizer](https://www.msci.com/documents/10199/242721/Barra_Aegis_Portfolio_Mgr_and_Optimizer.pdf)
- BarraOne report types include VaR analysis, the five worst stress scenarios with their P&L impact, and percent contribution to total risk (search snippet only) Source: [MSCI BarraOne Factsheet](https://www.msci.com/downloads/web/msci-com/data-and-analytics/risk-management-insights/MSCI%20BarraOne%20Factsheet.pdf)
- Liquidity monitoring: days to liquidate = position size / (ADV x participation rate). Man Group calls a typical participation rate "less than 10%" and stresses it to 5% of ADV (search snippet only) Source: [Man Group, Limitations of liquidity risk frameworks](https://www.man.com/insights/limitations-liquidity-risk-frameworks)
- Mazars' liquidity tool examples use a 15% participation rate with ADTV on a 6-month rolling average, and a 20% rate in a stressed chart (search snippet only) Source: [Mazars Liquidity Tool](https://www.mazars.co.uk/industries/financial-services/quantitative-solutions/mazars-liquidity-tool)
- Financial Edge buckets positions by days to sell under stress: under 1 day, 1 to 3, 3 to 7, over 7 (search snippet only) Source: [Financial Edge, Assessing liquidity and capacity for mutual funds](https://www.fe.training/?p=10014230)
- No single regulatory participation-rate convention turned up. Rates in the sources range from 5% (stress) to 20%. : same three sources above

### Inferences
- At a ~$160K fund with ~39 positions (about $4K average), days-to-liquidate is close to zero for any US large/mid cap. A liquidity alert only matters for microcaps, thin ETFs or names that move to OTC. A cheap check: flag any holding where position value exceeds a small fraction of its 20-day dollar ADV (fraction is a design choice; the sources above use 5 to 20% participation).
- Factor risk models (Barra/Axioma) are paid. A free stand-in: compute each holding's beta to SPY and to its sector SPDR ETF, plus residual volatility, from daily prices. That gives a rough "systematic vs stock-specific" split and a contribution-to-risk ranking (weight x volatility x correlation). This approximates, and is not equal to, a factor model.
- Ex-ante tracking error vs the fund's benchmark, and its change week over week, is the main dashboard number pros watch that PIF does not show today (based on the feature list given).

### Gaps
- No primary, citable practitioner account of a PM morning routine (Bloomberg/FactSet morning workflow, sell-side morning notes) was found in the time budget. Do not present any specific "PM morning checklist" as industry standard without a source.
- Axioma and FactSet's own risk documentation were not fetched.
- CFA Institute primary curriculum text on monitoring was not reached; only third-party study notes (see the rebalancing section).

## What do SMIF best practices and IPS documents say about monitoring, rebalancing and stop-loss/review triggers?

### Takeaway
Real SMIF IPS documents set hard position caps (10% is common in the examples found), cash bands, sector bands relative to the benchmark, a deadline to cure a breach, and reporting cadences (weekly updates, monthly and quarterly reports). Stop-loss rules appear as triggers for a review or emergency meeting, not automatic sells. One UConn report describes a 10 to 20% decline from purchase price as the usual review level.

### Cited Findings
- Carlson Growth Fund (Minnesota): no single equity above 10% of portfolio market value; if market moves push a weight above 10%, it "shall be reduced below 10% within ten business days" Source: [Carlson Growth Fund IPS (2015)](https://carlsonschool.umn.edu/sites/carlsonschool.umn.edu/files/inline-files/CGF%20investment%20policy%20statement%20-%20APPROVED%2020150924.pdf)
- Carlson: fully invested, no more than 10% cash, with a stated exception for settlements and adverse markets Source: [Carlson Growth Fund IPS](https://carlsonschool.umn.edu/sites/carlsonschool.umn.edu/files/inline-files/CGF%20investment%20policy%20statement%20-%20APPROVED%2020150924.pdf)
- Carlson: sector exposure +/-50% of benchmark weight for sectors over 10% of the benchmark, +/-100% for sectors under 10%; benchmark is Russell 2500 Growth; target roughly equal weights (20 positions about 5% each) Source: [Carlson Growth Fund IPS](https://carlsonschool.umn.edu/sites/carlsonschool.umn.edu/files/inline-files/CGF%20investment%20policy%20statement%20-%20APPROVED%2020150924.pdf)
- Carlson: monthly reports to participants by the 10th day after month-end; written quarterly reports; annual meeting; sufficient float and volume required so the fund can trade "without creating extraordinary price movements" Source: [Carlson Growth Fund IPS](https://carlsonschool.umn.edu/sites/carlsonschool.umn.edu/files/inline-files/CGF%20investment%20policy%20statement%20-%20APPROVED%2020150924.pdf)
- Loughborough Student Initiative Fund: up to 32 stocks, no holding above 10% of NAV, cash no more than 5% after the first 12 months; the committee is encouraged to set "a defined stop-loss trigger and action plan for each stock" Source: [Loughborough constitution (Dec 2023)](https://lsmf.lboro.ac.uk/wp-content/uploads/2024/11/The-Loughborough-Student-Initiative-Fund-Constitution-updated-Dec-2023.pdf)
- Loughborough: the Chair may call an emergency meeting on extraordinary adverse markets or a triggered stop loss; at a stop-loss meeting the committee may replace the stock with one from the last proposal round or use pre-planned fallbacks; board gets quarterly performance reports Source: [Loughborough constitution](https://lsmf.lboro.ac.uk/wp-content/uploads/2024/11/The-Loughborough-Student-Initiative-Fund-Constitution-updated-Dec-2023.pdf)
- UConn SMF: if a price trended toward the pre-set stop loss ("traditionally 10-20% of buying price") or neared the price target, managers had to update models and reassess the allocation; each meeting, managers gave weekly updates on their stocks and flagged news that helped or threatened the position Source: [UConn SMF Team White Fall 2024 report](https://smf-business.media.uconn.edu/wp-content/uploads/sites/818/2025/01/SMF-Team-White-Fall-2024-Long-Report.pdf)
- Oral Roberts SMIF IPS ties position limits to twice the stock's Russell 1000 weight or 5% at purchase (search snippet only, rule wording not verified) Source: [ORU Semester Report Spring 2026](https://oru.edu/pdfs/cob/Semester%20Report%20-%20Spring%202026.pdf)
- NAU SMIF sets asset-class ranges (e.g. equities 75% to 95%) and requires trades to stay inside allocation and diversification guidelines (search snippet only) Source: [NAU SMIF IPS (rev. Nov 2016)](https://legacy.nau.edu/wp-content/uploads/sites/80/2018/06/NAU_SMIF_IPS-RevisedNovember2016.pdf)

### Inferences
- PIF already checks position size, sector size, count, min cash and share classes. Gaps vs these IPSs: (1) a cure deadline (Carlson's "ten business days") with a countdown on the breach; (2) sector limits relative to the benchmark rather than absolute; (3) a "drawdown from cost" review trigger that opens a thesis review (UConn's 10 to 20% from buying price; Loughborough's per-stock stop-loss plan) rather than a sell signal; (4) an "approaching" warning before a hard breach (e.g. at 90% of the cap; design choice).
- Stop-loss as "review trigger + meeting agenda item" fits SMIF governance better than auto-sell, because trades need a vote in every SMIF found.

### Gaps
- No Journal of Financial Education or other SMIF survey article was read; claims about what "most SMIFs" do are not supported here.
- ANU SMF IPS has an "Ongoing review of investments" section, not read: [ANU SMF IPS (2022)](https://rsfas.anu.edu.au/sites/default/files/2022-07/ANU%20SMF%20Investment%20Policy%20Statement%20%28Approved%2024%20May%202022%29.pdf)

## What does research say about alert fatigue and notification design (clinical literature, Google SRE)?

### Takeaway
Both fields say the same thing: send few alerts, make each one actionable, tier by severity, interrupt only for the severe tier, and move the rest to a dashboard or digest. Clinical studies show that when alerts are noisy, most get overridden.

### Cited Findings
- Google SRE book: alerts go to tickets, email, or pages; email alerts are "rarely read or acted on," and the chapter recommends a dashboard for ongoing subcritical problems instead Source: [Google SRE Book, ch. 6 Monitoring Distributed Systems](https://sre.google/sre-book/monitoring-distributed-systems/)
- SRE: "Every page should be actionable"; "If a page merely merits a robotic response, it shouldn't be a page"; pages should be about a novel problem Source: [Google SRE Book, ch. 6](https://sre.google/sre-book/monitoring-distributed-systems/)
- SRE checklist for an alert rule: is it urgent, actionable and not otherwise detected; could I ever ignore it as benign; can it wait until morning or be automated; are others already paged for the same issue Source: [Google SRE Book, ch. 6](https://sre.google/sre-book/monitoring-distributed-systems/)
- SRE: when pages come too often, people "second-guess, skim, or even ignore incoming alerts"; avoid alerting on "something seems a bit weird"; focus on symptoms over causes Source: [Google SRE Book, ch. 6](https://sre.google/sre-book/monitoring-distributed-systems/)
- AHRQ PSNet defines alert fatigue as clinicians becoming "desensitized to safety alerts" and ignoring them; it cites ~187 ICU monitor warnings per patient per day and VA primary care clinicians getting 100+ alerts per day Source: [AHRQ PSNet, Alert Fatigue primer](https://psnet.ahrq.gov/primer/alert-fatigue)
- PSNet mitigation: "Tier alerts according to severity"; "Make only high-level (severe) alerts interruptive"; tailor alerts to the patient's characteristics; cut clinically inconsequential alerts Source: [AHRQ PSNet, Alert Fatigue primer](https://psnet.ahrq.gov/primer/alert-fatigue)
- A JMIR Medical Informatics review of 23 articles found average CPOE alert override rates of 46.2% to 96.2% (search snippet only) Source: [JMIR Med Inform 2020;8(7):e15653](https://medinform.jmir.org/2020/7/e15653/)
- A 2026 preprint meta-analysis of 44 studies reported a pooled drug-drug-interaction override rate of 79.8%; not yet peer reviewed (search snippet only) Source: [JMIR preprint 88578](https://preprints.jmir.org/preprint/88578)
- Ray et al. (2026), a review of systematic reviews, found only one article gave an operational definition of alert fatigue; common metrics were alert quantity, override rate and acceptance rate (search snippet only) Source: [Ray, Wilson et al. 2026](https://www.metrohealth.org/globalassets/metrohealth-documents/population-health-research-institute/ray-wilson-et-al-2026-alert-fatigue-systematic-review.pdf)

### Inferences
- Map to PIF: Tier 1 "interrupt" (push/email now): IPS hard breach, 8-K items 1.03/3.01/4.02, delisting/OTC, dividend cut on a held name, move beyond the high sigma threshold. Tier 2 "inbox, no push": earnings gaps, analyst/estimate revisions, insider buys, approaching-limit warnings. Tier 3 "digest only" (Today page / weekly brief): routine 8-Ks (5.07 vote results, 7.01 Reg FD), small moves, calendar items.
- Track PIF's own "acceptance rate" like the clinical metrics: how often a notification is opened or acted on, per alert type. Types with low engagement get demoted a tier. This metric is borrowed from Ray et al.; any cutoff is a design choice.
- Dedupe: one notification per (ticker, event type, day), merging the 8-K, the price move and the news on the same name into one card. This follows the SRE "are others already paged for the same issue" question.
- Quiet hours: SRE asks "could it wait until morning". For a student fund that cannot trade overnight, nothing outside market hours needs a push except a pre-market hard event before the open. Specific hours are a design choice.

### Gaps
- No finance-specific study of alert fatigue among PMs or traders was found.
- A search snippet attributed to PSNet said Ancker et al. (2017) found overrides were not tied to workload or repeated exposure, and recommended fewer alerts per patient. The source page was not opened, so this is unverified.

## How should volatility-scaled move alerts be defined (z-score vs own vol, residual vs beta x market)?

### Takeaway
The standard academic tool is the event-study standardized abnormal return: fit a market model (return = alpha + beta x market) over a quiet estimation window, take today's residual, divide by the residual standard deviation. Estimation windows of 120 to 250 trading days are typical. The sigma cutoff for an alert is not set by any source and is a design choice.

### Cited Findings
- Estimation window is a quiet pre-event period, typically 120 to 250 trading days, and must not overlap the event window (search snippet only) Source: [EventStudyTools, Introduction to event study methodology](https://www.eventstudytools.com/introduction-event-study-methodology)
- Market model fit by OLS per firm; store intercept, beta, residual standard deviation and window length (search snippet only) Source: [Mike Nguyen, Testing in event studies](https://mike-data-analysis.share.connect.posit.cloud/testing-in-event-studies.html)
- Patell Z: each abnormal return is divided by its forecast-error-adjusted standard deviation; residual variance uses M_i minus K degrees of freedom, K = 2 for the market model (search snippet only) Source: [EventStudyTools, Significance tests](https://www.eventstudytools.com/methodology/test-statistics)
- Event days raise volatility, so the estimation-window variance understates the denominator and the test over-rejects; BMP test suggested as a more robust statistic (search snippet only) Source: [EventStudyTools, Significance tests](https://www.eventstudytools.com/significance-tests)

### Inferences
- Recommended PIF definitions (all design choices built on the event-study method above):
  - Raw z: r_today / sd(daily returns, last 60 trading days). Simple, catches big absolute moves.
  - Idiosyncratic z: (r_i - beta_i x r_SPY) / residual sd, beta and residual sd from the prior ~250 days (within the 120 to 250 range cited). Catches moves that are about the stock, not the market.
  - Sector-relative z: same, with the holding's sector SPDR ETF as the factor. Catches "the stock moved, its sector didn't."
  - For ETFs, use raw z only.
- Exclude the event day itself and earnings days from the estimation window, per the over-rejection point above, or vol will be understated after each earnings.
- PIF's existing personal move alerts (every 5 min) appear to use fixed % moves. A 3% move is routine for a high-vol name and rare for a utility; z-scores fix that. Cutoffs (e.g. 2 sigma inbox, 3 sigma push) are a design choice, not a cited convention.
- Free data: daily OHLCV from the price feed PIF already uses; SPY and the 11 Select Sector SPDRs for factors.

### Gaps
- No source found for an industry-standard sigma cutoff for alerts. MacKinlay (1997) and Patell (1976) are the primary references but were not fetched.

## Which 8-K items and filing types are most material?

### Takeaway
In Lerman and Livnat's study of 8-Ks filed 1994 through 2007, the items with the largest negative 3-day abnormal returns around the SEC filing date were bankruptcy (1.03), delisting notice (3.01), non-reliance on prior financials (4.02), material impairments (2.06) and exit/disposal costs (2.05). Item 5.02 (officer/director departures) had small average returns but significant abnormal volume, so it is a "look" alert, not a "panic" alert on average.

### Cited Findings
- New 8-K rules effective August 23, 2004 expanded required items and set a four-business-day filing deadline; all items (old and new) show abnormal volume and return volatility around the event and filing dates; some show drift after filing. Sample: 8-Ks, 10-Ks and 10-Qs filed 1994 through 2007 Source: [Lerman & Livnat, The New Form 8-K Disclosures (2008 working paper; RAST 2010)](https://archive.nyu.edu/bitstream/2451/27579/2/SSRN-id1126816.pdf)
- 3-day abnormal returns around the filing date (FD) and from event date to filing date (ED to FD), Table 3 Panel B Source: [Lerman & Livnat](https://archive.nyu.edu/bitstream/2451/27579/2/SSRN-id1126816.pdf):
  - 1.03 Bankruptcy: -11.90% (3-day FD, one significance star, the paper's weakest level); ED to FD -8.86%
  - 3.01 Delisting notice / transfer of listing: -2.90% (FD); -3.65% (ED to FD)
  - 4.02 Non-reliance on prior financial statements: -1.61% (FD); -2.34% (ED to FD)
  - 2.06 Material impairments: -1.65% (FD); -2.31% (ED to FD)
  - 2.05 Exit or disposal costs: -1.08% (FD); -1.42% (ED to FD)
  - 2.04 Acceleration of an obligation: -1.05% (FD, not significant); -2.00% (ED to FD, significant)
  - 4.01 Auditor change: -0.59% (FD); -0.84% (ED to FD)
  - 5.02 Officer/director departure or election: -0.11% (FD); -0.08% (ED to FD, not significant)
  - 1.01 Material definitive agreement: +0.41% (FD); +0.74% (ED to FD)
  - 3.03 Material modification to security holders' rights: +2.17% (FD); +3.73% (ED to FD)
- Post-filing drift (Table 3 Panel D, 90 days): 2.06 impairments -1.95%, 5.02 departures -0.45%, 5.01 change in control -3.44%, all significant Source: [Lerman & Livnat](https://archive.nyu.edu/bitstream/2451/27579/2/SSRN-id1126816.pdf)
- Abnormal volume (Table 4 Panel B, 3-day ED): 2.02 results 88%, 1.01 51%, 4.02 35%, 4.01 28%, 5.02 26%, all significant; highest abnormal volume items were bankruptcy and material modification of rights Source: [Lerman & Livnat](https://archive.nyu.edu/bitstream/2451/27579/2/SSRN-id1126816.pdf)
- 8-Ks reporting more items at once had larger reactions: 3-day abnormal volume rose from 53% (one item) to 95% (four items) Source: [Lerman & Livnat, Table 4 Panel A](https://archive.nyu.edu/bitstream/2451/27579/2/SSRN-id1126816.pdf)
- By count, 2.02 (30.1%), 1.01 (27.9%) and 5.02 (12.0%) were the most common items; 4.02 and 4.01 were each about 0.9% Source: [Lerman & Livnat, Table 2](https://archive.nyu.edu/bitstream/2451/27579/2/SSRN-id1126816.pdf)
- Dividend cuts: Liu, Szewczyk and Zantout studied 2,337 dividend reduction/omission announcements (1927 to 1999) and found no compelling post-announcement drift once earnings performance and skewness are controlled for (search snippet only) Source: [Journal of Finance 63(2), 2008, via IDEAS/RePEc](https://ideas.repec.org/a/bla/jfinan/v63y2008i2p987-1020.html)

### Inferences
- Tier 1 (push now): 1.03, 3.01, 4.02, 2.06, 2.04, and 5.01. These are rare (each under 1% of filings in the sample) and carry the biggest average negative moves, so they rarely fire and are worth an interrupt.
- Tier 2 (inbox): 2.05, 4.01, 5.02 (escalate to Tier 1 if CEO or CFO departs; this escalation is a design choice, not tested in the paper), 1.01/1.02, 3.02 (dilution).
- Tier 3 (digest): 2.02 (already covered by the earnings flow), 7.01, 8.01, 5.07, 9.01-only filings.
- A multi-item 8-K deserves a severity bump, since reactions scale with item count in the data.
- Dividend cuts: the price reaction is on the announcement; Liu et al. suggest no reliable drift afterward. So the alert is for thesis review (and income/yield tracking for the dividend ETFs), not a reason to expect further decline.
- Free source: SEC EDGAR full-text search and the per-company submissions JSON (data.sec.gov) give the item numbers on each 8-K. PIF already parses 8-K red flags with tiers; the change is to align tiers with the table above.

### Gaps
- The study's sample ends in 2007. No newer item-level study was read. Items added later (1.05 cybersecurity incidents, effective 2023) are not covered by this paper.
- No study on credit rating downgrades, credit spread moves or index additions/deletions was read in this session. Treat any thresholds for those as design choices.

## What weekly and quarterly items matter (meeting brief, attribution, thesis review, IPS review, rebalancing, 13F season)?

### Takeaway
The SMIF documents found use weekly per-stock updates at meetings, monthly and quarterly performance reports, and threshold-based breach cures. Rebalancing theory (CFA Level III, via study notes) distinguishes calendar rebalancing from threshold/corridor rebalancing, and corridor width should shrink for more volatile assets and widen with transaction costs.

### Cited Findings
- UConn SMF: managers give weekly updates on the stocks they pitched and alert the team on news that helps or threatens the position Source: [UConn SMF Fall 2024 report](https://smf-business.media.uconn.edu/wp-content/uploads/sites/818/2025/01/SMF-Team-White-Fall-2024-Long-Report.pdf)
- Carlson: monthly reports by the 10th day after month-end, written quarterly reports, annual participant meeting Source: [Carlson Growth Fund IPS](https://carlsonschool.umn.edu/sites/carlsonschool.umn.edu/files/inline-files/CGF%20investment%20policy%20statement%20-%20APPROVED%2020150924.pdf)
- Loughborough: quarterly performance reports to the board, including "a standardized, automated quarterly performance report" Source: [Loughborough constitution](https://lsmf.lboro.ac.uk/wp-content/uploads/2024/11/The-Loughborough-Student-Initiative-Fund-Constitution-updated-Dec-2023.pdf)
- Calendar vs threshold rebalancing: threshold rebalancing trades only when a weight leaves its band; it needs more frequent monitoring and has less predictable timing (third-party CFA study notes) Source: [AnalystPrep, Factors Affecting Rebalancing Policy](https://analystprep.com/study-notes/cfa-level-iii/factors-affecting-rebalancing-policy/)
- Optimal corridor width rises with transaction costs, risk tolerance and the asset's correlation with the rest of the portfolio, and falls as the rest of the portfolio's volatility rises (third-party CFA study notes) Source: [AnalystPrep, Factors Affecting Rebalancing Policy](https://analystprep.com/study-notes/cfa-level-iii/factors-affecting-rebalancing-policy/)
- Daily Barra updates are marketed for "intra-month portfolio rebalancing" (search snippet only) Source: [MSCI, Barra Analytics on FactSet](https://www.msci.com/resources/factsheets/Barra_Analytics_on_FactSet.pdf)

### Inferences
- Weekly brief additions (PIF already has move-since-date x weight): (1) contribution to return by holding and by sector vs benchmark (simple Brinson-style allocation vs selection split is a design choice; no attribution source was read); (2) list of names that crossed a review trigger this week (drawdown from cost, from 52-week high, price target reached, z-score events); (3) "thesis owner" assignment with last-reviewed date, mirroring UConn's per-pitcher weekly updates; (4) change in tracking error and top contributors to risk.
- Quarterly: IPS compliance report (a standardized automated report as Loughborough describes), corridor review of position weights, 13F season prep for followed managers, review of alert engagement by type to prune noisy alerts (from the SRE quarterly page review).
- Semester boundary: SMIFs turn over analysts each term. A "handoff" view per holding (thesis, price target, review triggers, owner) fits the Carlson 3-year approved-stock rule and UConn's owner model.

### Gaps
- 13F filing deadline (45 days after quarter end) and the resulting "13F season" timing were not verified against an SEC page in this session.
- No primary CFA Institute curriculum text was read; rebalancing points come from a study-note site.
- No source was read on performance attribution practice in SMIFs.

## Prioritized check and alert list for PIF (synthesis of the above)

### Takeaway
PIF already covers most event feeds. The biggest gaps are volatility-scaled and idiosyncratic move alerts, drawdown review triggers, breach cure deadlines and near-limit warnings, tracking error/risk contribution, tighter 8-K tiering, and alert-fatigue controls (tiers, dedupe, digest, engagement tracking).

### Cited Findings
- The source for each rule is in the sections above. Status vs PIF comes from the feature list Will gave for this task, not from reading the code.

### Inferences
Priority order (P1 = build first). Format: check | trigger | source of rule | free data | tier.

**Daily / intraday**
1. P1 Idiosyncratic move | |residual z| over a cutoff vs ~250-day market-model residual sd (cutoff is a design choice) | event-study method (EventStudyTools) | daily prices, SPY | Tier 1 at high cutoff, Tier 2 at lower. NEW: replaces fixed-% move alerts for team-level alerts.
2. P1 Sector-relative move | residual vs sector SPDR | same method, design choice | sector ETFs | Tier 2. NEW.
3. P1 IPS hard breach with cure clock | weight over cap, cash under min | Carlson "ten business days" | holdings | Tier 1. PARTIAL: breaches exist; add the countdown.
4. P1 Near-limit warning | weight within a set margin of cap (design choice) | corridor logic (AnalystPrep) | holdings | Tier 2. NEW.
5. P1 Tier-1 8-K items | 1.03, 3.01, 4.02, 2.06, 2.04, 5.01 | Lerman & Livnat | EDGAR | Tier 1. PARTIAL: realign existing tiers.
6. P2 Drawdown review trigger | decline from cost basis in the 10 to 20% range set by the fund; also from 52-week high (level is a design choice) | UConn SMF, Loughborough | prices, cost basis | Tier 2, adds to meeting agenda. NEW.
7. P2 Earnings gap | earnings-day move z-score (scaled as in item 1) | design choice | prices + calendar | Tier 2. PARTIAL: calendar exists.
8. P2 Dividend cut/omission on a holding | any declared cut | Liu et al. (no reliable drift; for review) | company dividend data / 8-K 8.01 | Tier 1 for income ETFs, Tier 2 otherwise. NEW.
9. P2 Delisting / OTC move | 8-K 3.01 or exchange notice | Lerman & Livnat | EDGAR | Tier 1. COVERED by item 5 if 3.01 is parsed.
10. P3 Liquidity | position value vs 20-day dollar ADV x participation rate (5 to 20% range in sources) | Man Group, Mazars | volume | Tier 3 except microcaps. NEW, low value at this fund size.
11. Existing (keep): price targets, personal alerts, insider buys, short pressure, estimate revisions, crowding, 13D/13G, open votes.

**Weekly**
12. P1 Tracking error and top risk contributors, week-over-week change | design choice | Barra docs describe these as core analytics | prices | brief. NEW.
13. P2 Attribution by holding and sector vs benchmark | design choice | prices + benchmark weights | brief. PARTIAL (move x weight exists).
14. P2 Review queue | every name that crossed a trigger this week, with owner and last-review date | UConn weekly updates | internal | brief. NEW.

**Quarterly / semester**
15. P2 Automated IPS compliance report | Loughborough | internal. PARTIAL.
16. P2 Alert engagement review | demote alert types nobody acts on | SRE quarterly page review; Ray et al. metrics | internal notification logs. NEW.
17. P3 13F season for followed managers. COVERED.
18. P3 Semester handoff per holding (thesis, target, triggers, owner). NEW.

**Alert-fatigue rules for all of the above**
- Three tiers: push (Tier 1), inbox (Tier 2), digest (Tier 3) : PSNet tiering; SRE pages/tickets/dashboards.
- One card per ticker per day, merging related events : SRE "already paged for the same issue".
- Scale move thresholds by each stock's own volatility (items 1, 2, 7).
- No pushes outside market hours except Tier 1 events before the open (hours are a design choice) : SRE "could it wait until morning".
- Log open/act rate per alert type and review each quarter : Ray et al. metrics, SRE quarterly review.

### Gaps
- Credit spread / rating action alerts, index addition/deletion alerts, analyst rating change and guidance change triggers: no research was read this session to support thresholds. If built, all thresholds are design choices. Free data for ratings is limited; I found no reliable free feed in this session.
- The "PARTIAL/COVERED/NEW" status labels rely on the feature list in the task brief, not a code audit.
