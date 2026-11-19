# Evidence base for PIF's own process metrics (thesis health, promise-kept ratio, pitch calibration, and similar)

Research date: 2026-11-13. Each claim cites the page it came from. Many details come from secondary summaries (search snippets, blogs, citing papers) rather than the primary paper, and those are flagged. PIF context: pitches already capture confidence %, horizon months, base/bull/bear targets, pre-mortem and bear checklist; the track record page already grades base-target-hit-by-horizon, Brier score, hit rate, calibration buckets, by analyst/sector/direction; paper trades require reason, target, stop and time frame.

## Forecast calibration and scoring (Brier, decomposition, GJP, Metaculus, sample sizes)

### Takeaway
PIF's existing Brier score and calibration buckets stand on solid ground (Murphy decomposition, Good Judgment Project). The weak point is sample size: no source gives a published minimum, real calibration plots use roughly 50 to 100+ resolved questions, and a student fund will have far fewer, so any "pitch calibration" metric needs confidence intervals or pooling, and should be labeled provisional.

### Cited Findings
- Murphy (1973), "A new vector partition of the probability score," splits the Brier score into reliability, resolution and uncertainty, written as BS = REL − RES + UNC. ([Siegert, arXiv 1303.6182](https://arxiv.org/pdf/1303.6182))
- Reliability is the miscalibration term: a systematic gap between stated probabilities and observed frequencies adds a positive reliability penalty. Resolution rewards forecasts that move with observed event rates; constant forecasts have zero resolution. Uncertainty depends only on outcomes and equals the Brier score of always forecasting the base rate. ([Siegert, arXiv 1303.6182](https://arxiv.org/pdf/1303.6182))
- The decomposition components are estimated by binning forecast probabilities. Binning introduces estimation error, so the estimated components may not sum exactly to the Brier score; Siegert's paper is specifically about estimating the variance of these components. ([Siegert, arXiv 1303.6182](https://arxiv.org/pdf/1303.6182))
- GJP: superforecasters (top ~2% of volunteers) beat a control group of averaged ordinary forecasters by more than 60% and beat an intelligence-community prediction market by 25 to 30% (citing *Superforecasting*, p. 18). ([AI Impacts](https://aiimpacts.org/evidence-on-good-forecasting-practices-from-the-good-judgment-project/))
- GJP skill persistence: about 70% of superforecasters kept that status year to year; the year-to-year correlation of performance across all forecasters was 0.65 (*Superforecasting*, p. 104). ([AI Impacts](https://aiimpacts.org/evidence-on-good-forecasting-practices-from-the-good-judgment-project/))
- Superforecasters' calibration was reported as 0.01 (average gap between stated probabilities and observed frequencies), citing Mellers et al. 2015. ([AI Impacts](https://aiimpacts.org/evidence-on-good-forecasting-practices-from-the-good-judgment-project/))
- Training: a one-hour training module tested in an RCT improved accuracy and the effect persisted at least a year (Mellers et al. 2015). ([AI Impacts](https://aiimpacts.org/evidence-on-good-forecasting-practices-from-the-good-judgment-project/))
- Chang, Chen, Mellers and Tetlock (2016) found the CHAMPS KNOW training, though under an hour, improved Brier scores by 6 to 11% over control; cognitive ability and practice made largely independent contributions. ([Judgment and Decision Making, Chang et al. 2016](https://dlab.sauder.ubc.ca/sjdm/journal/16/16511/jdm16511.html))
- Among trainees, forecasts tagged as using "comparison classes" (outside view / base rates) had an average Brier score of 0.17 vs 0.26 for the next-best tag (Chang et al. 2016). ([AI Impacts](https://aiimpacts.org/evidence-on-good-forecasting-practices-from-the-good-judgment-project/))
- A secondhand claim that Mellers reported improving analysts' Brier scores 50 to 60% over the GJP is not verified against the primary paper; it is a cumulative figure, not a controlled training effect. ([Commoncog](https://commoncog.com/how-the-superforecasters-do-it)) Treat the 6 to 11% controlled estimate as the better-supported number for training alone.
- Belief updating (more predictions per question) and deliberation time both improved accuracy; a model combining dispositional, situational and behavioral variables had a multiple correlation of 0.64 with accuracy (Mellers et al. 2015). ([AI Impacts](https://aiimpacts.org/evidence-on-good-forecasting-practices-from-the-good-judgment-project/))
- Horizon limits: GJP questions were mostly geopolitical and short-horizon; Tetlock reports expert accuracy declining toward chance about five years out (*Superforecasting*, p. 243). ([AI Impacts](https://aiimpacts.org/evidence-on-good-forecasting-practices-from-the-good-judgment-project/))
- Extremizing aggregated forecasts was used by GJP but its benefit is described as controversial. ([AI Impacts](https://aiimpacts.org/evidence-on-good-forecasting-practices-from-the-good-judgment-project/))
- Metaculus sample sizes in practice: the 2016 Metaculus analysis calibration plot covered 48 questions, binned 1 to 5%, 5 to 10% and so on. ([Metaculus, Analysis of 20,000 predictions](https://www.metaculus.com/news/2016/10/15/prediction-analysis/))
- An EA Forum review of Metaculus AI questions used 64 resolved binary questions (10,497 forecasts by 2,052 users) and 88 continuous ones, and used bootstrapping to test whether results could be chance; about half of the 50% confidence intervals intersected the y=x line. ([EA Forum, Exploring Metaculus's AI track record](https://forum.effectivealtruism.org/posts/e9htD7txe8RDdcehm/exploring-metaculus-s-ai-track-record))

### Inferences
- PIF's "base target hit by horizon" is a binary event and the pitch confidence % is the probability, so Brier and calibration buckets are a legitimate application. Adding the Murphy decomposition (reliability vs resolution) would let PIF say whether an analyst is miscalibrated or just undiscriminating (always says 60%).
- With a student fund producing perhaps tens of decided pitches a year, per-analyst calibration buckets will be dominated by noise. Defensible design: few wide buckets (e.g. 50 to 60, 60 to 75, 75+), show n per bucket, show bootstrap or binomial intervals, and pool across semesters. This is my inference, not a published threshold.
- The GJP finding that "comparison classes" help supports adding a base-rate field to pitches (e.g. "how often do stocks like this hit +X% in Y months").
- Belief-updating evidence supports letting analysts revise confidence over the life of a pitch and scoring each revision, not just the original.

### Gaps
- No source found giving a minimum number of resolved forecasts for a meaningful calibration curve or reliability estimate. Siegert's paper addresses variance of the components but its specific sample-size results were not retrieved.
- Did not retrieve Mellers et al. 2014/2015 primary texts or Good Judgment Inc.'s own scoring docs; GJP figures are via AI Impacts' summary of *Superforecasting* and the papers.
- Exact Brier skill score formula in terms of REL/RES/UNC was not verified against a primary source in this pass.
- Log score was not researched in this pass (no citation collected). Note only that it exists as an alternative proper scoring rule; do not cite numbers.

## Management credibility (guidance accuracy, candor, say-do, LLM extraction of promises)

### Takeaway
There is a real academic basis for a "promise-kept" or management credibility score: prior forecast accuracy is linked to stronger analyst and price reactions (Williams 1996; Hutton and Stocken), and markets discount forecasts according to manager incentives (Rogers and Stocken). Recent work uses LLMs to extract CEO promises and stated targets from earnings calls, which makes automated extraction feasible, but scoring whether promises were kept is still mostly unbuilt in the literature I found.

### Cited Findings
- Williams (1996), "The relation between a prior earnings forecast by management and analyst response to a current management forecast," *The Accounting Review* 71:103 to 115 (the title in the task brief does not match the published title). ([citing paper, Springer](https://springerlink.bibliotecabuap.elogim.com/content/pdf/10.1007/s11142-012-9217-4.pdf))
- Williams is cited for the finding that more accurate managers exert greater influence on price and analyst opinions; managers build a reputation for credible forecasts when prior forecasts proved accurate. (Secondhand; full text not retrieved.) ([core.ac.uk citing paper](https://core.ac.uk/download/18443582.pdf))
- Hutton and Stocken, "Prior Forecasting Accuracy and Investor Reaction to Management Earnings Forecasts": cited as finding larger news/price reaction for firms with a reputation for accurate and frequent forecasts. Publication details unclear (a 2009 working version and a later record exist). ([EconBiz record](https://econbiz.de/Record/prior-forecasting-accuracy-and-investor-reaction-to-management-earnings-forecasts-hutton-amy/10012663672))
- A 2016 study argues the accuracy effect often disappears once controlling for consistency (volatility of forecast errors), i.e. consistency may matter more than accuracy. ([HKUST Business Insight](https://bm.hkust.edu.hk/bizinsight/2016/11/consistency-more-useful-accuracy-earnings-forecasts))
- Rogers and Stocken ("Credibility of Management Forecasts"): about 600 companies, 1996 to 2000 (post-1995 PSLRA). Financially distressed firms tend to issue good-news forecasts above analyst estimates; firms in concentrated industries issue grimmer forecasts to deter entrants; managers misrepresent more when detection is harder. Investors discount optimistic forecasts but initially take bad-news forecasts at face value although they are just as likely to be biased; prices adjust later. ([Knowledge at Wharton, 2002](https://knowledge.wharton.upenn.edu/article/how-credible-are-management-forecasts-not-very/))
- The same article notes Stocken cautioned the study is small and more research is needed. ([Knowledge at Wharton](https://knowledge.wharton.upenn.edu/article/how-credible-are-management-forecasts-not-very/))
- Rittenhouse Rankings score candor in CEO shareholder letters by coding presence and absence of candor; negative candor is "F.O.G." (fact-deficient, obfuscating generalities); companies are ranked high to low. ([CFA Institute Enterprising Investor, 2014](https://rpc.cfainstitute.org/blogs/enterprising-investor/2014/how-understanding-ceo-candor-can-make-you-money))
- Rittenhouse's founder claims top-ranked companies outperformed bottom-ranked on average over seven years of comparisons and that rankings anticipated failures at Enron, HealthSouth, BP, MF Global and AIG. These are the founder's own claims, not independently verified; she funds the survey by consulting for executive teams (clients are removed from the public survey) and describes it as a screen, not a standalone return predictor. ([CFA Institute Enterprising Investor](https://rpc.cfainstitute.org/blogs/enterprising-investor/2014/how-understanding-ceo-candor-can-make-you-money))
- Majzoubi, Murray and Mayew, "Shaping expectations, losing flexibility: A study of CEO promises as strategic communication tools," *Strategic Management Journal* (2026): LLM analysis of over 69,000 earnings-call transcripts of S&P 1500 firms (2010 to 2022), identifying 74,017 CEO promises. Whether fulfillment was tracked could not be confirmed (abstract fetch timed out). ([MetaTOC listing](https://metatoc.com/papers/120672-shaping-expectations-losing-flexibility-a-study-of-ceo-promises-as-strategic-communication-tools))
- "Can LLMs Hit Moving Targets?" uses an LLM to extract stated targets from earnings call transcripts, replacing an earlier named-entity-recognition approach the authors found limited in accuracy and explainability. ([arXiv 2510.03195](https://arxiv.org/html/2510.03195v1))
- arXiv 2503.16974 benchmarks LLMs on financial text tasks including identifying forward-looking statements across MD&As, FOMC statements, news, earnings call transcripts and financial statements. ([arXiv 2503.16974](https://arxiv.org/pdf/2503.16974v2))
- Practitioner note (blog, not peer reviewed): the Q&A section of a call mixes speakers whose statements carry different legal weight; restrict extraction to management statements. ([aifinhub article](https://aifinhub-monorepo.pages.dev/articles/prompt-patterns-earnings-calls/))

### Inferences
- A PIF "promise-kept ratio" can be framed as an extension of the guidance-accuracy literature from numeric EPS guidance to qualitative commitments (launch dates, capex, plant openings, margin targets). It should be labeled as PIF's own metric.
- Pitfalls supported by the sources: (1) incentive-driven bias differs for good vs bad news, so score optimistic and pessimistic promises separately; (2) consistency may matter more than average accuracy, so show spread, not just a ratio; (3) candor scoring has commercial-conflict and verification issues, so don't present a candor-style score as predictive of returns.
- Further pitfalls (my inference): vague promises are easy to "keep," so the denominator should count only promises with a checkable state and date; LLM extraction needs human review on a sample before scores are shown; companies may quietly drop promises, so "not mentioned again" needs its own status.

### Gaps
- Did not find a published academic "say-do ratio" for management; the term appears to be practitioner usage. No primary source retrieved.
- No paper found that systematically scores capex, plant, or product launch timing promises against outcomes.
- Full texts of Williams (1996) and Hutton and Stocken not retrieved; sample and effect sizes unknown here.

## Thesis tracking and decision journals (Mauboussin, Klein pre-mortem, Annie Duke kill criteria, Steinhardt variant perception)

### Takeaway
Decision journals, pre-mortems, kill criteria and variant perception all have named, citable practitioner sources. Together they justify a "thesis health score" built from pre-written, checkable pillars and kill criteria (state plus date), scored against what actually happened. I found no public source describing how buy-side firms formally score "thesis pillars."

### Cited Findings
- Mauboussin recommends that for any consequential decision you write down what you expect to happen and why, which counters hindsight bias by recording what you thought at the time. ([Farnam Street](https://fs.blog/how-to-improve-the-quality-of-our-decision-making/))
- Mauboussin suggests tracking individual or group pre-mortems in the decision journal. ([Acquirer's Multiple](https://acquirersmultiple.com/2020/07/michael-mauboussin-perform-a-premortem-before-you-invest))
- Klein introduced the premortem in "Performing a project premortem," *Harvard Business Review* 85(9), 18 to 19 (2007): assume the project has failed and list plausible reasons. Mauboussin credits Klein's research with showing premortems surface more potential problems than other techniques. ([Acquirer's Multiple](https://acquirersmultiple.com/2020/07/michael-mauboussin-perform-a-premortem-before-you-invest))
- Annie Duke, *Quit: The Power of Knowing When to Walk Away* (Portfolio, Oct. 4, 2022). ([Kirkus Reviews](https://www.kirkusreviews.com/book-reviews/annie-duke/quit/print))
- Duke's kill criteria use "state and date": set benchmarks well in advance and hold yourself to them; template "If by (date), I have/haven't (reached a particular state), I'll quit." She also suggests a pre-mortem to find criteria. ([Bobby Powers review](https://bobbypowers.net/review-quit/); [Time partner page](https://partners.time.com/charter/6222791/quit-annie-duke))
- Kill criteria are described as setting rules in advance and precommitting; a stop-loss is given as an example of part of kill criteria. ([ThinkAdvisor](https://thinkadvisor.com/2022/11/01/the-key-to-knowing-when-its-time-to-quit))
- Steinhardt (*No Bull*) defined variant perception as a well-founded view meaningfully different from market consensus, and stressed knowing what market expectations actually are. (Secondary source.) ([Acquirer's Multiple](https://acquirersmultiple.com/2021/12/michael-steinhardt-develop-a-variant-perception))
- Mauboussin and Rappaport: variant perception is a well-founded view of a company's prospects not priced into the stock; expectations investing starts from the price and uses a reverse DCF to read implied expectations; returns come from revisions of expectations. ([Motley Fool Q&A, 2022](https://www.fool.com/investing/2022/01/19/expectations-investing-qanda-mauboussin-rappaport))
- A commentary frames the discipline as: name the expectation you are challenging, explain why your view is better founded, and specify what evidence would show you were wrong. ([The Financial Pen](https://thefinancialpen.substack.com/p/variant-perception-the-mechanics))

### Inferences
- "Thesis health score" design grounded in these sources: at pitch time, require 2 to 4 pillars, each with a state-and-date check (Duke) and the consensus number it disagrees with (Steinhardt / Mauboussin). At each check date, mark pillar intact / weakened / broken. Score = share of pillars intact, plus whether any kill criterion fired and whether the position was actually exited when it did.
- PIF already has pre-mortem and bear checklist fields; a natural process metric is "pre-mortem hit": did the eventual failure reason appear in the pre-mortem? That is a PIF invention; no source measures it.
- Thesis drift (my inference): if the stated reason for holding changes over time without a new pitch, flag it. Journals make this detectable because the original reasons are recorded.
- Pitfall: scoring pillar status is subjective; the analyst who owns the pitch has an incentive to mark pillars intact. Have a second member (or red team) mark status.

### Gaps
- No public practitioner source found on how buy-side firms track or score "thesis pillars" or KPI dashboards per position.
- No empirical study found measuring whether decision journals improve investment returns.
- A widely repeated claim that "prospective hindsight" (imagining an outcome already happened) raises the ability to identify reasons by 30% appeared in search results without a traceable source; not verified, do not cite.
- "Thesis drift" as a named, measured concept: no source found.

## Process vs outcome metrics (hit rate, win/loss, behavioral alpha, disposition effect, selling skill)

### Takeaway
The strongest precedents for decision-level metrics are Odean's PGR/PLR (disposition effect), Akepanidtaworn et al.'s buy vs sell skill against random benchmarks, and Essentia Analytics' decision-type breakdown (picking, entry, sizing, scaling, exit). The key lesson from all three: hit rate alone is weak; pros often sit below 50%, and the payoff ratio and exit quality matter.

### Cited Findings
- Odean (1998), "Are Investors Reluctant to Realize Their Losses?", *Journal of Finance* 53(5), 1775 to 98: 10,000 discount-brokerage accounts. PGR = realized gains / (realized gains + paper gains); PLR the same for losses; disposition effect is PGR > PLR. ([CFA Digest abstract](https://rpc.cfainstitute.org/-/media/documents/article/cfa-digest/1999/dig-v29-n2-469-pdf.pdf))
- Reported aggregate figures: PGR 0.148, PLR 0.098. (Secondary summaries; consistent across two sources.) ([EarnForex](https://www.earnforex.com/blog/disposition-to-keep-losses-and-cut-winners/); [CFA Digest](https://rpc.cfainstitute.org/-/media/documents/article/cfa-digest/1999/dig-v29-n2-469-pdf.pdf))
- Odean argues the pattern is not explained by rebalancing or trading frequency; tax-loss selling concentrates in December. ([CFA Digest](https://rpc.cfainstitute.org/-/media/documents/article/cfa-digest/1999/dig-v29-n2-469-pdf.pdf))
- Akepanidtaworn, Di Mascio, Imas and Schmidt, "Selling Fast and Buying Slow," *Journal of Finance* 78(6), 3055 to 3098 (2023): institutional portfolios averaging $573 million; managers show skill in buying but selling underperforms substantially, even relative to random-selling strategies. ([NBER w29076](https://nber.org/papers/w29076); [SSRN](https://papers.ssrn.com/abstract=3301277))
- Mechanism: attention is allocated unevenly; selling uses a heuristic. Stocks with extreme past returns are about 50% more likely to be sold than those with zero benchmark-adjusted returns, while past returns have little predictive power for buys. Evidence on earnings announcement days, when attention is focused, shows better selling. ([NBER working paper PDF](https://www.nber.org/system/files/working_papers/w29076/w29076.pdf))
- Essentia Analytics study of 76 managers: only 18% had a hit rate above 50%; the best manager was right 55% of the time; 68% delivered more value when right than they lost when wrong (a win/loss-style measure). ([Institutional Investor](https://www.institutionalinvestor.com/article/b1zsqjnqsxx2fd/Were-Those-Great-Returns-the-Result-of-Skill-or-Just-Luck))
- Essentia's Behavioral Alpha Benchmark covers seven decision types: stock picking, entry timing, sizing, scaling in, size adjusting, scaling out, exit timing. ([Global Trading](https://www.globaltrading.net/?p=29575))
- Essentia found three-quarters of managers destroyed value through scaling out; another study said managers could have saved an average of 94 bp per year by selling earlier. Clare Flynn Levy: most value was destroyed by holding losing positions too long and exiting into falling prices. These are Essentia's own client-sample findings, not independently verified. ([Global Trading](https://www.globaltrading.net/?p=29575); [Essentia "Holding the Line" PDF via HedgeNordic](https://hedgenordic.com/wp-content/uploads/2018/11/Holding-the-Line-v1.1-ONLINE.pdf); [The Decision Lab](https://www.thedecisionlab.com/insights/finance/the-behavioral-frontier-of-active-investment-management))
- Institutional Investor notes the Essentia sample is limited to its clients. ([Institutional Investor](https://www.institutionalinvestor.com/article/b1zsqjnqsxx2fd/Were-Those-Great-Returns-the-Result-of-Skill-or-Just-Luck))

### Inferences
- PIF can compute PGR/PLR directly from paper-trading data (needs daily snapshots of open positions vs sales). This is a standard, citable metric, not an invention.
- "Selling skill vs random" can be replicated: for each sale, compare the sold stock's subsequent return against a randomly chosen other holding sold instead. That is the Akepanidtaworn et al. benchmark logic applied to PIF.
- PIF's hit rate should always be shown next to a payoff ratio (average gain on winners / average loss on losers); Essentia's data shows hit rates below 50% are normal for professionals.
- "Idea decay" (my inference): plot average excess return of pitched names by month since pitch to see whether edge fades before horizon. No source collected on this in this pass.
- Pitfall: small samples and short holding periods make all of these noisy for a student fund; paper trading also lacks real loss aversion, which may understate the disposition effect.

### Gaps
- Cabot Investment Technology: no source retrieved in this pass.
- "Slugging ratio" as a named practitioner metric: no primary source retrieved.
- Sizing skill measurement method (beyond Essentia's category list): not documented here.
- Idea decay / alpha decay of recommendations: not researched in this pass.

## Student-managed fund (SMIF) evaluation research

### Takeaway
The SMIF literature mostly evaluates funds on returns, and several papers say direct assessment of learning is scarce. That gap is a real opening for PIF: process metrics (calibration, decision quality) are a way to measure learning that the literature itself says is missing.

### Cited Findings
- Ramsey and Isengildina-Massa (AETR, 2020) surveyed students in a student-managed commodity fund and measured self-assessed improvement; they note little evaluation of SMIF student outcomes exists, with Clinebell and Murphy (2016) an exception (alumni survey found improved knowledge and soft skills). ([AAEA AETR PDF](https://www.aaea.org/UserFiles/file/AETR_2020_016RRissue6.docx.pdf))
- Belcher and Jones, "Assessment of Student Managed Investment Programs: Are they Mutual Funds or Pedagogical Devices?" (*Journal of Knowledge Management Practice*; year shown as 2026 in search results, not verified): assessment of learning lags; most work focuses on fund return performance. ([JKMP](https://journals.klalliance.org/index.php/JKMP/article/view/615))
- A University of St. Thomas study measures learning as the change in one-year risk-adjusted returns from stock purchases made in the first two months of the academic year vs a later period. ([St. Thomas research online](https://researchonline.stthomas.edu/esploro/outputs/journalArticle/Using-Performance-Data-to-Evaluate-Student/991015131090403691))
- Kranner, Stoughton and Zechner (*Journal of Investment Management*, 2019) studied three competing student-managed portfolios in Vienna over ten years, focusing on team decision-making and behavioral biases similar to those in professional asset management. ([JOIM PDF](https://joim.com/wp-content/uploads/emember/downloads/p0596.pdf))
- An Oklahoma State study tested whether SMIF participation better prepared students for finance careers. ([SHAREOK](https://shareok.org/handle/11244/335532))

### Inferences
- The St. Thomas design (early-year vs late-year decision quality) can be reused with PIF's Brier score: compare each analyst's first-semester vs later Brier score as a "learning" metric. That aligns with GJP evidence that practice improves accuracy.
- Kranner et al. suggest student funds show the same biases as professionals, which supports applying disposition-effect and selling-skill metrics to students.

### Gaps
- Full texts not opened; the papers' specific results and effect sizes are not reported here.
- No source found on SMIFs using calibration or Brier scores specifically.

## Other candidate invented metrics (variant perception score, catalyst hit rate, time-to-thesis-check, red-team survival, conviction-weighted return, alpha per hour)

### Takeaway
Each of these can be anchored to a precedent above, but none has its own empirical literature that I found. They should be presented as PIF's own metrics with the anchor named.

### Cited Findings
- Variant perception score anchor: Steinhardt's "well-founded view meaningfully different from consensus" and Mauboussin's reverse DCF to read implied expectations. ([Acquirer's Multiple](https://acquirersmultiple.com/2021/12/michael-steinhardt-develop-a-variant-perception); [Motley Fool](https://www.fool.com/investing/2022/01/19/expectations-investing-qanda-mauboussin-rappaport))
- Catalyst hit rate and time-to-thesis-check anchor: Duke's state-and-date kill criteria. ([Bobby Powers review](https://bobbypowers.net/review-quit/))
- Red-team survival anchor: Klein's premortem surfaces more problems and encourages open exchange (per Mauboussin). ([Acquirer's Multiple](https://acquirersmultiple.com/2020/07/michael-mauboussin-perform-a-premortem-before-you-invest))
- Conviction-weighted return / sizing anchor: Essentia's sizing and size-adjusting decision types. ([Global Trading](https://www.globaltrading.net/?p=29575))
- Selling discipline anchor: buying skill coexisting with worse-than-random selling. ([NBER w29076](https://nber.org/papers/w29076))

### Inferences
- Variant perception score: gap between the analyst's base target (or implied growth) and consensus target/estimates at pitch time, then whether the outcome landed closer to the analyst or consensus. Pitfall: a large gap is not good by itself; score it only together with outcome, or it rewards contrarianism.
- Catalyst hit rate: share of named catalysts that occurred by their stated date, separate from whether the stock moved. Pitfall: catalysts can happen with no price effect, so report both.
- Time-to-thesis-check: days between a pillar's check date and when someone actually reviewed it. A pure process/discipline metric; cheap to compute.
- Conviction-weighted return: returns weighted by stated confidence % or position size; tests whether high-confidence pitches do better (equivalent to resolution in Brier terms).
- Alpha per hour of research: requires self-reported hours, which are unreliable; small samples make it very noisy. Lowest priority.
- General pitfall (Goodhart-style, my inference): once a metric is shown on a leaderboard, analysts may game it (e.g. pick easy targets to raise hit rate, state 50% to avoid Brier penalties). Brier's resolution term and payoff ratios partly guard against this.

### Gaps
- No empirical research found for "red-team survival," "catalyst hit rate," "time-to-thesis-check," "conviction-weighted return," or "alpha per hour of research" as named metrics.
- Did not search for analyst-recommendation-level studies of target-price accuracy (e.g. sell-side target price hit rates), which would be a direct benchmark for PIF's base-target-hit metric.
