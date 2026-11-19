# Quantitative signals for a long-only student fund (PIF): what to add, what to fix

Research date: 2026-11-13. Scope: factor exposures, estimate revisions / earnings surprise, short interest, insider signals, 13F signals, 10-K text, earnings-call / LLM text. Every number below is as reported by the cited source. Anything not verified in this session is in a Gaps section.

Existing PIF implementation checked in code (local repo, not a web source): `lib/factors.js` is a 0-100 percentile scorecard, no regressions; `lib/estimateRevision.js` is revision breadth + drift from Yahoo earningsTrend; `lib/shortPressure.js` scores days-to-cover (capped at 10 days, 45 pts), short % float, short change, FINRA daily series; `lib/insiderSignals.js` labels an insider "routine" if they traded in the same calendar month in each of the prior 3 years, weights opportunistic 1 / new 0.6 / routine 0; `lib/thirteenFBreadth.js` computes quarter-over-quarter filer breadth; `lib/filingDiff.js` is cosine similarity on word counts plus paragraph diff of Risk Factors / MD&A / Legal Proceedings. No SUE/PEAD module, no analyst dispersion, no Loughran-McDonald tone, no earnings-call text module found.

## How to compute factor betas from free data for 39 holdings and the whole portfolio (windows, Newey-West SEs)?

### Takeaway
Ken French's library gives free daily, weekly and monthly FF3, FF5 (2x3), momentum and short-term reversal series, which is enough to run time-series regressions per holding and on the portfolio's return series. PIF's current "factor scorecard" is a cross-sectional percentile rank, not an exposure estimate, so it cannot say "the portfolio has a market beta of X with a CI of Y".

### Cited Findings
- The Kenneth French Data Library lists these datasets: "Fama/French 3 Factors" (monthly), "[Weekly]", "[Daily]"; "Fama/French 5 Factors (2x3)" monthly and "[Daily]"; "Momentum Factor (Mom)" monthly and "[Daily]"; "Short-Term Reversal Factor (ST Rev)" monthly and "[Daily]". The page's returns table referenced September 2026 when fetched on 2026-11-13 (no explicit update date shown). Source: [Kenneth French Data Library](https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html)
- McLean and Pontiff note that the relative return to high momentum stocks rose after the publication of the original momentum work, i.e. momentum is one of the cases they discuss where publication did not kill the effect. Source: [McLean & Pontiff 2016, JF (PDF)](https://Www.Gwern.net/doc/economics/2016-mclean.pdf)

### Inferences
- Recommended spec (standard practice, not a sourced number): for each holding, regress daily excess returns (price data PIF already pulls, minus RF from the same French file) on Mkt-RF, SMB, HML, RMW, CMA, plus Mom from the separate momentum file. Use a 252-trading-day trailing window for the headline exposure and a rolling 126-day or 252-day window for the "rolling exposure lines" chart. Monthly regressions over 36 to 60 months are the textbook alternative, but monthly data gives too few observations for recently added names.
- Newey-West HAC standard errors: daily returns have mild autocorrelation and heteroskedasticity; a common rule of thumb lag is floor(4*(T/100)^(2/9)) (about 6 lags for T=252). Then 95% CI = beta +/- 1.96*SE for the "exposure bar chart with confidence intervals". This is a well-known econometric rule, not verified against a source in this session.
- Portfolio exposures: two ways, and showing both is useful for students. (1) Returns-based: regress the portfolio's daily NAV return (from PIF's holdings history) on the factors. (2) Holdings-based: portfolio beta = sum of weight_i * beta_i from the per-stock regressions. If (1) and (2) disagree a lot, that flags trading or cash drag.
- Returns-based style analysis (Sharpe-style): constrained regression of portfolio returns on index/ETF returns (e.g. growth vs value vs small cap ETFs) with weights >= 0 summing to 1. This needs a quadratic-programming solver; in Node it is simpler to approximate with non-negative least squares.
- Known lag: French files update with a delay (the page showed September 2026 data in mid-November), so the last 1 to 2 months of exposures cannot be computed from French data. A workaround is to proxy factors with ETF long-short spreads for the most recent weeks, and label it as a proxy.
- Weakness of current PIF scorecard: percentile ranks within holdings+watchlist are relative to a small, already-selected universe, so "high value" means "cheaper than the other 39 names", not a market-relative tilt.

### Gaps
- AQR datasets (e.g. Quality Minus Junk, Betting Against Beta, HML Devil) are commonly at https://www.aqr.com/Insights/Datasets, but I did not open that page in this session to confirm current availability, update cadence, or terms.
- I did not find a source specifying the "right" window length for a 39-stock student fund; window choice above is a judgment call.

## What FINRA short interest data is free, cadence changes in 2025-2026, and SEC Rule 13f-2 / Form SHO status as of 2026?

### Takeaway
FINRA short interest is free, published twice a month, seven business days after each settlement date, and includes FINRA-calculated average daily volume and days to cover. A May 2026 FINRA proposal to go weekly was withdrawn on 2026-08-05. SEC Rule 13f-2 / Form SHO is not in effect: the compliance date was pushed to 2028-01-02 after a Fifth Circuit remand.

### Cited Findings
- FINRA aggregates member short positions and "publishes an industry-wide aggregate per security, free of charge, on finra.org", seven business days after the reporting settlement date. Each record has settlement date, security name, symbol, listing exchange or OTC, current aggregate short interest, change since prior date, plus FINRA-calculated average daily volume and a "days to cover" metric. Source: [SEC Release 34-105482 (SR-FINRA-2026-012), May 13, 2026](https://www.sec.gov/files/rules/sro/finra/2026/34-105482.pdf)
- Current rule: member reports are due no later than the second business day after the reporting settlement date; FINRA publishes the calendar of settlement, due and publication dates yearly. Source: [SEC Release 34-105482](https://www.sec.gov/files/rules/sro/finra/2026/34-105482.pdf)
- The proposal would have moved reporting from "a bi-monthly basis" to weekly, cut the turnaround from two business days to one, and published data "weekly, five business days after the reporting settlement date". It also added "arranged financing" positions to reportable short interest. FINRA said it considered daily reporting. Source: [SEC Release 34-105482](https://www.sec.gov/files/rules/sro/finra/2026/34-105482.pdf)
- The SEC rulemaking page for SR-FINRA-2026-012 lists it as withdrawn on 08/05/2026. Source: [SEC SR-FINRA-2026-012 page](https://www.sec.gov/rules-regulations/self-regulatory-organization-rulemaking/sr-finra-2026-012) (status from search snippet; the twice-monthly schedule therefore still applies)
- FINRA's data catalog: Rule 4560 requires members to report short positions twice a month. Source: [FINRA: About Equity Short Interest](https://www.finra.org/finra-data/browse-catalog/equity-short-interest); files at [FINRA Equity Short Interest Files](https://www.finra.org/index.php/finra-data/browse-catalog/equity-short-interest/files)
- Form SHO / Rule 13f-2: compliance first moved to January 2, 2026 by a February 2025 exemption, then on December 3, 2025 the SEC moved it to January 2, 2028, with first Form SHO filings due February 14, 2028. The Fifth Circuit remanded the rules (without vacatur) on August 25, 2025 for further consideration of cumulative economic impact. Source: [Morgan Lewis, Dec 2025](https://www.morganlewis.com/pubs/2025/12/short-sale-reporting-on-form-sho-compliance-date-further-extended-to-2028); [Akin Gump](https://www.akingump.com/en/insights/alerts/sec-extends-compliance-date-for-short-sale-reporting-rule-to-2028); [SEC press release 2025-37 (first extension)](https://www.sec.gov/newsroom/press-releases/2025-37)

### Inferences
- PIF currently takes days-to-cover from Yahoo. FINRA's own file already ships a days-to-cover and ADV per symbol for free, with a known publication calendar, so PIF can compute DTC from the authoritative source, timestamp it to the settlement date (point-in-time safe for the backtester), and store the history. Yahoo's figure has unclear as-of dates.
- FINRA "daily short sale volume" (Reg SHO) is a flow (shares sold short that day on FINRA facilities), not a position. If `shortPressure.js` treats daily short volume as short interest, that is a known misuse; it should be shown as "short volume ratio" only, next to the bi-monthly position data.
- No free security-level aggregate of large short positions from Form SHO will exist before 2028, and the rule may change after remand.

### Gaps
- I did not confirm the exact URL and file format of FINRA's Reg SHO daily short sale volume files in this session (commonly at finra.org/finra-data/browse-catalog/short-sale-volume-data).
- Borrow fee / utilization: free sources not found. Paid vendors named in the brief (S3 Partners, Ortex, IHS Markit / S&P Global Securities Finance) do not publish institutional pricing that I found; I did not verify any price. Treat cost as "contact sales".

## What does post-publication evidence say about each signal's decay?

### Takeaway
Across 97 anomalies, McLean-Pontiff find returns 26% lower out-of-sample and 58% lower post-publication; bigger in-sample effects decay more. Signal-specific evidence: PEAD is reported to have disappeared in non-microcap stocks after the mid-2000s (contested); LLM news-sentiment returns fall as LLM adoption rises.

### Cited Findings
- 97 predictors; "Portfolio returns are 26% lower out-of-sample and 58% lower post-publication"; they attribute an estimated 32% (58% minus 26%) decline to publication-informed trading. Post-publication declines are greater for predictors with higher in-sample returns; returns are higher for portfolios concentrated in high idiosyncratic risk, low liquidity stocks; predictor portfolios become more correlated with other published predictors after publication. Source: [McLean & Pontiff, Journal of Finance 71(1), Feb 2016 (PDF)](https://Www.Gwern.net/doc/economics/2016-mclean.pdf)
- After publication, short interest on the short side of anomaly portfolios rises relative to the long side (they measure short interest as shares shorted / shares outstanding). Source: [McLean & Pontiff 2016 (PDF)](https://Www.Gwern.net/doc/economics/2016-mclean.pdf)
- PEAD: Martineau, "Rest in Peace Post-Earnings Announcement Drift," Critical Finance Review 11(3-4), 2022, pp. 613-646. Coverage summarizes the finding as PEAD disappearing from non-microcap stocks starting 2001 and fully by 2006, with prices fully reflecting surprises on announcement day. Source: [now publishers CFR-0122](https://nowpublishers.com/article/Details/CFR-0122); [PDF](https://cfr.ivo-welch.info/published/papers/martineau2021rest.pdf)
- Contested: a UCLA Anderson Review brief describes a later replication on U.S. data from February 2001 to December 2024 finding drift still appears under some filters. Source: [UCLA Anderson Review](https://anderson-review.ucla.edu/is-post-earnings-announcement-drift-a-thing-again)
- LLM news signal: the later version of Lopez-Lira & Tang reports strategy returns decline as LLM adoption rises. Source: [arXiv 2304.07619](https://arxiv.org/abs/2304.07619v5)
- Financial Statement Analysis with LLMs (Kim, Muhn, Nikolaev): the arXiv listing (v3, Feb 2025) says the paper was withdrawn because a co-author found inconsistencies in data and analyses while replicating. Source: [arXiv 2407.17866v3](https://arxiv.org/abs/2407.17866v3)

### Inferences
- For a long-only fund the decay that matters is on the long leg. McLean-Pontiff's result that decay is larger for high in-sample-return anomalies argues for haircutting the headline effect sizes below (Lazy Prices 188 bp/month, CMP 82 bp/month, DTC 1.2%/month) by at least half when explaining them to students.
- The platform could show a "published year" and "post-publication status" tag next to each score so students see that, for example, PEAD is weak in large caps and the KMN LLM paper is withdrawn.

### Gaps
- No signal-specific post-publication decay study found in this session for: Lazy Prices, CMP opportunistic insiders, 13F breadth, best ideas, DTC. I did not find a source; do not state decay numbers for these.
- McLean-Pontiff's list of 97 predictors and per-predictor decay is in their appendix; not extracted here.

## Estimate revisions, SUE / PEAD, analyst dispersion

### Takeaway
PIF has revision breadth but no SUE/PEAD and no dispersion. Dispersion (Diether-Malloy-Scherbina 2002) is a cheap, long-only-relevant "avoid" signal; PEAD is weak in large caps after the mid-2000s, so SUE should be shown as context, not a buy trigger.

### Cited Findings
- Diether, Malloy, Scherbina, "Differences of Opinion and the Cross Section of Stock Returns," JF 57(5), 2002, pp. 2113-2141: stocks with higher dispersion in analysts' earnings forecasts earn lower future returns than otherwise similar stocks; effect most pronounced in small stocks and stocks that did poorly over the prior year; evidence contradicts dispersion as a risk proxy. Source: [Kellogg PDF](https://www.kellogg.northwestern.edu/faculty/mcdonald/ftp/practicum/papers/dms3.pdf); [EconPapers](https://econpapers.repec.org/RePEc:bla:jfinan:v:57:y:2002:i:5:p:2113-2141)
- PEAD decay evidence: see Martineau 2022 above. Source: [now publishers](https://nowpublishers.com/article/Details/CFR-0122)

### Inferences
- Formulas (standard definitions, not quoted from a source here): SUE = (EPS_q - EPS_{q-4}) / std dev of that difference over the prior 8 quarters (time-series SUE), or analyst-based surprise = (actual - consensus) / price. Revision breadth = (up revisions - down revisions) / number of estimates, already in PIF. Dispersion = std dev of FY1 EPS estimates / |mean estimate|.
- Free data: Yahoo's quoteSummary `earningsHistory` gives actual vs estimate for recent quarters, and `earningsTrend` (already used) has number of analysts and high/low estimates, from which a crude dispersion ((high - low) / |mean|) can be built. Std dev of estimates is not exposed by Yahoo as far as I know, so this would be a range-based proxy. Point-in-time history is not available free; I/B/E/S via WRDS is the paid standard.
- Weakness of the current revision score: Yahoo's 7d/30d revision counts are a snapshot and not stored historically, so the backtester cannot test it point-in-time. Fix: persist a daily snapshot table so history accumulates from now on.
- Visual: revision breadth histogram across holdings (x = breadth from -1 to 1) with the portfolio-weighted mean marked; SUE shown as a dot on the price chart at each report date, colored by sign.

### Gaps
- I did not fetch Bernard and Thomas (1989/1990) or a source for SUE effect sizes; no PEAD magnitude is stated here.
- No source found for a free point-in-time analyst estimate history.

## Short interest signals (ratio, days to cover, % float, borrow)

### Takeaway
Days to cover (short interest / average daily turnover) predicts returns better than the short ratio, per Hong et al. PIF's DTC component is aligned with that; the weak point is data provenance (Yahoo) and no history.

### Cited Findings
- Hong, Li, Ni, Scheinkman, Yan, "Days to Cover and Stock Returns," NBER WP 21166 (May 2015): DTC = short ratio / average daily turnover, a proxy for the cost of exiting a short; DTC predicts weak returns better than the short ratio; a long-short DTC strategy earns about 1.2% per month (as summarized from the abstract). Source: [NBER w21166](https://nber.org/papers/w21166); [PDF](https://www.nber.org/papers/w21166.pdf)
- FINRA publishes its own days-to-cover metric with each short interest release. Source: [SEC Release 34-105482](https://www.sec.gov/files/rules/sro/finra/2026/34-105482.pdf)

### Inferences
- For a long-only fund the usable leg is the short leg (avoid / trim high-DTC names), which matches PIF's "avoid" framing.
- Visual: short interest (bars, bi-monthly, from FINRA) vs price (line), dual axis, with DTC as a hover value. Mark publication dates, not just settlement dates, so students see the 7-business-day lag.

### Gaps
- No free borrow fee / utilization source verified. Paid vendor pricing not found.
- Did not verify the published journal version or final effect size of Hong et al.

## Insider signals (Form 4 opportunistic vs routine, cluster buys, Form 144)

### Takeaway
PIF's CMP implementation matches the paper's core idea. Improvements: use the SEC's free quarterly Insider Transactions Data Sets for history and backtests, add cluster-buy detection, and use the 10b5-1 flag the SEC added in 2025.

### Cited Findings
- Cohen, Malloy, Pomorski, "Decoding Inside Information," JF 2012: routine traders trade in the same calendar month for several years; opportunistic traders show no discernible timing pattern. A portfolio of opportunistic trades earns value-weighted abnormal returns of 82 basis points per month; routine traders' abnormal returns are essentially zero. Routine trades are roughly 55% of insider trades. Sample January 1986 to December 2007. Source: [NBER w16454 PDF](https://www.nber.org/papers/w16454.pdf); [NBER Digest](https://www.nber.org/digest/apr11/decoding-inside-information)
- A Harvard Law School Forum summary cites 158 bp/month for the opportunistic minus routine difference in a regression specification. Source: [HLS Forum on Corporate Governance](https://corpgov.law.harvard.edu/2012/02/03/decoding-inside-information)
- SEC Insider Transactions Data Sets: extracted from the XML portion of Forms 3, 4 and 5, updated quarterly; in July 2025 the SEC added an AFF10B5ONE element (10b5-1 plan affirmation) to the SUBMISSION file for 2023-2025 sets. Source: [SEC Insider Transactions Data Sets](https://www.sec.gov/data-research/sec-markets-data/insider-transactions-data-sets)

### Inferences
- The 10b5-1 checkbox is a direct, free flag for pre-planned trades. Combining it with CMP's calendar test should sharpen "routine" classification (a 10b5-1 sale is mechanical by construction).
- PIF's rule (same month in each of prior 3 years) needs at least 3 years of an insider's history. New insiders get weight 0.6 in the code; CMP would classify them as unclassifiable, not opportunistic. Worth labeling explicitly in the UI.
- Cluster buys (e.g. 3+ distinct insiders buying in a 30-day window) are a common practitioner screen; no source verified here for its effect size.
- Visual: insider buy/sell markers on the price chart (triangle up green for opportunistic buys, gray for routine, hollow for 10b5-1), sized by dollar value.

### Gaps
- Form 144 (proposed sales) evidence and data format not researched in this session.
- No source found for cluster-buy effect sizes or post-publication decay of the CMP signal.

## 13F signals (breadth, best ideas, crowding, concentration)

### Takeaway
Breadth and best ideas both have published evidence; PIF already computes both. Weak points: 13F is up to 45 days stale, and "best ideas" should be measured relative to benchmark weight, not raw in-portfolio weight.

### Cited Findings
- Chen, Hong, Stein, "Breadth of Ownership and Stock Returns," JFE 66 (2002): with mutual fund holdings 1979-1998, stocks in the lowest decile of prior-quarter change in breadth "underperform those in the top change-in-breadth decile by 6.38%" over the next twelve months; 4.95% after size, book-to-market and momentum adjustment. Source: [IDEAS/RePEc NBER w8151](https://ideas.repec.org/p/nbr/nberwo/8151.html); [JFE record](https://ideas.repec.org/a/eee/jfinec/v66y2002i2-3p171-205.html)
- Cohen, Polk, Silli, "Best Ideas": managers' highest-conviction holdings outperform the market and the rest of the manager's portfolio by roughly 1 to 2.5 percent per quarter depending on specification; similar results for hedge funds; best ideas of small funds outperform those of large funds by about 15% per year (per summaries of the working paper). A later version with Antón extends the sample from 24 to 37 years. Source: [LSE PDF](https://personal.lse.ac.uk/polk/research/BestIdeas.pdf); [LSE eprints](https://eprints.lse.ac.uk/24471)
- SEC Form 13F Data Sets: flattened XML extracts; since March 2024 run quarterly for the three months ending February, May, August and November. Source: [SEC Form 13F Data Sets (via data.gov)](https://catalog.data.gov/dataset/form-13f-data-sets); [SEC DERA 13F page](https://www.sec.gov/dera/data/form-13f)

### Inferences
- Cohen-Polk-Silli define best ideas relative to what a benchmark-tracking manager would hold (the overweight versus market weight), so a pure in-portfolio-weight rank will tag mega-caps (AAPL, MSFT) as "best ideas" for index-like filers. Fix: rank by (portfolio weight - market cap weight), and restrict to concentrated, active filers.
- Breadth should be computed on a stable filer set (filers present in both quarters), which PIF's `computeBreadth({filersCur, filersPrior})` appears to support; also exclude passive/index filers to reduce noise.
- Visual: 13F breadth bars (one bar per holding, change in number of filers, sorted), with a marker for the filing-lag date.

### Gaps
- Hedge fund VIP / crowding: Goldman's Hedge Fund VIP basket methodology is proprietary; no public source verified. No academic crowding effect size gathered.
- Ownership concentration (HHI of institutional holders) evidence not researched.
- A search summary said Nagel (2005) found no average breadth-change effect in a longer sample, but no citable source was opened; unverified.

## 10-K text changes (Lazy Prices, Loughran-McDonald, readability, risk factor count)

### Takeaway
Lazy Prices is the strongest published text result and PIF's cosine-similarity diff matches its basic method. Add the free Loughran-McDonald dictionary (updated March 2026) for tone, and track Risk Factors section length and change, which the paper flags as especially informative.

### Cited Findings
- Cohen, Malloy, Nguyen, "Lazy Prices," JF 75(3), 2020, pp. 1371-1415: shorting "changers" and buying "non-changers" earns up to 188 basis points per month in alpha (over 22% per year); changes predict future earnings, profitability, news and bankruptcies; no announcement effect; returns accrue when information is later revealed. Changes in language about the CEO/CFO team, litigation, or Risk Factors are especially informative. Source: [EconPapers JF record](https://econpapers.repec.org/RePEc:bla:jfinan:v:75:y:2020:i:3:p:1371-1415); [NBER w25084 PDF](https://www.nber.org/papers/w25084.pdf)
- An Alpha Architect summary attributes the 188 bp figure to the Risk Factors-based long-short portfolio's 5-factor alpha, t-stat 2.76 (secondary source). Source: [Alpha Architect](https://alphaarchitect.com/lazy-prices/)
- Loughran-McDonald Master Dictionary: updated March 2026, covers 1993-2025; seven categories (negative, positive, uncertainty, litigious, strong modal, weak modal, constraining); free for academic research, commercial use needs a license; CSV and XLSX. Source: [Notre Dame SRAF](https://sraf.nd.edu/loughranmcdonald-master-dictionary/)

### Inferences
- Since PIF is a student (academic) fund, LM dictionary use likely falls under academic terms, but PIF should confirm with the authors if the app is public-facing.
- Add: (1) LM negative and uncertainty word share in Risk Factors and MD&A, and its change vs prior year; (2) Risk Factors word count and paragraph count change; (3) keep the redline diff but sort paragraphs by "new / removed / changed" and highlight LM-negative words in the added text.
- Lazy Prices signal is slow (no announcement effect), which suits a monthly-rebalancing student fund.
- Visual: redline diff of 10-K (green insert / red strike), with a header strip showing similarity score, LM tone delta, and risk-factor length delta.

### Gaps
- Readability/fog (Li 2008, Loughran-McDonald 2014 critique of Fog) not researched in this session; no effect sizes stated.
- No post-publication decay study of Lazy Prices found.

## Earnings-call text and LLM-based signals

### Takeaway
LLM evidence is promising but fragile: Lopez-Lira & Tang show daily news-headline predictability that weakens as adoption rises; Jha et al. show ChatGPT reads capex plans from calls and high-investment-score firms have negative future abnormal returns; the Kim-Muhn-Nikolaev financial-statement paper was withdrawn. Evasiveness measures exist but return evidence is thin.

### Cited Findings
- Lopez-Lira & Tang, "Can ChatGPT Forecast Stock Price Movements?": ChatGPT labels headlines good/bad/neutral; scores significantly predict out-of-sample daily returns, subsuming traditional methods; stronger in smaller stocks and after negative news; GPT-1, GPT-2 and BERT cannot forecast returns accurately; later version reports strategy returns decline as LLM adoption rises. Results differ across versions (v1 April 2023 to latest October 2025). Source: [arXiv 2304.07619v5](https://arxiv.org/abs/2304.07619v5); [PDF v6](https://arxiv.org/pdf/2304.07619v6)
- Kim, Muhn, Nikolaev, "Financial Statement Analysis with LLMs": earlier versions claimed GPT-4 beat analysts at predicting earnings direction from anonymized statements and that trading on it gave higher Sharpe and alphas; the arXiv v3 (Feb 2025) states the paper was withdrawn after a co-author found data and analysis inconsistencies. Source: [arXiv 2407.17866v3](https://arxiv.org/abs/2407.17866v3)
- Jha, Qian, Weber, Yang, "ChatGPT and Corporate Policies" (NBER WP 32161, 2024): 74,586 call transcripts, 3,878 firms, 2006-2020; ChatGPT 3.5 answers "How does the firm plan to change its capital spending over the next year?" on a 5-point scale; a one-standard-deviation increase in the score is associated with a 0.034 standard-deviation increase in next-quarter capex; predicts capex up to nine quarters; high-score firms have significant negative future abnormal returns; validated against Duke CFO survey. Source: [IDEAS NBER w32161](https://ideas.repec.org/p/nbr/nberwo/32161.html); [ECGI PDF](https://www.ecgi.global/sites/default/files/Paper%3A%20ChatGPT%20and%20Corporate%20Policies%2A.pdf)
- Evasiveness: Liang & Carrasco Kind (2025) build an LLM-based (GPT-4, LLaMA 3.3) measure of managerial non-responses on S&P 500 transcripts and find non-responses impair the information environment for analysts and investors. Source: [IDEAS arXiv 2505.18419](https://ideas.repec.org/p/arx/papers/2505.18419.html)
- EvasionBench (arXiv 2601.09142): benchmark for evasive answers in earnings Q&A; a 4B-parameter model reaches 81.3% accuracy; it notes single-model LLM labeling without human validation raises reliability concerns; cites Gow et al. (2021) that about 11% of analyst questions get non-answers. Source: [arXiv 2601.09142](https://arxiv.org/html/2601.09142v1)
- "The Language of Evasion" (University of Limerick / S&P Global) measures question-answer semantic similarity with LLM embeddings and relates responsiveness to stock returns; results not seen in this session. Source: [UL Research Repository](https://pure.ul.ie/en/publications/the-language-of-evasion-how-semantic-similarity-between-questions/)

### Inferences
- PIF already has an OpenAI source (`lib/sources/openai.js`). A low-cost, defensible feature is a Jha-style "capex intent" and "guidance tone" score per call, shown with the prompt and the quoted sentences it relied on, so students can audit it. Treat it as a research aid, not a backtested signal, because PIF has no point-in-time transcript archive and LLMs have look-ahead risk (trained on text after the call date).
- Do not market a KMN-style "LLM beats analysts" feature: the source paper is withdrawn.
- Transcripts: no free, licensed, bulk transcript source was verified in this session.

### Gaps
- Free earnings call transcript source not verified (SEC filings rarely include transcripts; vendors such as S&P/Refinitiv are paid).
- No effect sizes gathered for call tone (e.g. Loughran-McDonald or other tone studies on calls).
- Look-ahead bias quantification for LLM signals not researched.

## Paid vs free data summary

### Takeaway
Everything PIF needs for factor regressions, short interest positions, insider and 13F history, and 10-K text is free from French, FINRA, SEC and Notre Dame. Paid is only needed for borrow fees/utilization, point-in-time analyst estimates, and transcripts.

### Cited Findings
- Free: French library factors Source: [French](https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html); FINRA short interest Source: [FINRA](https://www.finra.org/finra-data/browse-catalog/equity-short-interest); SEC Forms 3/4/5 data sets Source: [SEC](https://www.sec.gov/data-research/sec-markets-data/insider-transactions-data-sets); SEC 13F data sets Source: [SEC DERA](https://www.sec.gov/dera/data/form-13f); LM dictionary Source: [SRAF](https://sraf.nd.edu/loughranmcdonald-master-dictionary/)

### Inferences
- WRDS (I/B/E/S, CRSP, Compustat) is often available through a college library license; Pitzer/Claremont access should be checked with the library rather than assumed.

### Gaps
- No public pricing found for S3 Partners, Ortex, S&P Global (IHS Markit) Securities Finance, or WRDS. Not stated.
- EDGAR full-text search (efts.sec.gov) capabilities and limits not checked in this session.
