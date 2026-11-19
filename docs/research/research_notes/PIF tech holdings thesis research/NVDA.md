# Nvidia (NASDAQ: NVDA) investment thesis research, as of 2026-11-12

Read this first. On 2026-11-12, Nvidia filed an 8-K saying Jensen Huang resigned as President, CEO and board member, effective immediately. CFO Colette Kress is Interim CEO and stays CFO. Harvey C. Jones is the company's first board Chair. The filing gives no reason, does not reaffirm guidance, and keeps the Q3 FY27 report on Tuesday 2026-11-17 (results about 1:20pm PT, call 2pm PT). Source: [Nvidia 8-K, 2026-11-12](https://www.sec.gov/Archives/edgar/data/0001045810/000104581026000082/nvidiaannouncesceotransiti.htm). Media reports tie the exit to personal conduct, including an alleged relationship with a suspected Chinese agent. Nvidia has not confirmed this. Q3 FY27 results come out 5 days after these notes, so every "latest quarter" figure here is Q2 FY27 (quarter ended 2026-07-26, reported 2026-08-26). Treat these notes as stale after 2026-11-17.

Fiscal calendar: Nvidia's fiscal 2027 runs from late January 2026 to late January 2027. Q2 FY27 is the quarter ended 2026-07-26.

## 1. How does Nvidia make money? (segments, latest quarter mix, customer concentration)

### Takeaway
In Q2 FY27 (ended 2026-07-26), Data Center was $89.0B of $96.2B total revenue, about 92.5%. Starting in FY27, Nvidia reports only two market platforms: Data Center (split into Hyperscale and ACIE) and Edge Computing (Gaming, Pro Viz, Automotive and OEM combined). The old Gaming, Pro Viz and Auto lines are no longer disclosed. Concentration is high: one direct customer was 16% of Q2 revenue, and five direct customers held about 70% of receivables.

### Cited Findings
- Q2 FY27 revenue was $96,221M, up 18% QoQ (from $81,615M) and up 106% YoY (from $46,743M). Data Center was $89.0B (+18% QoQ, +117% YoY). Edge Computing was $7.2B (+13% QoQ, +27% YoY). Source: [Nvidia Q2 FY27 press release, 2026-08-26](https://investor.nvidia.com/news/press-release-details/2026/NVIDIA-Announces-Financial-Results-for-Second-Quarter-Fiscal-2027/default.aspx)
- Mix (computed from the release): Data Center 92.5%, Edge Computing 7.5%. Source: same release.
- New structure from FY27. Data Center has two sub-lines. Hyperscale covers hyperscale clouds and large internet companies (AWS, Google, Meta, Microsoft). ACIE (AI Clouds, Industrial, Enterprise) covers AI clouds, sovereign AI, enterprise, industrial and supercomputing. Edge Computing combines Gaming, Pro Visualization, Automotive and OEM (PCs, consoles, workstations, AI-RAN, robotics, auto). Source: [Yahoo/Tom's Hardware, May 2026](https://finance.yahoo.com/sectors/technology/articles/nvidia-no-longer-reports-gaming-114427134.html); [Jon Peddie Research](https://www.jonpeddie.com/news/nvidia-results-for-the-first-quarter-and-fiscal-2027/)
- Q2 FY27 Data Center split, from the CFO commentary as compiled by GPU Insights: Hyperscale $48,710M (+13% QoQ, +102% YoY, 54.7% of Data Center). ACIE $40,313M (+25% QoQ, +138% YoY, 45.3%). Prior periods are recast because one customer moved from ACIE to Hyperscale. Source: [GPU Insights, citing Nvidia CFO commentary exhibit 99.1](https://gpuinsights.net/nvidia-data-center-revenue-q2-fy2027/)
- Legal reportable segments (10-Q) are still Compute & Networking ($88,299M in Q2 FY27) and Graphics ($7,922M). These are not the same as the Data Center and Edge market platforms. Source: [Nvidia 10-Q for quarter ended 2026-07-26](https://www.sec.gov/Archives/edgar/data/0001045810/000104581026000075/nvda-20260726.htm)
- Compute vs networking: one secondary source puts Q1 FY27 (ended 2026-04-26) Data Center Compute at $60.4B and Networking at $14.8B. I did not verify this against Nvidia documents. Source: [search summary of secondary sites, e.g. Midgard Finance](https://www.midgardfinance.com/research/nvidia/). For Q2 FY27, 24/7 Wall St says networking grew 138% YoY ([247wallst](https://247wallst.com/cards/nvidia-q2-2027-earnings-nvda-01m0zw3hstde6rb2mt0kwj6d2c)). That 138% exactly matches the ACIE growth rate above, so it may be a mislabel. Treat it as unverified.
- Revenue concentration: in Q2 FY27, one direct customer was 16% of total revenue. In the first half of FY27, three direct customers were 16%, 15% and 13%. Source: [10-Q, quarter ended 2026-07-26, via search summary](https://www.sec.gov/Archives/edgar/data/0001045810/000104581026000075/nvda-20260726.htm). In Q1 FY27, three direct customers were 21%, 17% and 16% of revenue. Source: [Cape Fear Advisors Substack, 2026-06-25, citing Q1 10-Q](https://capefearadvisors.substack.com/p/nvidia-adding-it-up-the-quality-of)
- Receivables concentration: at 2026-07-26, five direct customers held 22%, 14%, 13%, 11% and 10% of accounts receivable (about 70% combined). At 2026-01-25, three customers held 25%, 18% and 13%. Source: [10-Q](https://www.sec.gov/Archives/edgar/data/0001045810/000104581026000075/nvda-20260726.htm); the 70% framing is from [Benzinga, Oct 2026](https://www.benzinga.com/markets/equities/26/10/62458211/big-short-investor-flags-major-vulnerability-for-nvidia-5-customers-account-for-70-of-receivables-tremendous-amount-of-concentration-risk)
- China was about 5% of revenue in recent quarters, down from more than 20% before export controls tightened, per FY26 filings as summarized in a search result. Source: [TechRepublic](https://www.techrepublic.com/article/news-nvidia-h200-ai-chip-sales-china-stalled/) (secondary)

### Inferences
- Nvidia is now essentially a single-business company: about 92.5% Data Center. Gaming is no longer visible on its own, so a gaming slowdown can't be tracked.
- "Direct customers" are mostly ODMs and OEMs (Foxconn, Quanta, Dell and similar), not the hyperscalers themselves. The 10-Q does not name them. The real end-customer exposure (Microsoft, Meta, Google, Amazon, Oracle, OpenAI) is larger than any single direct-customer figure suggests.
- ACIE (neoclouds, sovereign, enterprise) grew faster than Hyperscale in Q2 (+25% vs +13% QoQ). ACIE includes customers that Nvidia also finances or invests in (see Q7), so the fastest-growing part of revenue may also be the most financing-dependent.

### Gaps
- No official Q2 FY27 Data Center compute vs networking split was retrieved. The press release no longer shows it, and I did not retrieve the CFO commentary directly.
- Separate Gaming, Pro Viz, Automotive and OEM figures are not disclosed for FY27.
- The names of the hyperscale end customers behind the concentration figures are not disclosed.

## 2. Products and sentiment (Blackwell, Blackwell Ultra, Rubin, NVLink, Spectrum-X, CUDA), supply, export controls

### Takeaway
Product demand still looks strong in the reported numbers: Vera Rubin is "in full production" and racks are ramping at major clouds, with Q3 guided to $108B. Sentiment has turned sharply negative since early November, but the reasons are the CEO exit, AI capex cost and power concerns, not a reported product problem. China data center compute is assumed to be zero in guidance.

### Cited Findings
- Q2 FY27 release quote: "Vera Rubin, now in full production, was built to power exactly this moment." Rubin racks are ramping at partners including CoreWeave, Google Cloud, Microsoft Azure, Oracle Cloud Infrastructure and Nebius. Source: [Nvidia Q2 FY27 press release, 2026-08-26](https://investor.nvidia.com/news/press-release-details/2026/NVIDIA-Announces-Financial-Results-for-Second-Quarter-Fiscal-2027/default.aspx)
- One analysis credits Blackwell Ultra with much of the Q2 acceleration. Source: [search summary of Q2 FY27 coverage, e.g. Dataporium](https://dataporium.tech/articles/nvidia-fiscal-q2-2027-earnings-revenue-doubles-to-96-2-billion-guides-108-billion-for-q3) (secondary)
- Other partnerships named in the release: SpaceXAI will deploy Nvidia Vera CPUs, and SK hynix announced a multiyear memory partnership. Source: [press release](https://investor.nvidia.com/news/press-release-details/2026/NVIDIA-Announces-Financial-Results-for-Second-Quarter-Fiscal-2027/default.aspx)
- Q3 FY27 guidance: revenue $108.0B ±2%, gross margin 74.0% ±50bp (GAAP and non-GAAP), GAAP opex about $9.2B and non-GAAP about $9.0B. Guidance "does not assume any Data Center compute revenue from China." Source: [press release](https://investor.nvidia.com/news/press-release-details/2026/NVIDIA-Announces-Financial-Results-for-Second-Quarter-Fiscal-2027/default.aspx)
- H20: there was a $4.5B charge in Q1 FY26 for H20 excess inventory and purchase obligations after China licensing requirements. The Q2 FY27 H20 charges were "insignificant." Source: [press release footnote](https://investor.nvidia.com/news/press-release-details/2026/NVIDIA-Announces-Financial-Results-for-Second-Quarter-Fiscal-2027/default.aspx)
- H200 to China (older, about 6 months; flagged). The US granted licenses for "small quantities" of H200 (10-K, 2026-02-25). Reported conditions include a 25% cut to the US government, third-party inspection and volume caps. Reuters (2026-05-14) reported that not a single H200 had shipped because Beijing had not approved purchases. Source: [TechRepublic summarizing Reuters](https://www.techrepublic.com/article/news-nvidia-h200-ai-chip-sales-china-stalled/); [Bloomberg Law](https://news.bloomberglaw.com/international-trade/nvidia-gets-us-license-for-small-amount-of-h200-exports-to-china)
- Stock sentiment: NVDA fell 9.3% on 2026-11-05 (its largest one-day drop in a year) and is down about 20% in November. Source: [search summary citing Trefis/Yahoo coverage](https://www.trefis.com/stock/nvda/articles/623367/whats-going-to-happen-with-nvidia-stock-soon/2026-11-06). On 2026-11-12 it fell more than 13% early before paring losses. Source: [CNN live coverage, 2026-11-11/12](https://www.cnn.com/2026/11/11/business/live-news/nvidia-jensen-huang-investigation-fallout) (page blocked to fetch; via search summary)
- Huang resignation, reported cause (not confirmed by Nvidia). Media report multiple extramarital relationships, including one with an alleged Chinese spy and one with an executive who reported to him. Reports say the matter triggered FBI, congressional and internal investigations. Source: [Washington Post, 2026-11-12](https://www.washingtonpost.com/technology/2026/11/12/nvidia-board-weighs-jensen-huangs-future-after-affair-with-allege-chinese-spy/); [NBC News](https://www.nbcnews.com/tech/tech-news/nvidia-ceo-jensen-huang-resigns-reports-extramarital-relationships-rcna608402); [Al Jazeera, 2026-11-12](https://www.aljazeera.com/news/2026/11/12/ai-titan-jensen-huang-out-as-nvidia-ceo)
- The 8-K says the board expects "operations, customer commitments and product roadmap to continue without interruption." Source: [8-K, 2026-11-12](https://www.sec.gov/Archives/edgar/data/0001045810/000104581026000082/nvidiaannouncesceotransiti.htm)
- Analyst reaction: Baird downgraded to Neutral, and DA Davidson cut its target from $300 to $200. Source: [MarketBeat forecast page](https://www.marketbeat.com/stocks/NASDAQ/NVDA/forecast/) (via search summary). Dan Niles argues the next CEO will "set a low bar" for earnings. Source: [TIKR](https://www.tikr.com/blog/dan-niles-nvidias-next-ceo-will-set-a-low-bar-for-earnings)

### Inferences
- The CEO risk is two things. First, key-person risk: Huang ran product strategy, roadmap and customer relationships for 33 years. Second, a possible policy risk: a reported counterintelligence link could make Washington less willing to approve China licenses and could invite more scrutiny. The second point is my inference; I found no source stating it.
- The interim CEO is also the CFO and will run the 2026-11-17 call. That creates an incentive to guide conservatively (Niles' point), which could depress near-term estimates even if demand holds.

### Gaps
- I found no 2026-dated primary data on NVLink, Spectrum-X or CUDA sentiment, Rubin yields, CoWoS/HBM supply tightness, or Rubin Ultra timing.
- I found no confirmed H200/H20 China shipment status after May 2026. It is unknown whether any China revenue was booked in Q2 FY27.
- Customer reaction to the Huang exit (for example, hyperscalers pausing orders) is not reported in anything I found.

## 3. Competitors and sentiment around them

### Takeaway
Competition is real and growing. Broadcom's AI revenue is growing about 3x faster than Nvidia's from a smaller base, Google now sells TPUs to outside customers, and AMD's MI450 has OpenAI, Anthropic, Meta, Microsoft and Oracle as named Helios users. Still, Nvidia's quarterly Data Center revenue ($89.0B) is about 5x Broadcom's AI revenue ($16.7B) and about 10x AMD's whole Data Center segment ($8.5B). Third-party share estimates put Nvidia at about 73 to 75% of AI accelerator revenue in 2026, down from about 87% in 2024. Those share estimates come from secondary sources and are weakly sourced.

### Cited Findings
- AMD Q3 2026 (ended late September, reported 2026-11-03): Data Center $8.5B, +97% YoY, driven by EPYC and the MI450 launch. OpenAI, Anthropic, Meta, Microsoft and OCI are named as running models on the first Helios rack systems powered by MI450. Source: [AMD Q3 2026 8-K](https://www.sec.gov/Archives/edgar/data/0000002488/000000248826000188/q32026991.htm)
- Broadcom FQ3 2026 (ended 2026-08-02, reported 2026-09-02): AI semiconductor revenue $16.7B, +221% YoY and +54% QoQ. FQ4 AI guidance is about $21.7B (+236% YoY). Hock Tan: "Demand for our custom AI accelerators and networking continues to be very strong." Source: [Broadcom FQ3 2026 8-K](https://www.sec.gov/Archives/edgar/data/0001730168/000173016826000076/avgo-08022026x8kxex99.htm)
- Google TPU: in April 2026 Google said it would sell TPUs directly into select customers' data centers. Morgan Stanley estimates about $13B of revenue by 2027 from 500k TPUs. Mizuho forecasts TPU revenue of $28B in 2026 and $67B in 2027. Source: [CryptoBriefing](https://cryptobriefing.com/google-tpu-sales-nvidia-ai-chips/); [Digital Today](https://www.digitaltoday.co.kr/en/view/121210/google-ai-chip-push-tpu-sales-seen-at-184-trillion-won-by-2028-can-it-shake-nvidias-dominance) (secondary, via search summary)
- Anthropic has committed to up to 1M TPUs. A secondary analysis of Anthropic's amended S-1 puts about $282.5B of $643.8B in named compute contracts on TPUs and about $251.3B on Nvidia. This is not verified against the filing. Source: [FourWeekMBA](https://fourweekmba.com/ai-google-tpus-are-44-of-anthropics-644b-named-compute-deals/)
- Meta TPU lease: reports conflict (signed in February 2026 vs only in talks). Unconfirmed. Source: [Tom's Hardware custom ASIC overview, May 2026](https://www.tomshardware.com/tech-industry/semiconductors/custom-ai-asics-examined-from-broadcom-to-mtia)
- Amazon Trainium3 is generally available, and Anthropic is a major user. AWS claims Trainium is about 40% cheaper than comparable Nvidia instances (Reuters figure cited secondhand). Separately, Nvidia and AWS plan to deploy 2M more Nvidia GPUs in 2027 to 2028. Source: [search summary of custom-silicon coverage](https://www.aiworldtoday.net/p/how-custom-ai-chips-are-challenging) (secondary)
- Share estimates: Nvidia had about 75% of 2026 AI accelerator revenue (down from about 87% in 2024) and about 73% in August 2026, per Silicon Analysts as cited secondhand. Source: [search summary](https://www.aiworldtoday.net/p/how-custom-ai-chips-are-challenging) (secondary, weak). SemiAnalysis's long-form view on TPUv7 competitiveness: [SemiAnalysis, "TPUv7: The 900lb Gorilla"](https://newsletter.semianalysis.com/p/tpuv7-google-takes-a-swing-at-the) (not read in full)

### Inferences
- The competitive threat is concentrated at the largest buyers: Google (TPU), Amazon (Trainium), Meta (MTIA, possibly TPU) and Anthropic (TPU plus Trainium). These are the same names behind Nvidia's Hyperscale revenue. ACIE customers (neoclouds, sovereigns, enterprise) have few alternatives to Nvidia, which partly explains why ACIE is growing faster.
- Broadcom's AI revenue growth (+221%) outpacing Nvidia's Data Center growth (+117%) is consistent with share shifting toward custom ASICs at the margin, while Nvidia's absolute dollars still grow faster.

### Gaps
- Not researched: Microsoft Maia status, Intel Gaudi/Jaguar Shores, Marvell's custom ASIC revenue, and Huawei Ascend volumes and China share. The Q3 guide excludes China entirely, so Huawei matters for China upside but not for the base case.
- No primary-source market-share data.

## 4. Financial growth vs competitors (revenue, margins, EPS, guidance)

### Takeaway
On the latest reported quarters, Nvidia has the highest revenue growth (+106%), the highest operating margin (about 66% GAAP), and EPS growth of about 120 to 128%, at the largest scale. Broadcom is close on non-GAAP margins and faster on AI revenue. AMD is far behind on margin.

### Cited Findings

| Metric (latest reported quarter) | Nvidia Q2 FY27 (ended 2026-07-26) | AMD Q3 2026 (ended late Sep 2026) | Broadcom FQ3 2026 (ended 2026-08-02) |
|---|---|---|---|
| Revenue | $96.2B | $13.4B | $29.6B |
| Revenue YoY | +106% | +45% | +86% |
| AI / Data Center revenue | DC $89.0B, +117% | DC $8.5B, +97% | AI semis $16.7B, +221% |
| GAAP gross margin | 75.0% | 54% | about 69.1% |
| Non-GAAP gross margin | 75.0% | 56% | about 75.0% |
| GAAP operating margin | 66.2% ($63,734M / $96,221M, my calculation) | 21% | about 53.9% |
| Non-GAAP operating margin | 66.5% ($63,956M, my calculation) | 29% | about 67.9% |
| GAAP diluted EPS (YoY) | $2.46 vs $1.08 (+128%, my calculation) | $1.46 (+95%) | $2.68 (+215%) |
| Non-GAAP diluted EPS (YoY) | $2.22 vs $1.01 (+120%, my calculation) | $2.09 (+74%) | $3.32 (+96%) |
| Next-quarter guide | Q3 FY27 $108.0B ±2% | Q4 2026 about $17B ±3% (+66% YoY) | FQ4 about $34.8B (+93%); AI about $21.7B |
| Free cash flow (quarter) | $21.3B | $554M (4% margin) | $13.7B (46% of revenue) |

Sources: [Nvidia Q2 FY27 release](https://investor.nvidia.com/news/press-release-details/2026/NVIDIA-Announces-Financial-Results-for-Second-Quarter-Fiscal-2027/default.aspx); [AMD Q3 2026 8-K, 2026-11-03](https://www.sec.gov/Archives/edgar/data/0000002488/000000248826000188/q32026991.htm); [Broadcom FQ3 2026 8-K, 2026-09-02](https://www.sec.gov/Archives/edgar/data/0001730168/000173016826000076/avgo-08022026x8kxex99.htm)

- Important definitional change: starting in Q1 FY27, Nvidia's non-GAAP figures no longer exclude stock-based compensation, and history is restated. Nvidia's non-GAAP is therefore more conservative than AMD's and Broadcom's, which still exclude SBC. Source: [Nvidia release](https://investor.nvidia.com/news/press-release-details/2026/NVIDIA-Announces-Financial-Results-for-Second-Quarter-Fiscal-2027/default.aspx)
- Nvidia's GAAP EPS ($2.46) is above its non-GAAP EPS ($2.22) mainly because of $7,771M of pre-tax gains on equity securities, which non-GAAP excludes. Source: same release.
- Gross margin trend: Q2 FY27 75.0%, Q1 FY27 74.9% (GAAP), Q2 FY26 72.4%. The Q3 guide is 74.0% ±50bp, a slight step down. Source: same release.
- Q3 FY27 consensus going into 2026-11-17: about $108.9B revenue and EPS of $2.47 to $2.49. Source: [search summary of previews, e.g. TipRanks](https://www.tipranks.com/stocks/nvda/earnings); [Yahoo/Motley Fool preview](https://finance.yahoo.com/markets/stocks/articles/nvidia-stock-just-lost-10-222802088.html)

### Inferences
- The step down in Q3 gross margin guidance (75.0% to 74.0%) may reflect Rubin ramp costs. This is my inference; the release does not say why.
- Nvidia's GAAP EPS growth is flattered by mark-to-market gains on its investment portfolio. Non-GAAP (+120%) is the cleaner growth figure. Even that is very high, but it is not the 128% GAAP figure.

### Gaps
- Marvell, Intel and Google segment comparisons were not gathered.
- Full-year FY27 consensus revenue and EPS were not found from a reliable source.

## 5. Cash vs debt, free cash flow, buybacks

### Takeaway
At 2026-07-26, Nvidia had $56.6B of cash plus marketable debt securities against about $33.4B of debt, so net cash is about $23B. It also held $42.8B of marketable equity and $51.2B of non-marketable stakes. Debt rose sharply because Nvidia issued $25B of notes in June 2026. Q2 free cash flow fell to $21.3B (from $48.6B in Q1) as receivables and inventory ballooned. Nvidia is buying back about $20B a quarter, mostly at prices well above today's.

### Cited Findings
- At 2026-07-26: cash and equivalents $22,443M (vs $10,605M at 2026-01-25), marketable debt securities $34,143M, marketable equity securities $42,783M, non-marketable securities $51,157M (vs $22,251M at 2026-01-25). Source: [Nvidia Q2 FY27 release](https://investor.nvidia.com/news/press-release-details/2026/NVIDIA-Announces-Financial-Results-for-Second-Quarter-Fiscal-2027/default.aspx)
- Debt: the net carrying amount is $33,366M, including a $1,000M short-term portion. The release shows long-term debt of $32,366M (vs $7,469M at 2026-01-25). Nvidia issued $25.0B of senior notes in June 2026, with Q2 debt proceeds of $24,896M. It has a $25.0B commercial paper program with nothing outstanding. Source: [10-Q](https://www.sec.gov/Archives/edgar/data/0001045810/000104581026000075/nvda-20260726.htm); [release](https://investor.nvidia.com/news/press-release-details/2026/NVIDIA-Announces-Financial-Results-for-Second-Quarter-Fiscal-2027/default.aspx)
- Cash flow: Q2 FY27 operating cash flow was $24,077M and free cash flow $21,341M. FCF was $48,554M in Q1 FY27 and $13,450M in Q2 FY26. Q2 GAAP net income was $59,688M. Source: [release](https://investor.nvidia.com/news/press-release-details/2026/NVIDIA-Announces-Financial-Results-for-Second-Quarter-Fiscal-2027/default.aspx)
- Q1 FY27 operating cash flow was $50.3B against $1.8B of capex. Source: [Cape Fear Advisors, 2026-06-25](https://capefearadvisors.substack.com/p/nvidia-adding-it-up-the-quality-of)
- Buybacks: 94M shares for $19.7B in Q2, and 203M shares for $39.8B in the first half of FY27. The remaining authorization is $99.3B. Q2 dividends were $6,047M. Total Q2 capital returned was about $26.0B. The next dividend is $0.25 per share. Source: [10-Q](https://www.sec.gov/Archives/edgar/data/0001045810/000104581026000075/nvda-20260726.htm); [release](https://investor.nvidia.com/news/press-release-details/2026/NVIDIA-Announces-Financial-Results-for-Second-Quarter-Fiscal-2027/default.aspx)
- Baseline check against the fund app's Yahoo data:
  - Yahoo "total cash $62.5B" does not match my $56.6B (cash plus marketable debt). The difference may come from a different date or definition. I could not reconcile it.
  - Yahoo "total debt $38.9B" vs $33.4B carrying debt: the gap is probably lease liabilities, which Yahoo usually includes. Not verified.
  - Yahoo "FCF $41.8B" is not consistent with reported FCF: $69.9B in the first half of FY27 alone (48.6 + 21.3). Yahoo's figure is probably a "levered FCF" estimate. Do not use it.

### Inferences
- Average buyback price: $19.7B / 94M is about $210 per share in Q2, and $39.8B / 203M is about $196 for the first half. The stock is now about $164 to $166, so first-half buybacks are underwater by roughly 15 to 20%.
- Nvidia borrowed $25B in the same quarter it spent about $26B on buybacks and dividends and invested heavily in private stakes (non-marketable securities rose about $29B since January). Operating cash flow ($24.1B) did not cover capital returns plus investments in Q2. This is a new pattern for a company that was net-cash-generative with minimal debt.
- Net cash excluding equity holdings (about $23B) is small next to a roughly $4T market cap. The real balance-sheet cushion is the $94B of equity stakes, whose value depends on the AI private markets.

### Gaps
- The July 2026 total for lease liabilities was not retrieved.
- Interest rate and maturities on the $25B June notes were not retrieved.

## 6. P/E: trailing, forward, PEG, history, peers, implied growth

### Takeaway
The fund app's numbers are internally consistent with a stock that has fallen about 30% from its October record, not with a stock split. At about $166, NVDA trades around 21x trailing GAAP EPS and roughly 10 to 13x forward, below the S&P 500's roughly 19 to 20x forward. Forward P/E figures vary widely by source (10x to 23x) depending on the price date and fiscal year used. A roughly 10x forward multiple on a company growing EPS more than 100% means the market expects earnings to peak and fall, or applies a large risk discount (CEO exit, capex cycle, financing quality).

### Cited Findings
- Price: Investing.com showed $163.91 mid-afternoon on 2026-11-12 (-5.66% on the day). Stockanalysis.com lists a $164.06 close. The 2026-11-11 close was $173.73 (market cap $4.19T). Source: [search summary of Investing.com and stockanalysis.com quotes](https://stockanalysis.com/stocks/nvda/history/). The app's $166.19 is consistent with an intraday 2026-11-12 print.
- 52-week high $243.37 and 52-week low $164.30 (Investing.com). The record close was about $239.24 on 2026-10-06, and about $1.4T of market value was erased by 2026-11-05. Source: [Investing.com via search summary](https://www.investing.com/equities/nvidia-corp-historical-data); [CryptoBriefing, 2026-11-05](https://cryptobriefing.com/nvidia-forward-pe-below-sp-500-walmart/). From $239.24 to about $166 is a drop of about 31% (my calculation).
- Forward P/E estimates: 11.0x next year's consensus (2026-11-11 calculation); about 12.9x to 13x (2026-11-05, CryptoBriefing, vs S&P 500 at about 18.7x to 20x and Walmart at 36x to 40x); about 14x (TIKR); about 23x (Motley Fool, 2026-11-01, at a higher price); GuruFocus 10.34x. Source: [search summary](https://www.gurufocus.com/term/forward-pe-ratio/NVDA); [CryptoBriefing](https://cryptobriefing.com/nvidia-forward-pe-below-sp-500-walmart/); [TIKR](https://www.tikr.com/blog/dan-niles-nvidias-next-ceo-will-set-a-low-bar-for-earnings); [Motley Fool, 2026-11-01](https://www.fool.com/investing/2026/11/01/prediction-nvidia-stock-is-going-to-soar-after-dat/)
- Peer forward P/Es (dates and sources conflict): AMD above 85x, Broadcom 32x, Nvidia 26x in one late-2026 piece. Another (around July 2026) has AMD at 69x and Broadcom at 20x. Walnut (August 2026) has AMD at 34.45x and AVGO at 19.97x. Zacks has AVGO at 23.8x. Source: [FinanceBuzz](https://financebuzz.com/news/holding-amd-just-got-harder); [Motley Fool, 2026-08-30](https://fool.com/investing/2026/08/30/broadcom-or-amd-heres-why-the-market-is-pricing); [Walnut](https://walnutinvest.com/stocks/compare/amd-vs-avgo); [Nasdaq/Zacks](https://www.nasdaq.com/articles/broadcom-overvalued-238x-p-e-should-you-still-buy-stock). None of these is reliably dated to 2026-11-12.
- Analyst targets: MarketBeat shows an average of $283.63 across 56 analysts. Source: [MarketBeat](https://www.marketbeat.com/stocks/NASDAQ/NVDA/forecast/). The app's $309.72 mean is higher, probably from before recent cuts (DA Davidson $300 to $200, Baird downgrade).
- Baseline consistency checks (my calculations from cited data):
  - Revenue growth 105.9% matches $96,221M / $46,743M.
  - Trailing P/E 21.0 at $166.19 implies trailing GAAP EPS of about $7.91. The last two quarters were $2.46 + $2.39 = $4.85, so the prior two quarters must sum to about $3.06. That fits Q3 FY26 GAAP EPS of $1.30, cited as the year-ago comparison in [this preview](https://finance.yahoo.com/markets/stocks/articles/nvidia-stock-just-lost-10-222802088.html). Q4 FY26 EPS was not retrieved.
  - Market cap $4.01T / $166.19 implies about 24.1B shares, consistent with no recent split.
  - Trailing revenue of $303B: the first half of FY27 is $177.8B (10-Q), which implies about $125B for Q3 plus Q4 FY26. Not directly verified.
  - Operating margin of 65.2% (TTM) is consistent with Q2's 66.2%.

### Inferences
- PEG (rough): trailing P/E of 21 divided by Q2 YoY non-GAAP EPS growth of about 120% gives about 0.2. With forward P/E of about 11 to 13 and next-quarter EPS growth of about 90% (consensus $2.47 vs $1.30), PEG is still well below 1. On any growth-adjusted measure the stock is priced for a sharp deceleration.
- What 10 to 11x forward implies: a forward P/E of 10.4 at $166 implies a forward EPS of about $16. Annualized Q3 consensus is about $10, so the $16 figure likely refers to fiscal 2028 consensus, which itself assumes another year of steep growth. If the market doubts that, the "true" forward P/E on lower estimates is higher. The bear's "cheap only if estimates hold" point applies.
- Nvidia is now cheaper on forward earnings than both AMD and Broadcom in every source found, a reversal of the usual premium.

### Gaps
- No reliable Nvidia 5-year or 10-year average P/E was found. I can't say how today's multiple compares with its own history in numbers.
- No consensus FY28 EPS was found from a named source.

## 7. Contrarian angles, bear and bull

### Takeaway
The bear case now has hard numbers behind it. Receivables rose 55% in one quarter with payment terms up to one year, supply commitments reportedly more than doubled, about 17% of first-half pretax profit came from equity-stake gains, financing deals with OpenAI and neoclouds are large and partly unsigned, and the founder-CEO left suddenly. The bull contrarian case is that a stock still growing EPS more than 100% now trades at about 11 to 13x forward, below the S&P 500, after a roughly 31% drawdown, with Q3 guided to another record.

### Cited Findings

**Bear / skeptical**
- Receivables: AR rose from $38,466M (2026-01-25) to $40.7B (2026-04-26) to $63,059M (2026-07-26). The 10-Q says that for investment-grade customers Nvidia has provided and may provide "longer payment terms ranging from 90 days up to one year." Source: [10-Q via search summary](https://www.sec.gov/Archives/edgar/data/0001045810/000104581026000075/nvda-20260726.htm); [Cape Fear Advisors](https://capefearadvisors.substack.com/p/nvidia-adding-it-up-the-quality-of)
- Michael Burry ("Big Short investor") flagged that five customers account for about 70% of receivables, calling it a "tremendous amount of concentration risk" (October 2026). Source: [Benzinga headline, Oct 2026](https://www.benzinga.com/markets/equities/26/10/62458211/big-short-investor-flags-major-vulnerability-for-nvidia-5-customers-account-for-70-of-receivables-tremendous-amount-of-concentration-risk) (article body could not be fetched)
- Inventory: $21,403M (2026-01-25), $25,797M (2026-04-26), $31,575M (2026-07-26). Q2 inventory provisions were $784M. Source: [10-Q](https://www.sec.gov/Archives/edgar/data/0001045810/000104581026000075/nvda-20260726.htm)
- Supply and capacity commitments: reported as $279B, up from $119B the prior quarter, plus $29B of cloud service agreements, $36B of AI cloud agreements and $25B of equity investment commitments. Source: [10-Q](https://www.sec.gov/Archives/edgar/data/0001045810/000104581026000075/nvda-20260726.htm). These figures came from an automated extraction of a truncated page. Verify them in the 10-Q before using.
- Equity-gain earnings: Q1 FY27 other income was $15.9B, including $13.4B of net unrealized gains on public equity. Q2 included $7,771M of equity-security gains. Stake gains were about 17% of first-half pretax profit. Source: [Cape Fear Advisors](https://capefearadvisors.substack.com/p/nvidia-adding-it-up-the-quality-of); [Nvidia release](https://investor.nvidia.com/news/press-release-details/2026/NVIDIA-Announces-Financial-Results-for-Second-Quarter-Fiscal-2027/default.aspx); [FourWeekMBA](https://fourweekmba.com/ai-stake-gains-were-17-of-nvidias-first-half-pretax-profit/)
- Remaining performance obligations on contracts longer than one year were only $2.6B at 2026-04-26. The skeptic's point is that most near-term revenue is not under long-term contract. Source: [Cape Fear Advisors](https://capefearadvisors.substack.com/p/nvidia-adding-it-up-the-quality-of)
- Circular financing:
  - Nvidia reportedly put about $30B of equity into OpenAI and more than $40B into AI equity stakes in 2026. Source: [The Next Web](https://thenextweb.com/news/nvidia-40bn-ai-equity-investments-2026)
  - It is reportedly discussing financing a further $350B of OpenAI chip purchases and a roughly $250B "credit wrap" for an OpenAI/SoftBank Ohio lease. These are reported talks, not signed terms. Source: [The Next Web](https://thenextweb.com/news/nvidia-announced-750bn-of-ai-deals-its-own-credit-market-flinched); [MarketBeat/Nasdaq on OpenAI backstop](https://www.nasdaq.com/articles/nvidias-openai-backstop-puts-ai-financing-risk-focus)
  - The Q2 release lists "compute financing platforms" with Apollo, BlackRock, Blackstone, Brookfield, Goldman Sachs and KKR to mobilize more than $500B of third-party capital (subject to definitive agreements). It also lists $3.3B of equity-method investments in infrastructure financiers. Source: [release](https://investor.nvidia.com/news/press-release-details/2026/NVIDIA-Announces-Financial-Results-for-Second-Quarter-Fiscal-2027/default.aspx); [10-Q](https://www.sec.gov/Archives/edgar/data/0001045810/000104581026000075/nvda-20260726.htm)
  - CoreWeave: a crowdsourced source describes a $6.3B obligation for Nvidia to buy unsold CoreWeave capacity through 2032. Treat this cautiously. Source: [bubble-map compilation](https://pq-cybarg.github.io/bubble-map/r-fin-nvidia-openai.html)
  - The IMF and BIS have flagged AI circular financing as a systemic risk. Huang called the circularity framing "ridiculous." Source: [search summary of Startup Fortune coverage, 2026-07-27](https://startupfortune.com/nvidias-750-billion-ai-financing-web-is-drawing-scrutiny-over-circular-money-flows/)
- Groq: a $13B technology license was recorded in investing activities in Q1 FY27, with $3.96B unpaid. A $2,944M Groq financing outflow appears in Q2. The release does not explain it. Source: [Cape Fear Advisors](https://capefearadvisors.substack.com/p/nvidia-adding-it-up-the-quality-of); [release](https://investor.nvidia.com/news/press-release-details/2026/NVIDIA-Announces-Financial-Results-for-Second-Quarter-Fiscal-2027/default.aspx)
- Selloff drivers cited on 2026-11-05 (before the resignation): the soaring cost of AI infrastructure and possible regulatory challenges tied to data center power consumption. Source: [CryptoBriefing](https://cryptobriefing.com/nvidia-forward-pe-below-sp-500-walmart/)
- Key-person and governance risk: the founder-CEO left abruptly amid reported FBI and congressional interest. Harvey Jones became the first-ever board Chair, which means Huang held unusual concentrated control until now. Source: [8-K](https://www.sec.gov/Archives/edgar/data/0001045810/000104581026000082/nvidiaannouncesceotransiti.htm); [Washington Post](https://www.washingtonpost.com/technology/2026/11/12/nvidia-board-weighs-jensen-huangs-future-after-affair-with-allege-chinese-spy/)

**Bull / counter-contrarian**
- Cape Fear Advisors, the skeptical piece, concludes that the "ring" between sales, customer funding and cash "works." Receivables are billed revenue with only a $4M allowance, equity gains are non-cash and stripped from operating cash flow, and the risks are disclosed. Source: [Cape Fear Advisors, 2026-06-25](https://capefearadvisors.substack.com/p/nvidia-adding-it-up-the-quality-of)
- Some analysts note that Nvidia's investments are minority stakes in companies with other customers, citing Meta's expanded CoreWeave contract. Source: [search summary of circular-financing coverage](https://startupfortune.com/nvidias-750-billion-ai-financing-web-is-drawing-scrutiny-over-circular-money-flows/)
- Valuation: about 11 to 13x forward vs the S&P 500 at about 18.7 to 20x, after about $1.4T of market value was erased from the October peak. Source: [CryptoBriefing, 2026-11-05](https://cryptobriefing.com/nvidia-forward-pe-below-sp-500-walmart/)
- Fundamentals were still accelerating at the last report: revenue +106%, Q3 guided to $108B (about +12% QoQ), Rubin in full production at five named clouds, and $99.3B of buyback authorization left. Source: [release](https://investor.nvidia.com/news/press-release-details/2026/NVIDIA-Announces-Financial-Results-for-Second-Quarter-Fiscal-2027/default.aspx)
- The board says the roadmap and customer commitments continue without interruption. Source: [8-K](https://www.sec.gov/Archives/edgar/data/0001045810/000104581026000082/nvidiaannouncesceotransiti.htm). Bullish previews argue the stock rebounds after 2026-11-17. Source: [Motley Fool, 2026-11-01](https://www.fool.com/investing/2026/11/01/prediction-nvidia-stock-is-going-to-soar-after-dat/); [Motley Fool, 2026-11-10](https://www.fool.com/investing/2026/11/10/prediction-nov-17-will-be-a-huge-day-for-the-stock-market/). These are opinion pieces.

### Inferences
- Days sales outstanding (my calculation, AR / quarterly revenue x 91 days): about 45 days at 2026-04-26 ($40.7B / $81.6B) and about 60 days at 2026-07-26 ($63.1B / $96.2B). A 15-day jump in one quarter, alongside extended terms of up to one year, is the clearest sign that Nvidia is partly funding its customers' purchases. It is also the main reason Q2 FCF fell to $21.3B while net income was $59.7B.
- The Q3 report on 2026-11-17 is the key test. Watch:
  - DSO and AR (does it keep rising?)
  - inventory and supply commitments
  - the size of equity gains in GAAP EPS
  - whether Q4 guidance assumes continued Hyperscale growth
  - any CEO-search or China-policy commentary
- The bull case is strongest if Q3 meets the $108B guide with AR stabilizing. The bear case is strongest if the interim CEO resets guidance lower while working capital keeps swelling.

### Gaps
- Hyperscaler depreciation-life debate (the move to 5 to 6 year GPU lives and its effect on capex economics): not researched in this pass. No 2026 sources gathered.
- Hyperscaler 2026/2027 capex guidance totals: not gathered.
- Power constraints: only one passing mention (CryptoBriefing). No grid or interconnect data.
- Short interest and Reddit/X sentiment: not gathered.
- The Burry article body could not be fetched (403). Only the headline claim is cited.
- The CNN live blog could not be fetched (HTTP 451). Stock-move figures from it come via search summaries.
