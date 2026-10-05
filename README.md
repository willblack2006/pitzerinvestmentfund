# Pitzer Investment Fund — Holdings Tracker & Research Platform

A research platform for the fund, built on free/free-tier data: track positions, research any
ticker in depth, discover competitors and adjacent stocks, watch insider activity, and read the
macro backdrop — alongside a shared, password-gated editing model for the fund's holdings.

## Pages
- **Holdings** (`/`) — the 32 positions, totals, add/edit/delete under the shared edit password.
- **Research** (`#/research/:symbol`) — works for *any* ticker. Price chart, company profile,
  key stats, SEC-sourced financial history, peers/competitors, news, and a team "thesis" box.
- **Discovery** (`#/screener`) — candidates sourced from peers of your holdings, not yet owned,
  ranked by how many holdings suggest them, with live valuation/growth metrics.
- **Insiders** (`#/insiders`) — SEC Form 4 insider buy/sell activity across all holdings, with a
  fund-wide net buying/selling summary.
- **Macro** (`#/macro`) — fed funds rate, CPI, unemployment, 10-year treasury yield from FRED.
- **Watchlist** (`#/watchlist`) — candidates the fund is tracking but doesn't own yet.

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

## Deploying (Render.com)
`render.yaml` defines a web service with a persistent disk (so the SQLite database survives
restarts) and the env vars this app needs:

1. Push this repo to GitHub.
2. In Render, choose **New > Blueprint**, point it at the repo — it reads `render.yaml`.
3. Set `EDIT_PASSWORD`, `FINNHUB_API_KEY`, `FRED_API_KEY`, and `SEC_USER_AGENT` (a real contact
   email, e.g. `"Pitzer Investment Fund you@pitzer.edu"`) when prompted.
4. Deploy. Render gives you a public URL to share with fund members.

Any other Node host with a persistent disk/volume (Railway, Fly.io, a VPS) works the same way —
point `DB_PATH` at that persistent volume, not ephemeral storage.

## Background refresh
A single in-process scheduler (`lib/scheduler.js`) pre-warms the FRED macro cache once a day.
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
