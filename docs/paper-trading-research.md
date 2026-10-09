# Paper trading: research notes (2026-10-08)

Background research for a later upgrade of the Paper trading page. Compiled by a research agent from web sources; most vendor facts came from search summaries (marketwatch.com and investopedia.com blocked direct reading). Items marked "unconfirmed" could not be verified from an official page.

## What the app does today
`lib/paperTrading.js`, `routes/paperTrading.js`, `public/views/paper.js`:
- Each semester "season" gives every member $100k; market buys/sells at the latest Yahoo price (live quote, else last close), no fees; members can't set their own fill price.
- Ranking by raw return (ties: fewer trades), with a benchmark column and a "short season is mostly luck" disclaimer.
- Missing: shorting, limit/stop orders, dividends, splits, trade rationale, risk metrics, position limits, market-hours check.

## 1. How existing products work
- **MarketWatch Virtual Stock Exchange**: archived Oct 2021 page shows it live with limit/stop orders and partial shares ([Wayback](https://webcf.waybackmachine.org/web/20211006085116/https://www.marketwatch.com/game?mod=WSJ)). Current status unconfirmed.
- **Investopedia Simulator**: $100k start, market/limit/stop, shorting, options; quote delay reported as 15 or ~20 minutes ([Yahoo Finance](https://finance.yahoo.com/news/best-investment-simulators-165729694.html), [clepsydris](https://clepsydris.com/2025/02/27/how-to-use-the-investopedia-simulator-master-virtual-trading-with-stocks-options-and-cryptocurrency/)). Unconfirmed officially.
- **StockTrak** (university standard): professors configure dates, cash, margin, commissions, position limits, can disable options/futures ([StockTrak](https://www.stocktrak.com/finance-professors/)); rankings by Sharpe, alpha/beta or return; assignment engine and gradebook. Per-student tiers listed at $13.95–$33.95 ([StockTrak](https://www.stocktrak.com/?p=210864)); current prices unconfirmed.
- **HowTheMarketWorks** (free, StockTrak's company): limit, stop, trailing stop; teachers can require a note with each trade ([HTMW](https://www.howthemarketworks.com/classroom/)). Closest model for "rationale per trade".
- **Wall Street Survivor**: $100k, stocks/ETFs/options/crypto; criticized for steering users to partners' paid products ([AOL](https://www.aol.com/3-best-stock-market-simulators-205152895.html)).
- **thinkorswim paperMoney**: $100k, default 20-minute delay ([Schwab](https://www.schwab.com/content/thinkorswim-papermoney-stock-trading-simulator)).
- **Interactive Brokers paper**: fills simulated from top of book; stops simulated; 15-minute-delayed quotes without a data subscription ([IBKR](https://www.interactivebrokers.com/en/trading/papertrader-delayed-data.php)).
- **Alpaca paper API**: fills vs real-time NBBO when marketable; no dividends, slippage or impact; 10% random partial fills; IEX-only data on paper-only accounts ([Alpaca](https://docs.alpaca.markets/docs/paper-trading)).
- **The Stock Market Game (SIFMA)** rules ([rules](https://www.stockmarketgame.org/rotg.html)): $100k; $5/trade + SEC fee on sells; margin interest; shorting only in margin accounts, ≥$3 stocks, ≥10 shares; after-hours/weekend orders fill at next open; all-or-nothing fills; automatic dividends and splits; NASDAQ/NYSE only, ≥$25M market cap; judged on equity or return vs S&P.

Worth copying: configurable constraints, required note per trade, next-open fills after hours, fees, automatic dividends/splits. Pitfalls: idealized fills, free shorting.

## 2. Realism vs gaming
- **Execution price**: realistic sims use 15–20 min delayed quotes or the next open. Ours fills at the live quote any hour; a market-hours check with next-open fills after the close is defensible (SIFMA rule).
- **Fees/slippage**: a flat fee or a few bps teaches the cost of churn ([Barber & Odean 2000](https://faculty.haas.berkeley.edu/odean/papers/returns/Returns.html): most active households 11.4%/yr vs market 17.9%).
- **Shorting/options**: SIFMA's college challenge bans shorting and inverse/leveraged ETFs ([CHC 2026 rules](https://www.stockmarketgame.org/document/CHC_2026_Rules.pdf)); student funds commonly ban derivatives/shorts ([UNK](https://www.unk.edu:443/academics/accounting-finance/_files/bauhard-fund-annual-report.pdf)). Defer both.
- **Splits/dividends**: without handling, a 2-for-1 split looks like a 50% loss. Record as ledger events (reuse `lib/dividends.js` event data).
- **Lottery tickets / end-of-season gaming**: tournament losers raise risk ([Brown, Harlow & Starks 1996](https://ideas.repec.org/a/bla/jfinan/v51y1996i1p85-110.html)); house-money effect ([Thaler & Johnson 1990](https://ideas.repec.org/a/inm/ormnsc/v36y1990i6p643-660.html)). Countermeasures: price/market-cap floors, max position size, no OTC, minimum holdings, Sharpe/drawdown in the score.

## 3. Pedagogy
- Simulation users earned higher grades in a quasi-experimental study ([ResearchGate](https://www.researchgate.net/publication/335045322_Stock_market_trading_simulations_Assessing_the_impact_on_student_learning)); small single-institution studies, abstracts only.
- Argument that simulations breed overconfidence (skill credited for luck) ([Conn College](https://digitalcommons.conncoll.edu/cgi/viewcontent.cgi?article=1045&context=econhp)); not a measured result.
- Debriefing with reflective surveys improved self-reported bias understanding ([T&F 2026](https://www.tandfonline.com/doi/full/10.1080/09639284.2026.2718097?af=R)).
- Student-managed funds: almost all use pitches, more than half vote ([Journal of Investing via EBSCO](https://www.ebsco.com/articles/business-and-management/2370bc24-3ccc-547c-baee-98cf0fc2d062/student-managed-investment-funds-turn-pro-innovation-benchmarking-and-performance)); IPS typically requires a call, target range and size ([TMU SIPP](https://www.torontomu.ca/content/dam/accounting-finance/smif/2020-SMIF-SIPP.pdf)).
- Forecasting skill can be learned and calibration scoring helps ([Advisor Perspectives on Tetlock](https://www.advisorperspectives.com/articles/2016/03/08/can-accurate-forecasting-be-learned)); applying it to trade journals is an extrapolation.

## 4. Scoring
- Short-window Sharpe is noisy; per [Lo 2002](https://traders.studentorg.berkeley.edu/papers/The-Statistics-of-Sharpe-Ratios.pdf)'s standard error, telling an annual Sharpe of 1 from 0 takes roughly 6 years (agent's calculation, assumes independent returns). One semester can't show skill.
- Suggested: show excess return, Sharpe, max drawdown, holdings count side by side; rank on excess return with qualification rules (min trades, ≥5 holdings, ≤25% single position); separate "process" prize for journal quality. Skip information ratio/Sortino for a one-semester club.

## 5. Social/learning features (judgment; thin evidence)
- Likely helpful: required rationale per trade (target, stop, horizon) reviewed at exit; link a pitch to a paper position; paper copy of the real fund; post-mortem when a position closes; weekly recap.
- Likely gimmicks: badges, streaks, public comments, following/copying others (herding).

## 6. Data
- Yahoo: no official API; terms bar automated/commercial reuse ([Yahoo TOS](https://legal.yahoo.com/us/en/frontier/terms/otos/index.html)); low risk for a closed club tool but can break without notice.
- Finnhub free: ~60 calls/min, US real-time quotes (third-party; unconfirmed officially).
- Alpaca: free IEX data; SIP tier ~$99/mo (third-party). Polygon/Massive free ~5 calls/min EOD, Starter ~$29/mo ([apicostcalc](https://apicostcalc.com/blog/polygon-massive-rebrand-api-pricing.html)). Tiingo free limits and redistribution terms unconfirmed.
- End-of-day fills (next open/close) are cheapest and fairest. Keep quotes behind login; real-time redistribution has exchange fees.

## 7. Recommendations
| Priority | Feature | Why | Effort |
|---|---|---|---|
| Must | Thesis note per trade (why, target, stop, horizon) | Best-supported learning feature | S |
| Must | Market-hours check; after-hours orders fill at next open | Stops instant news-trading | S–M |
| Must | Split and dividend handling in the ledger | Splits otherwise corrupt returns | M |
| Must | Small fee or slippage per trade | Teaches the cost of churn | S |
| Must | Risk columns: Sharpe, max drawdown, holdings count, excess return | Luck vs process | M (daily equity snapshots) |
| Must | Qualification rules: min holdings, max position, price/market-cap floor | Blocks lottery tickets | S–M |
| Should | Limit and stop orders (fill when the daily bar crosses) | Order mechanics | M–L |
| Should | Pitch → paper position link; paper copy of the real fund | Connects existing features | M |
| Should | Post-mortem prompt on close; weekly recap | Reflection | M |
| Should | Equity curve vs benchmark | Feedback | S–M |
| Nice | Process prize on journal quality | Rewards effort | S |
| Skip for now | Shorting, options, margin | Need borrow/pricing models | L |
| Skip | Badges, streaks, comments, copy-trading | Gimmicks/herding | — |
| Skip | Paid data / StockTrak licence | Free daily data is enough | — |

## Could not confirm
MarketWatch VSE status; Investopedia's delay/order types; Wall Street Survivor pricing; paperMoney fill model; TradingView fill model; Webull default balance; current StockTrak prices; Finnhub, Polygon/Massive, Tiingo official limits and Tiingo redistribution terms; exact Yahoo automated-access wording; evidence on social features' learning effects; literature on trade post-mortems; direct measurement of simulation-induced overconfidence.
