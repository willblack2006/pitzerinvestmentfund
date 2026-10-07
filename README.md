# Pitzer Investment Fund — Holdings Tracker & Research Platform

A research platform for the fund, built on free/free-tier data: track positions, research any
ticker in depth, discover competitors and adjacent stocks, watch insider activity, and read the
macro backdrop — alongside a shared, password-gated editing model for the fund's holdings.

## Pages
Navigation is grouped into four areas. Press `/` anywhere to jump to the ticker search. The bell
icon in the header counts alerts that need action; the gear icon opens Settings.

### Portfolio
- **Holdings** (`/`): the holdings table, totals, the largest positions, and a "Needs attention"
  feed.
- **Performance** (`#/performance`):
  - current holdings vs the benchmark over the past year, with beta, volatility, Sharpe ratio,
    information ratio and max drawdown;
  - return contribution by holding;
  - a correlation heatmap of the 12 largest holdings;
  - a time-weighted fund return built from nightly valuation snapshots plus the transaction ledger.
- **Allocation & policy** (`#/allocation`): sector weights vs the S&P 500, plus investment policy
  (IPS) checks:
  - position size, sector size, number of holdings and minimum cash;
  - share classes of the same company counted together (e.g. GOOG + GOOGL).
- **Transactions** (`#/transactions`): the ledger of buys, sells, dividends, deposits, withdrawals
  and fees.
  - Recording an entry updates holdings, average-cost basis, realized gains and cash.
  - Deleting an entry reverses it exactly.
- **Alerts** (`#/alerts`): everything that needs attention, plus a 45-day earnings calendar for
  holdings and the watchlist. Alerts cover:
  - price alerts that have triggered;
  - team price targets reached;
  - policy breaches;
  - earnings within 7 days;
  - insider open-market buys;
  - open votes.

### Research (`#/research/:symbol/:tab`)
Works for any ticker. Every tab has its own link.

- **Overview:** key stats and an analyst snapshot (upside to target, F-score, ROIC, beta,
  next earnings). Also the fund's position, the price chart, news and peers.
- **Financials:** five fiscal years of SEC data:
  - growth, margins, free cash flow, ROE/ROIC, net debt, share-count change and shareholder
    yield;
  - quarterly revenue and net income;
  - Piotroski F-score, Altman Z-score and Beneish M-score, each with an explanation. Scores
    that don't apply to financial companies are marked n/a.
- **Valuation:**
  - a peer comparison table with medians and premium/discount, where you can add tickers;
  - a DCF workbench prefilled from SEC filings, with a sensitivity grid and reverse DCF
    (the growth rate the market is pricing in). "Use as pitch target" carries the value into a
    new pitch.
- **Street:**
  - the analyst price-target range and upside;
  - the four-month rating trend;
  - consensus EPS and revenue with revision counts and 90-day drift;
  - earnings beats and misses;
  - the next earnings date;
  - recent upgrades and downgrades.
- **Risk:**
  - two-year performance against the benchmark and the company's sector ETF;
  - beta, volatility, max drawdown, Sharpe ratio and correlation;
  - the 50- and 200-day moving-average trend;
  - short interest.
- **Ownership:** top institutional holders and their quarterly changes, plus insider Form 4
  transactions.
- **Filings:** recent 10-K, 10-Q and 8-K filings, with optional AI briefs (below).
- **Thesis:** the team thesis with a price target and the price when it was set (so calls can be
  graded later), price alerts, and pitches for this ticker.

### Ideas
- **Discovery** (`#/screener`): peers of holdings that the fund doesn't own yet.
- **Watchlist** (`#/watchlist`): names being tracked.
- **Pitches** (`#/pitches`): a structured pitch template:
  - thesis, catalysts, risks and valuation;
  - bear, base and bull cases with price targets;
  - proposed position size.

  The price when the pitch was made is recorded automatically. Each pitch moves through
  draft → investment committee vote → approved or rejected → executed. Signed-in members vote,
  and the threshold and quorum are set in Settings.

### Market
- **Macro** (`#/macro`) and **Insiders** (`#/insiders`).

### Settings (`#/settings`)
- Investment policy limits, vote threshold and quorum, the benchmark, and the cash balance.
- **Members:** each member has a 4–8 digit PIN, hashed with scrypt. Marking a member as alumni at
  the end of a semester revokes their access and keeps their votes on record.

## Benchmarks
The fund benchmark is set in **Settings** and drives performance, beta/relative charts and the
sector comparison. The picker offers about 70 presets in these groups:
- US large cap, total market, and mid/small cap
- style and factor (growth, value, momentum, quality, minimum volatility, dividend)
- global and international
- the 11 SPDR sector ETFs
- themes
- bonds
- multi-asset blends
- price-only indices

You can also enter any Yahoo ticker, or a custom blend like `SPY:60,AGG:40` (up to 6
components, rebalanced daily; weights are normalized to 100%).

The **Performance** page and each ticker's **Risk** tab have a "Compare with" picker for ad-hoc
comparisons that don't change the fund setting.

For the sector comparison:
- Blends use the sector weights of their equity part, scaled to 100%.
- Benchmarks with no sector data (bonds, single stocks, price indices) fall back to the S&P 500.

The preset catalogue lives in `lib/benchmarks.js`; adding one is a single line.

## Access model
- **Viewing:** open to everyone.
- **Editing:** holdings, theses, watchlist, transactions, settings and members need the shared
  `EDIT_PASSWORD` ("Unlock editing").
- **Voting:** needs an individual member sign-in ("Sign in"), so votes and pitch authorship are
  attributable.

## AI filing briefs (optional)
Set `ANTHROPIC_API_KEY` to enable "Summarize with Claude" on the Filings tab.
- It extracts Risk Factors and MD&A (or the whole text of an 8-K) and asks Claude (Opus 5.5) for
  a structured brief: bottom line, what changed, key risks, outlook, red flags, and questions to
  ask.
- Each brief is generated once per filing and cached for 30 days.
- Generating one requires unlocked editing, so the API credit spend stays with the fund's
  editors.
- A typical 10-K brief costs roughly $0.10–0.30.

Accessibility: the app targets WCAG 2.2 AA:
- keyboard-sortable tables and focus management on navigation;
- labelled controls and text alternatives for every chart;
- ▲/▼ shape cues alongside red/green;
- reduced-motion support and an OS-driven light/dark theme.

## Stack
- Node.js + Express (routers split per feature area under `routes/`)
- SQLite (`better-sqlite3`): `positions`, `research_notes`, `watchlist`, and a generic
  `api_cache` table that every external API call is cached through (own TTL per source)
- Plain HTML/CSS/JS frontend, ES modules + a tiny hash router (`public/router.js`), no build step
- Chart.js via CDN for price charts and macro sparklines

## Data sources
| Source | Key needed? | Used for |
|---|---|---|
| Yahoo Finance (`chart`, `quoteSummary`, `recommendationsBySymbol`) | No (uses a session crumb/cookie handshake) | Price history, profile, key stats, peers |
| SEC EDGAR (`company_tickers.json`, `companyfacts`) | No (needs a declared `User-Agent`) | Historical revenue/net income/EPS |
| [Finnhub](https://finnhub.io/register) free tier | Yes, free | News, insider transactions, valuation/growth metrics |
| [FRED](https://fredaccount.stlouisfed.org/apikeys) | Yes, free | Macro series |
| SEC EDGAR `submissions` + filing documents | No | Filing list and text for AI briefs |
| Yahoo `quoteSummary` (earningsTrend, calendarEvents, upgradeDowngradeHistory, institutionOwnership, SPY topHoldings) | No | Street view, ownership, S&P sector weights |
| Finnhub `stock/metric`, `calendar/earnings` | Free key | Peer comps, earnings calendar |
| [Anthropic API](https://console.anthropic.com/) | Optional, paid | AI filing briefs |

Any page/feature that needs a missing key degrades gracefully with a clear "needs an API key"
message rather than erroring — the app is fully usable with just the keyless sources.

## Local development
```bash
npm install
cp .env.example .env   # fill in FINNHUB_API_KEY, FRED_API_KEY, SEC_USER_AGENT, EDIT_PASSWORD
npm start
```
Visit http://localhost:3000.

## Changing the edit password
Set `EDIT_PASSWORD` in `.env` (local) or as an env var (deployed). Anyone who knows it can click
"Unlock editing" to add/edit/delete positions, save a thesis, or manage the watchlist. Viewing
never requires a password.

## Testing
```bash
npm test            # unit + API tests (offline; boots the server on a throwaway database)
npm run test:live   # also hits Yahoo/SEC/Finnhub/FRED through the server (needs .env keys)
```
The tests cover:
- the financial math: the quality scores, risk statistics, time-weighted return and benchmark
  blends;
- the full ledger (buys, sells, dividends and cash, with exact reversal);
- members, pitches and voting rules;
- validation and security: rate limits, headers and HTML escaping.

## Security notes
- Set a strong `EDIT_PASSWORD`. The server logs a warning if it's still the default.
- Edit-password and member-PIN logins are rate limited: 10 failures per 15 minutes per IP, and
  per member for PINs.
- PINs are stored as salted scrypt hashes and are never returned by the API.
- All third-party and user text is HTML-escaped before rendering. AI briefs go through a
  restricted Markdown renderer.

## Deploying (Render.com)
The live app is https://pitzer-investment-fund.onrender.com, a Render Starter instance (about
$7/month) with a 1 GB disk ($0.25/month) holding the SQLite database. Pushes to `main` deploy
automatically; each deploy has ~30-40s of downtime while the instance restarts (disks prevent
zero-downtime deploys).

`render.yaml` defines the web service, its persistent disk (so the database survives restarts)
and the env vars this app needs:

1. Push this repo to GitHub.
2. In Render, choose **New > Blueprint**, point it at the repo — it reads `render.yaml`.
3. Set `EDIT_PASSWORD`, `FINNHUB_API_KEY`, `FRED_API_KEY`, and `SEC_USER_AGENT` (a real contact
   email, e.g. `"Pitzer Investment Fund you@pitzer.edu"`) when prompted.
4. Deploy. Render gives you a public URL to share with fund members.

Any other Node host with a persistent disk/volume (Railway, Fly.io, a VPS) works the same way —
point `DB_PATH` at that persistent volume, not ephemeral storage.

## Background refresh
A single in-process scheduler (`lib/scheduler.js`) pre-warms the FRED macro cache once a day and
refreshes a daily valuation snapshot, dated by the market's last close (feeds time-weighted
returns). Viewing the Performance page also records one, so hosts that sleep when idle (Render's
free plan) still build history whenever someone uses the app. On the free plan, consider a
paid instance or an uptime pinger if you want unbroken daily snapshots.
Per-ticker research/screener/insider data is fetched on demand and cached, not eagerly refreshed
for all 32 holdings, to stay well under Finnhub's free-tier rate limit (guarded further by
`lib/fetchWithLimit.js`). Setting `AUTO_REFRESH_PRICES=true` additionally refreshes holdings'
`lastPrice`/`marketValue` from Yahoo on the same schedule — off by default so it doesn't change
the existing manual-price workflow without opt-in.

## Data
`seed.js` has the initial 32 positions transcribed from the fund's Yahoo Finance portfolio
screenshots (as of 2026-10-04). It only seeds the database on first run — all later changes
happen through the UI and persist in the SQLite file at `DB_PATH` (default `data/pif.db`,
gitignored).
