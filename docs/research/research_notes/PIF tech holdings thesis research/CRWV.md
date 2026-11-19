# CoreWeave (NASDAQ: CRWV) investment thesis research, as of 2026-11-12

Most recent reported quarter: Q3 2026 (quarter ended 2026-09-30), reported 2026-11-10. All company figures below are Q3 2026 unless labeled. Figures marked "derived" are my arithmetic on sourced numbers, not company-reported. Figures older than 6 months (before 2026-05-12) are marked [OLDER].

Baseline check of the fund app's Yahoo data against the 10-Q / 8-K:
- Total cash $4.18B: matches cash and equivalents $4,122M + marketable securities $62M = $4,184M (derived). Excludes $2,282M restricted cash.
- Total debt $66.2B: matches only if leases are included. Debt $46,873M + operating leases $18,697M + finance leases $649M = $66,219M (derived). Borrowed debt alone is $46.9B.
- Revenue growth 168%: matches Q3 ($3,661M vs $1,365M).
- Trailing revenue $9.89B: consistent with 9M 2026 revenue $8,314M plus an implied Q4 2025 of ~$1.58B (derived; Q4 2025 not independently checked).
- Gross margin 66.8%: Q3 alone is ~67.7% (derived). See the depreciation caveat under question 4.
- Operating margin -0.5%: Q3 GAAP operating margin was +6%; 9M 2026 was ~0.2% (derived). Yahoo's figure is likely TTM; not verified.
- FCF -$19.7B: 9M 2026 FCF was -$17.9B (derived). Yahoo's TTM figure was not verified.
- Price $56.60, market cap $31.2B: not independently verified. Pre-earnings close was ~$48.73 on 2026-11-10 and one source says the stock closed ~$60.77 on 2026-11-11 (see question 6).

## 1. How does the company make money?

### Takeaway
CoreWeave rents GPU compute capacity, overwhelmingly under multi-year committed contracts that make up a $132.5B backlog. Concentration has dropped sharply: the top customer went from ~67% of revenue (FY2025, Microsoft) to 24% in Q3 2026, with a second customer at 30%.

### Cited Findings
- Q3 2026 revenue $3,661M vs $1,365M in Q3 2025 (+168% YoY); 9M 2026 revenue $8,314M. [CoreWeave Q3 2026 8-K press release](https://www.sec.gov/Archives/edgar/data/0001769628/000176962826000461/coreweave3q26earningspress.htm)
- Revenue up ~42% sequentially from $2.58B in Q2 2026. [Unite.AI](https://www.unite.ai/coreweave-ai-cloud-revenue-climbs-168-as-backlog-more-than-doubles/)
- Revenue backlog ~$132.5B at 2026-09-30, up 138% YoY from $55.6B. Backlog includes RPO plus other committed amounts subject to delivery and availability requirements. [8-K press release](https://www.sec.gov/Archives/edgar/data/0001769628/000176962826000461/coreweave3q26earningspress.htm); [Unite.AI](https://www.unite.ai/coreweave-ai-cloud-revenue-climbs-168-as-backlog-more-than-doubles/)
- 10-Q: unsatisfied RPO $132.3B; 36% expected to be recognized in the 24 months ending 2028-09-30, 38% in months 25 to 48, the remainder (~26%, derived) in months 49 to 86. [CoreWeave Q3 2026 10-Q](https://www.sec.gov/Archives/edgar/data/0001769628/000176962826000465/crwv-20260930.htm). Note: one secondary article misread 26% as the 24-month share; the 10-Q says 36%.
- CFO Nitin Agrawal: more than 50% of backlog is tied to contracts where delivery is expected to begin by year-end 2026. [Investing.com Q3 2026 call transcript](https://www.investing.com/news/transcripts/earnings-call-transcript-coreweave-tops-q3-2026-forecast-and-shares-rise-57-93CH-5017354)
- Customer concentration (10-Q, anonymized): Customer A 24% of Q3 2026 revenue (67% in Q3 2025), 33% of 9M 2026; Customer B 30% of Q3 2026 (<10% in Q3 2025), 26% of 9M 2026. Accounts receivable at 2026-09-30: A 18%, B 33%, C 12%, D 14%. [Q3 2026 10-Q](https://www.sec.gov/Archives/edgar/data/0001769628/000176962826000465/crwv-20260930.htm)
- Q2 2026 10-Q: top three customers were 36%, 26% and 10% of Q2 revenue. [sec-api.io summary of 10-Q](https://sec-api.io/insights/coreweave-crwv-2026-revenue-analysis-top-customer-concentration-exposure); [Q2 2026 10-Q](https://www.sec.gov/Archives/edgar/data/0001769628/000176962826000366/crwv-20260630.htm)
- FY2025 10-K: Microsoft was ~67% of FY2025 revenue; no other customer was 10%+. [OLDER] [sec-api.io](https://sec-api.io/insights/coreweave-crwv-2026-revenue-analysis-top-customer-concentration-exposure)
- OpenAI contracts total $22.4B (up to $6.5B added 2025-09-25, after $11.9B in March and $4B in May 2025). [OLDER] [PYMNTS / search summary of multiple outlets](https://www.pymnts.com/news/artificial-intelligence/2025/ai-hyperscaler-coreweave-signs-14-billion-dollar-deal-with-meta/)
- Meta signed a $14.2B contract in Sept 2025, running through 2031 with possible extension to 2032. [OLDER] [SiliconANGLE](https://siliconangle.com/2025/09/30/meta-strikes-expanded-14-2b-ai-infrastructure-deal-coreweave/); [Techzine](https://www.techzine.eu/news/infrastructure/135070/meta-signs-14-2b-billion-dollar-contract-with-coreweave-for-ai-infrastructure). A further $21B Meta expansion through Dec 2032 is reported by a single source. [OLDER, single source] [The Next Platform, 2026-04-09](https://www.nextplatform.com/cloud/2026/04/09/coreweave-takes-as-much-financial-engineering-as-it-does-datacenter-design/5215794)
- Microsoft had agreed to spend over $10B with CoreWeave by 2030 under five contracts; Microsoft deals were 62% of 2024 revenue. [OLDER figures, cited in Nov 2026 coverage] [Runtimewire](https://runtimewire.com/article/microsoft-cut-neocloud-roster-few-key-suppliers)
- CEO Mike Intrator: "more than 75% of committed CapEx" through 2027 is tied to investment-grade and enterprise customers; ~10% of backlog is financial services; 10% of the Fortune 500 are customers. [Call transcript](https://www.investing.com/news/transcripts/earnings-call-transcript-coreweave-tops-q3-2026-forecast-and-shares-rise-57-93CH-5017354)
- Pricing (Intrator): above $40M per MW per year for short-term capacity, $20 to 25M per MW for 4 to 5 year contracts. Short-term contracts pay back capex in ~6 to 18 months, longer contracts ~1 to 2 years (Agrawal). [Call transcript](https://www.investing.com/news/transcripts/earnings-call-transcript-coreweave-tops-q3-2026-forecast-and-shares-rise-57-93CH-5017354)
- Typical new contract length went from ~3 years (early 2024) to ~4 (early 2025) to mostly 5, some 6 (early 2026). [Vista Research / search summary](https://www.vistaresearch.ai/notes/coreweave-gpu-depreciation-economic-life.html) (secondary)
- New Q3 customers include Canva, Substack, Wayve, Serve Robotics; expanded with OpenAI, Jane Street, Cohere, Perplexity. Company says 9 of the 10 leading foundation model providers are customers. [8-K press release](https://www.sec.gov/Archives/edgar/data/0001769628/000176962826000461/coreweave3q26earningspress.htm)
- Nvidia agreed to buy unused CoreWeave capacity through April 2032, initially $6.3B. [OLDER] [search summary citing CoreWeave](https://www.futuriom.com/articles/news/nvidia-tops-coreweave-stake-with-2-billion/2026/01)

### Inferences
- Customer A is very likely Microsoft (67% in Q3 2025 matches the 10-K's Microsoft share), and its share fell to 24% as other contracts ramped. Customer B (30%) is likely OpenAI or Meta, but the 10-Q does not name it.
- Concentration has improved, but the top two customers are still ~54% of Q3 revenue (derived) and ~51% of receivables (derived). The business is still tied to a handful of AI spenders.
- On-demand vs contracted mix is not disclosed as a split; the backlog structure and contract-length trend indicate revenue is mostly committed multi-year. The "take-or-pay" nature is described in prior filings but I did not confirm current contract terms (cancellation rights, delivery-delay remedies).

### Gaps
- Names of Customers A and B for 2026 are not disclosed.
- No disclosed split between on-demand and committed revenue.
- Backlog terms: how much backlog is cancellable if CoreWeave misses delivery dates was not found.

## 2. What do they sell, and what is current sentiment?

### Takeaway
CoreWeave sells large NVIDIA GPU clusters plus a managed software layer, and is scaling power fast (1.7 GW active, 4.6 GW contracted). Sentiment going into Q3 earnings was close to distressed (stock down ~40% in a month, bonds yielding ~15 to 16%); the Q3 beat and raised guidance produced a relief rally, but debt and Microsoft's neocloud pullback dominate the narrative.

### Cited Findings
- Product: brought multi-rack NVIDIA Vera Rubin NVL72 online; launched CoreWeave Forge (AI development environment); SemiAnalysis Platinum ClusterMAX rating for the third consecutive time. [8-K press release](https://www.sec.gov/Archives/edgar/data/0001769628/000176962826000461/coreweave3q26earningspress.htm)
- Power: over 1.7 GW active today; more than 1.85 GW active expected at year-end 2026 (reaffirmed); over 4.6 GW contracted (+900 MW in Q3), over 1.3 GW international (India, Indonesia, Spain). [8-K press release](https://www.sec.gov/Archives/edgar/data/0001769628/000176962826000461/coreweave3q26earningspress.htm)
- Delivery: Intrator said CoreWeave sees no material risk to 2027 deliveries based on construction at fully permitted sites; Texas power is mostly online or fully permitted and under construction. [Call transcript](https://www.investing.com/news/transcripts/earnings-call-transcript-coreweave-tops-q3-2026-forecast-and-shares-rise-57-93CH-5017354)
- Prior delivery problem: in Nov 2025 CoreWeave cut its annual revenue forecast by more than $200M because a third-party data center developer missed delivery; stock fell 16%+ on 2025-11-11. Analysts suspected Core Scientific, unconfirmed. [OLDER] [Bisnow, 2025-11-12](https://www.bisnow.com/news/national/data-center-capital-markets/data-center-delays-trigger-selloff-of-ai-cloud-firm-coreweave-131860)
- Core Scientific: the ~$9B all-stock acquisition was voted down by Core Scientific shareholders on 2025-10-30 and terminated; CoreWeave said it would continue the commercial partnership. [OLDER] [Yahoo Finance / Reuters](https://finance.yahoo.com/news/core-scientific-terminates-9-billion-143818190.html); [Bloomberg](https://www.bloomberg.com/news/articles/2025-10-30/core-scientific-investors-spurn-coreweave-takeover-bid-in-vote)
- Sentiment before earnings: stock ~$47, down ~40% in a month and more than 73% from a June 2025 peak above $183. [CNBC, 2026-11-10](https://www.cnbc.com/2026/11/10/coreweave-earnings-preview-debt-capex.html)
- 2026-10-14: CRWV fell 15.5%; 2031 bond yield ~14.9%; S&P rating B+. CEO memo said the market "misunderstands and acts irrationally" and that backlog "more than supports all of our debt obligations." [CNBC, 2026-10-14](https://www.cnbc.com/2026/10/14/coreweave-stock-bond-yields-ai-debt.html)
- Gartner (2026-10-14) projected more than 80% of neocloud providers could stop operating independently by 2030; CRWV fell 23.85% in the week ended 2026-10-19. [24/7 Wall St](https://247wallst.com/investing/2026/10/20/gartner-80-of-neocloud-firms-face-extinction-by-2030-as-ai-capex-outpaces-returns/)
- Microsoft: Bloomberg (2026-11-05) reported Microsoft tightening oversight of neocloud partners; CNBC (2026-11-06) reported it plans to use fewer neoclouds, with CoreWeave among named suppliers; CRWV fell 11% intraday on 2026-11-05 per Reuters. All via secondary summaries. [Runtimewire](https://runtimewire.com/article/microsoft-cut-neocloud-roster-few-key-suppliers); [FourWeekMBA](https://fourweekmba.com/ai-microsoft-said-to-tighten-oversight-of-nebius-iren-nscale/)
- Post-earnings: stock up ~8% after hours on 2026-11-10 to as high as ~$53 from a ~$48.73 close. [Stocktwits](https://stocktwits.com/news-articles/markets/equity/crwv-stock-climbs-6-after-hours-as-132-b-revenue-backlog-reinforces-ai-compute-demand-nbis-iren-tick-higher/cNGuwW0R9JL). One source says shares closed ~25% higher at ~$60.77 on 2026-11-11. [Vested Finance](https://vestedfinance.com/blog/us-stocks/coreweave-q3-earnings-2026/) (single secondary source; not confirmed)
- Wells Fargo (Michael Turrin): "the highest quality co in the space." CreditSights (Jordan Chalfin): whether CoreWeave can obtain all the financing it needs is a major issue. [CNBC, 2026-11-10](https://www.cnbc.com/2026/11/10/coreweave-earnings-preview-debt-capex.html)

### Inferences
- The operating story (revenue beat, raised guidance, capex above range because deliveries came early) is going well; the stock's problem is financing and customer-quality fears, not demand.
- Microsoft's pullback matters less than it would have a year ago because Microsoft's share fell from ~67% to ~24%, but it still signals that the largest buyer is treating neoclouds as overflow capacity.

### Gaps
- No Q3 2026 statement on whether any 2026 delivery was delayed.
- Status of the ongoing Core Scientific commercial relationship (MW delivered, any disputes) not found for 2026.

## 3. Who are the competitors and what is sentiment around them?

### Takeaway
The main public comparables are Oracle OCI (growing fast with a $664B RPO, also free-cash-flow negative) and Nebius (much smaller, ~40% adj. EBITDA margin). Neocloud sentiment is poor across the board in Oct to Nov 2026, driven by debt, Microsoft's partner review and consolidation forecasts.

### Cited Findings
- Oracle FQ1 2027 (quarter ended Aug 2026, reported 2026-09-10): total revenue $19.3B (+30%); OCI IaaS revenue $7.4B (+121%); CPU & GPU infrastructure $6.5B (+151%); RPO $664B (+$209B YoY); FCF negative $5B for the quarter; FY2027 revenue guide at least $90B. [Oracle press release](https://www.oracle.com/news/announcement/q1fy27-earnings-release-2026-09-10/); [StorageNewsletter](https://storagenewsletter.com/2026/09/23/oracle-fiscal-1q27-financial-results)
- Oracle stock fell nearly 9% on 2026-10-14; its 6.25% 2032 bond yielded 7.24% (vs ~14.8% on CoreWeave's 2032 bond). [CNBC](https://www.cnbc.com/2026/10/14/coreweave-stock-bond-yields-ai-debt.html)
- Bloomberg reported Microsoft began shutting down some compute rented from Oracle and not renewing. [Runtimewire / search summary](https://runtimewire.com/article/microsoft-cut-neocloud-roster-few-key-suppliers) (secondary)
- Nebius Q2 2026 (reported Aug 2026): revenue $582.3M (+454% YoY); adj. EBITDA $236.2M (40.6% margin); 2026 guide revenue $3.0 to 3.4B, year-end ARR $7 to 9B, adj. EBITDA margin ~40%. [The Energy Mag](https://theenergymag.com/news/market-news/nebius-group-reports-454-revenue-growth-in-q2-2026-raises-power-guidance-to-5-gw); [StorageNewsletter](https://www.storagenewsletter.com/2026/08/20/nebius-fiscal-2q26-financial-results/)
- Nebius fell 10% on 2026-10-14 and 18.96% in the week ended 2026-10-19. [CNBC](https://www.cnbc.com/2026/10/14/coreweave-stock-bond-yields-ai-debt.html); [24/7 Wall St](https://247wallst.com/investing/2026/10/20/gartner-80-of-neocloud-firms-face-extinction-by-2030-as-ai-capex-outpaces-returns/)
- Six listed neoclouds fell ~20.9% on average from 2026-10-30 to 2026-11-05; IREN fell most (24.7%); Applied Digital fell ~20.5%. [FourWeekMBA](https://fourweekmba.com/ai-neocloud-stocks-fell-20-9-in-four-days-s-p-500-fell-3/) (secondary)
- Lambda (private): reported Anthropic agreement to spend $35B on its capacity. [search summary; single secondary source, not verified](https://fourweekmba.com/ai-neocloud-stocks-fell-20-9-in-four-days-s-p-500-fell-3/)
- Crusoe (private): reported in July 2026 to be raising ~$3B at ~$30B valuation. [secondary, not verified](https://www.datacenterdynamics.com/en/analysis/the-colossal-consolidation/)
- The Information (2026-10-18): industry executives expect only 7 to 10 neoclouds to survive. [24/7 Wall St summary](https://247wallst.com/investing/2026/10/20/gartner-80-of-neocloud-firms-face-extinction-by-2030-as-ai-capex-outpaces-returns/)
- Paul Meeks (Freedom Capital Markets): CoreWeave's balance sheet is "relatively bad" versus neocloud peers because it borrowed more and is building more. [CNBC](https://www.cnbc.com/2026/10/14/coreweave-stock-bond-yields-ai-debt.html)

### Inferences
- CoreWeave is the scale leader among neoclouds (Q3 revenue $3.66B vs Nebius Q2 $0.58B), but Oracle's OCI is now roughly 2x CoreWeave's quarterly revenue and has an investment-grade-priced balance sheet.
- In a consolidation scenario, scale and Nvidia ties favor CoreWeave surviving; the bear risk is equity dilution or restructuring along the way, not disappearance.

### Gaps
- Nebius Q3 2026 results not found (may not have been released by 2026-11-12).
- AWS, Azure, Google Cloud Q3 2026 numbers were not researched in this pass.
- Lambda, Crusoe financials not public; IREN and Applied Digital latest quarterly numbers not gathered.

## 4. How are financials growing vs competitors?

### Takeaway
Revenue growth (168%) and adj. EBITDA margin (62%) are strong, but GAAP results are thin: Q3 operating income $207M against $846M interest, net loss $709M. Interest expense is ~23% of revenue and rising.

### Cited Findings
- Q3 2026 vs Q3 2025 ($M): revenue 3,661 vs 1,365; cost of revenue 1,183 vs 369; operating income 207 vs 52 (6% vs 4% margin); adjusted operating income 379 vs 217 (10% vs 16%); interest expense, net (846) vs (310); D&A 1,889 vs 630; net loss (709) vs (110) (-19% margin); adjusted net loss (529) vs (41); adj. EBITDA 2,256 vs 838 (62% vs 61%); diluted EPS $(1.27) vs $(0.22). [8-K press release](https://www.sec.gov/Archives/edgar/data/0001769628/000176962826000461/coreweave3q26earningspress.htm)
- 9M 2026 ($M): revenue 8,314; operating income 14; adj. operating income 528; net loss (2,075); adj. EBITDA 4,923 (59%); interest expense (2,022); D&A 4,429. [8-K press release](https://www.sec.gov/Archives/edgar/data/0001769628/000176962826000461/coreweave3q26earningspress.htm)
- Guidance (raised): FY2026 revenue $13.0 to 13.3B; adj. operating income $1.275 to 1.375B; exit-2026 annualized run-rate revenue $20 to 21B (from $18.5 to 19.5B). [8-K press release](https://www.sec.gov/Archives/edgar/data/0001769628/000176962826000461/coreweave3q26earningspress.htm); [Unite.AI](https://www.unite.ai/coreweave-ai-cloud-revenue-climbs-168-as-backlog-more-than-doubles/)
- Adjusted net income expected to turn positive in 1H 2028. [Call transcript](https://www.investing.com/news/transcripts/earnings-call-transcript-coreweave-tops-q3-2026-forecast-and-shares-rise-57-93CH-5017354)
- Q3 revenue beat consensus of $3.54B; EPS -$1.27 beat a -$1.55 estimate. [search summary of earnings coverage](https://www.tipranks.com/news/coreweave-stock-crwv-hit-with-downgrade-and-price-target-cuts-despite-q3-beat) (secondary)
- Competitor comps: Oracle OCI +121% YoY (FQ1 2027); Nebius revenue +454% YoY, adj. EBITDA margin 40.6% (Q2 2026). See question 3 sources.

### Inferences (derived)
- Implied Q4 2026 revenue: $4.69 to 4.99B ($13.0 to 13.3B minus $8.314B).
- Interest expense was ~23% of Q3 revenue ($846M / $3,661M). Q4 interest guide ($1.05 to 1.15B) implies ~22 to 25% of implied Q4 revenue.
- GAAP operating income covered Q3 interest only ~0.24x; adj. EBITDA covered it ~2.7x.
- Adjusted operating margin fell from 16% to 10% YoY while adj. EBITDA margin was flat at 62%: depreciation and new-capacity startup costs are absorbing the growth.
- Gross margin caveat: D&A ($1,889M) is larger than reported cost of revenue ($1,183M), so the ~67% "gross margin" appears to exclude most GPU depreciation. If so, it is not comparable to a hyperscaler gross margin. This should be checked against the 10-Q income statement line items.
- CoreWeave's growth rate is lower than Nebius's but from a ~6x larger base; its adj. EBITDA margin (62%) is higher than Nebius (~40%).

### Gaps
- Oracle does not report OCI-only operating margin, so a like-for-like margin comparison is not possible.
- Q4 2025 quarterly figures (needed for clean TTM adj. EBITDA) not gathered.

## 5. Cash vs debt (core risk)

### Takeaway
At 2026-09-30 CoreWeave had $4.2B of cash against $46.9B of borrowed debt plus $19.3B of lease liabilities, $4.0B of equity, and -$17.9B of free cash flow year to date. It depends on continuous new financing (secured GPU-backed loans, converts, ATM equity, customer prepayments). Its unsecured bonds trade at distressed-level yields (~15 to 16%) even though its secured, customer-backed cost of debt is falling.

### Cited Findings
- Balance sheet at 2026-09-30 ($M): cash and equivalents 4,122; restricted cash 1,405 current + 877 non-current; marketable securities 62; recourse debt 9,183 current + 32,417 non-current; non-recourse debt 1,389 current + 3,884 non-current; operating lease liabilities 668 current + 18,029 non-current; finance lease liabilities 296 + 353; total assets 91,481; total liabilities 87,456; equity 4,025. [8-K press release](https://www.sec.gov/Archives/edgar/data/0001769628/000176962826000461/coreweave3q26earningspress.htm); [Q3 10-Q](https://www.sec.gov/Archives/edgar/data/0001769628/000176962826000465/crwv-20260930.htm)
- Dec 31, 2025 comparison: recourse debt 6,118 current + 14,608 non-current; non-recourse 590 + 57; operating leases 427 + 7,768. [Q3 10-Q](https://www.sec.gov/Archives/edgar/data/0001769628/000176962826000465/crwv-20260930.htm)
- Reuters-sourced reporting: total debt $46.9B at end of September. [AI Weekly](https://aiweekly.co/alerts/coreweave-q3-revenue-jumps-168-yoy-to-366b-as-backlog-climbs-to-1325b-and-debt)
- At 2026-06-30: debt ~$35.6B principal, cash $5.5B, debt-to-equity 702% (vs ~291% a year earlier), ~$15B of principal payments through 2028. [CNBC, 2026-11-10](https://www.cnbc.com/2026/11/10/coreweave-earnings-preview-debt-capex.html)
- Maturity profile (secondary summary of the Q2 10-Q): $4.4B due 2H 2026, $6.2B 2027, $4.4B 2028, $2.4B 2029, $3.2B 2030, $14.9B after 2030; $10.6B of the $35.6B June principal due by end of 2027; unsecured notes and converts mature 2030 to 2032. [StockTitan](https://www.stocktitan.net/articles/coreweave-nebius-ai-cloud-debt-when-it-comes-due) (secondary; predates the Q3 borrowing)
- Tranches per the Q1 2026 10-Q [OLDER for balances]: DDTL 2.0 ($4,425M, Aug 2030, ~11%), DDTL 2.1 ($3,000M, Mar 2031), DDTL 3.0 ($1,700M, Aug 2030), DDTL 4.0 ($1,260M, Mar 2032), 2030 senior notes ($2,000M, Jun 2030), 2031 senior notes ($1,750M, Feb 2031), 2031 convertible notes ($2,588M, Dec 2031). Later: DDTL 5.0 (matures 2031-11-15), $1,250M 9.625% notes and EUR 2,000M 8.500% notes due 2032-07-15. [CoreWeave Q1 2026 10-Q](https://s205.q4cdn.com/133937190/files/doc_financials/2026/q1/CoreWeave-1Q26-10-Q.pdf); [search summary of 8-Ks](https://www.stocktitan.net/sec-filings/CRWV/8-k.html). Sources conflict on some coupons and amounts (e.g., 2030 notes listed at 9.25% in one table and 10% in another; a $2.75B 9.75% Oct 2031 note vs $1,750M "2031 senior notes").
- Q3 financing: ~$4.2B upsized convertible notes; ATM program of up to 35M Class A shares; $2.6B DDTL 5.5 for shorter-duration contracts; capped call purchases $566M in Q3 ($1,058M YTD). CEO expects ~$9B of customer prepayments and deposits in the next three months. [8-K press release](https://www.sec.gov/Archives/edgar/data/0001769628/000176962826000461/coreweave3q26earningspress.htm); [Q3 10-Q](https://www.sec.gov/Archives/edgar/data/0001769628/000176962826000465/crwv-20260930.htm)
- Cost of debt: weighted average 7.9% at quarter-end, down 250 bps YoY. DDTLs have priced at SOFR +225 to 550 bps since IPO (IG customers at the tight end, AI labs at the wide end). Next DDTL expected investment grade at ~7 to 7.5% yield, financing >90% of associated capex. No parent-level unsecured issuance planned through 2027 at current yields; less than $5B of incremental parent-level capital needed through 2027. [Call transcript](https://www.investing.com/news/transcripts/earnings-call-transcript-coreweave-tops-q3-2026-forecast-and-shares-rise-57-93CH-5017354)
- Interest: Q3 net interest expense $846M (vs $310M); 9M $2,022M; 9M cash interest paid $1,339M (net of capitalized); Q4 guide $1.05 to 1.15B. [8-K](https://www.sec.gov/Archives/edgar/data/0001769628/000176962826000461/coreweave3q26earningspress.htm); [10-Q](https://www.sec.gov/Archives/edgar/data/0001769628/000176962826000465/crwv-20260930.htm)
- Hedges: interest rate swap notional $6,787M; cross-currency swap notional $2,314M (EUR 2032 notes). [10-Q](https://www.sec.gov/Archives/edgar/data/0001769628/000176962826000465/crwv-20260930.htm)
- Cash flow ($M): operating cash flow 1,975 (Q3), 5,638 (9M); purchases of PP&E (9,441) Q3, (23,558) 9M; net debt proceeds 10,301 Q3, 27,048 9M; private placement equity 2,982 9M. [8-K press release](https://www.sec.gov/Archives/edgar/data/0001769628/000176962826000461/coreweave3q26earningspress.htm)
- Capex: Q3 capex $14.5B (above guided $11.5 to 13.5B); FY2026 guide $37 to 39B (low end raised from $35B); 2027 capex roughly in line with 2026 if limited to committed backlog. [Call transcript](https://www.investing.com/news/transcripts/earnings-call-transcript-coreweave-tops-q3-2026-forecast-and-shares-rise-57-93CH-5017354); [CNBC](https://www.cnbc.com/2026/11/10/coreweave-earnings-preview-debt-capex.html). Wells Fargo's Turrin estimated 2027 capex could reach $66B, requiring at least $25B more debt. [CNBC](https://www.cnbc.com/2026/11/10/coreweave-earnings-preview-debt-capex.html)
- Bond market: 9.75% notes due 2031 at ~15.5% yield on 2026-11-10 after 16.7% on 2026-11-05; 5-year CDS ~1,152 bps (2026-11-10) after 1,278 bps (2026-11-05). [CNBC](https://www.cnbc.com/2026/11/10/coreweave-earnings-preview-debt-capex.html). After earnings the 2031 notes rose to ~82.25 cents on the dollar (Bloomberg data). [secondary summary](https://stocktwits.com/news-articles/markets/equity/core-weave-s-bonds-signal-cooling-investor-angst-on-elevated-debt-load/cNGC3QVR9Oc). S&P Global Market Intelligence: CDS at 1,000 bps or above generally signals credit distress. [CNBC, 2026-10-15](https://www.cnbc.com/2026/10/15/coreweave-credit-default-swaps-hit-distress-levels-as-investors-sour-on-ai-debt.html)
- S&P rating B+. [CNBC](https://www.cnbc.com/2026/10/14/coreweave-stock-bond-yields-ai-debt.html)
- Gavan Nolan (S&P Global Market Intelligence): capex is near hyperscaler levels, but the balance sheet is not. [CNBC](https://www.cnbc.com/2026/10/14/coreweave-stock-bond-yields-ai-debt.html)

### Inferences (derived)
- Q3 FCF: $1,975M - $9,441M = -$7.5B; 9M FCF -$17.9B.
- Gap between cash capex ($9.4B) and reported capex ($14.5B) in Q3 suggests ~$5B of capex not yet paid in cash (accrued/vendor-financed); that is a future cash call. Not confirmed from the filing.
- Borrowed debt rose ~$26B in nine months (from $21.4B at 2025-12-31 to $46.9B), while cash fell from $5.5B (June) to $4.1B (Sept).
- Debt (ex leases) to equity ~11.6x; with leases ~16.4x.
- Net debt ex leases ~$42.7B; with leases ~$62.0B.
- 7.9% x $46.9B is ~$3.7B/yr of interest, consistent with the Q4 run-rate (~$4.2 to 4.6B annualized) given debt is still growing.
- Two-tier credit: secured project debt backed by IG customer contracts prices at ~7%, while unsecured parent notes trade at ~15 to 16%. The market is saying parent equity and unsecured creditors sit behind a lot of secured debt.
- Q3 debt growth ($10.3B net) and the ATM program mean continued funding depends on open capital markets. A credit freeze is the main path to a bad outcome.

### Gaps
- The Q3 10-Q debt footnote (facility-by-facility balances, rates, current maturity schedule) could not be retrieved; SEC blocked automated download and the web reader truncated the filing. The tranche table above is from Q1 2026 and is stale.
- Covenants and any going-concern language not checked.
- Lease maturity schedule and total purchase commitments not retrieved.

## 6. P/E and valuation

### Takeaway
No meaningful P/E: trailing earnings are negative and management guides adj. net income positive only in 1H 2028. On EV-based multiples the stock looks cheap vs its growth (roughly 3.6 to 4.5x exit-2026 run-rate revenue, ~8 to 10x annualized Q3 adj. EBITDA), but the equity is a thin slice on top of a large debt stack.

### Cited Findings
- Yahoo (fund app, 2026-11-12): trailing P/E n/a, forward P/E -32.6, market cap ~$31.2B, price $56.60, mean target $121.26. (not independently verified)
- FactSet consensus (39 estimates): average overweight, $126 target, as of 2026-11-10. [CNBC](https://www.cnbc.com/2026/11/10/coreweave-earnings-preview-debt-capex.html)
- Pre-earnings target cuts in 2026: Wells Fargo $160 to $115 (Overweight); Rosenblatt $250 to $160 (Buy); Citi $159 to $128 (Buy). [search summary of TipRanks / Longbridge](https://longbridge.com/news/304922229) (secondary)
- One MarketBeat page lists a consensus target of $131.52 (date unconfirmed). [MarketBeat](https://www.marketbeat.com/articles/coreweaves-guidance-cut-a-buying-opportunity-in-disguise/)
- Stock had dropped ~32% year to date as of 2026-11-10. [Stocktwits](https://stocktwits.com/news-articles/markets/equity/crwv-stock-climbs-6-after-hours-as-132-b-revenue-backlog-reinforces-ai-compute-demand-nbis-iren-tick-higher/cNGuwW0R9JL)

### Inferences (derived, using $31.2B market cap, $46.9B debt, $4.18B cash, $19.3B leases)
- EV ex leases ~$73.9B; EV with leases ~$93.2B.
- EV / trailing revenue ($9.89B): ~7.5x (ex leases), ~9.4x (with leases).
- EV / FY2026 revenue guide midpoint ($13.15B): ~5.6x / ~7.1x.
- EV / exit-2026 run-rate revenue midpoint ($20.5B): ~3.6x / ~4.5x.
- EV / annualized Q3 adj. EBITDA ($9.0B): ~8.2x / ~10.3x.
- Backlog ($132.5B) is ~1.8x EV ex leases.
- Price/book: ~7.8x ($31.2B / $4.0B equity).
- Mean target $121.26 implies ~114% upside from $56.60. The gap between targets and price is itself a sign the market does not believe the sell-side financing assumptions.
- Fund position: $56.60 vs $41.02 cost basis is +38% unrealized.
- Shares outstanding implied by market cap/price ~551M; the 35M-share ATM is ~6% potential dilution.
- Adj. EBITDA is before interest and depreciation, which are the two largest costs. Equity value depends on whether EBITDA minus maintenance capex minus interest ever turns positive.

### Gaps
- No positive forward P/E is available (consensus 2027 EPS not found).
- Post-earnings (2026-11-11 and 2026-11-12) analyst target changes not found. Closing prices for 2026-11-11 and 2026-11-12 not confirmed from a primary source.
- Peer multiples (Nebius, Oracle EV/EBITDA) not gathered.

## 7. Contrarian angles (bear and bull)

### Takeaway
The strongest bear arguments are GPU depreciation vs economic life, Nvidia's role on both sides of the business, heavy insider selling, and a capital structure that only works if credit markets stay open. The strongest contrarian bull arguments are a stock down 70%+ from its peak trading near ~8x annualized adj. EBITDA, falling secured borrowing costs, rapidly diversifying customers, and management's claim that old GPUs re-contract at attractive prices with no new capex.

### Cited Findings
Bear side:
- Depreciation: CoreWeave depreciates technology equipment over 6 years (raised from 5 years effective 2023-01-01, no material impairment); credit agreements define GPU depreciation as 6-year straight-line with no salvage term. [Cape Fear Advisors (Substack, skeptic)](https://capefearadvisors.substack.com/p/the-second-contract); [Vista Research](https://www.vistaresearch.ai/notes/coreweave-gpu-depreciation-economic-life.html) (secondary)
- Michael Burry argued large cloud providers understate GPU depreciation because Nvidia runs a 2 to 3 year product cycle, estimating ~$176B of industry-wide understatement from 2026 to 2028. [search summary, secondary](https://www.stateof.ai/compute-explore/gpu-lifetime) (not verified against Burry's own posts)
- Nvidia as supplier, investor and customer: Nvidia invested $2B at $87.20/share on 2026-01-26 (~22.9M shares), raising its stake to ~11.5%; it also agreed to buy over $6B of CoreWeave services through 2032. Bloomberg framed it as part of "circular financing" deals. CoreWeave said the money would not be used to buy Nvidia processors. [Bloomberg](https://www.bloomberg.com/news/articles/2026-01-26/nvidia-invests-another-2-billion-in-coreweave-offers-new-chip); [Futuriom](https://www.futuriom.com/articles/news/nvidia-tops-coreweave-stake-with-2-billion/2026/01) [OLDER]
- Insider selling: co-founders Intrator, Venturo and McBee sold ~$3.3B of stock since the March 2025 IPO, ~$2.4B of it in 2026 (Bloomberg-sourced). [AI Weekly](https://aiweekly.co/alerts/coreweave-co-founders-sell-33b-of-stock-since-march-ipo). Insider-data summary for 12 months to late Oct 2026: ~$2.2B of open-market sales by 15 insiders, no purchases. Sources conflict on Intrator's 2026 total ($907M in one, ~$627M in another). [MarketBeat Form 4 alert](https://www.marketbeat.com/instant-alerts/michael-intrator-sells-200000-shares-of-coreweave-nasdaqcrwv-stock-2026-04-16/) (aggregator; verify on EDGAR)
- Magnetar sold ~2.6M shares on 2026-04-15 (avg ~$118.67) and ~1.2M on 2026-05-06 (avg ~$136.73). [MarketBeat](https://www.marketbeat.com/instant-alerts/coreweave-nasdaqcrwv-major-shareholder-magnetar-financial-llc-sells-1202656-shares-2026-05-08/) (aggregator; the "83% stake cut" claim likely refers to one reporting entity, not Magnetar's total)
- Bob Lang (Explosive Options) called the debt situation potentially "the start of the end." [CNBC](https://www.cnbc.com/2026/11/10/coreweave-earnings-preview-debt-capex.html) (opinion)
- Gartner: 80%+ of neoclouds may not survive independently by 2030. [24/7 Wall St](https://247wallst.com/investing/2026/10/20/gartner-80-of-neocloud-firms-face-extinction-by-2030-as-ai-capex-outpaces-returns/)

Bull side:
- About 130,000 GPUs come off contract in 2027 and ~170,000 in 2028; at current pricing, renewals could add ~$4B of annualized revenue in 2027 and nearly $10B including 2028, with no additional capex (CEO claim). Multi-year commitments extend beyond GPU depreciable lives (CEO). [Call transcript](https://www.investing.com/news/transcripts/earnings-call-transcript-coreweave-tops-q3-2026-forecast-and-shares-rise-57-93CH-5017354)
- Oracle reported renewed capacity commanded a premium, with most of those GPUs four years or older. [search summary citing Vista Research](https://www.vistaresearch.ai/notes/coreweave-gpu-depreciation-economic-life.html) (secondary)
- NVIDIA cited CoreWeave A100 bookings extending through 2029 (vendor-reported). [search summary](https://www.vistaresearch.ai/notes/coreweave-gpu-depreciation-economic-life.html) (secondary)
- Cost of debt down 250 bps YoY to 7.9%; next DDTL expected investment grade at ~7 to 7.5%. [Call transcript](https://www.investing.com/news/transcripts/earnings-call-transcript-coreweave-tops-q3-2026-forecast-and-shares-rise-57-93CH-5017354)
- Top customer share fell from 67% to 24% YoY. [Q3 10-Q](https://www.sec.gov/Archives/edgar/data/0001769628/000176962826000465/crwv-20260930.htm)
- Wells Fargo: capacity and revenue coming in better than expected; expects 1.95 GW active this year vs 1.85 GW guide. [CNBC](https://www.cnbc.com/2026/11/10/coreweave-earnings-preview-debt-capex.html)
- Treasury Secretary Scott Bessent called neoclouds "a small component of the overall ecosystem." [24/7 Wall St](https://247wallst.com/investing/2026/10/20/gartner-80-of-neocloud-firms-face-extinction-by-2030-as-ai-capex-outpaces-returns/)

### Inferences
- Depreciation test: if the 2027 to 2028 renewal claim holds (old GPUs re-contracted at prices near current), a 6-year life is defensible and the Burry critique is weaker for CoreWeave than for owners of unsold capacity. If renewal pricing drops sharply as Rubin-generation supply arrives, 6-year straight-line with no salvage overstates asset values and earnings. The 2027 renewal cohort is the first real-world test, and it is observable.
- Residual value risk sits mostly with equity and unsecured holders: secured DDTL lenders are protected by contracted cash flows and the GPUs themselves.
- Nvidia's involvement cuts both ways: it is an implicit backstop (capacity purchase, allocation of new chips) but also means CoreWeave's demand signals are partly manufactured by its supplier.
- Insider selling is large but mostly under 10b5-1 plans and mostly at prices above $87; it is a sentiment negative rather than evidence of a specific problem.
- Contrarian bull framing: the equity trades as if financing will fail, while the bond market for secured, contract-backed debt says it will not. If the next IG DDTL prices at ~7%, that gap should narrow. If it does not price, the bear case is confirmed.

### Gaps
- No direct primary-source read of Burry's posts or a full short report in this pass.
- No data on secondary-market resale prices for H100/A100 GPUs in 2026.
- Lockup expiry dates: the IPO lockup expired in 2025 [inferred from 2026 insider sales]; no 2026 lockup events found.
