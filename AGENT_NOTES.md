# Agent handoff log

Running log for anyone picking up work in this repo (either Claude account, or Codex). Add an entry before you finish a session with anything non-trivial done. Newest entry at the top.

Format:
```
## YYYY-MM-DD — tool/account
- Did: ...
- In progress / unfinished: ...
- Gotchas: ...
```

## 2026-10-08 — Claude (Dividends tab + cash on Holdings)
- Did: Portfolio → Dividends page (`public/views/dividends.js`, `routes/dividends.js`, `lib/dividends.js`, new `dividends` table). Exact tracking from TRACKING_START = 2026-10-08 (the Schwab reconciliation): each ex-date logs shares × declared amount as "Owed"; "Mark received" records a dividend transaction (credits cash + the holding's divIncome); "Not owed" for shares sold before the ex-date. Deleting the transaction puts the dividend back to Owed. Projected 12-month income / yield / yield on cost from Yahoo's declared rate (or trailing 12 months for ETFs). Scheduler logs new ex-dates each tick. Holdings summary now shows Total portfolio (invested + cash), Invested, Cash, and projected dividends; "Top 5 = …% of invested" (was "of fund", which excluded cash).
- Not done: past dividends before 10/8 (needs Schwab history; Will has no export access). If someone sends a Schwab History CSV, import it as received dividends WITHOUT moving cash (Schwab cash already includes them).

## 2026-10-08 — Claude (Schwab holdings sync + live AI recap)
- Did: replaced all 32 positions' shares / avg cost / total cost with Will's Schwab statement as of 10/8 (transcribed from a screenshot; cost basis sums to Schwab's $72,461.29 minus LumiraDx). Set cash to $43,236.20. Dividend income reset to $0 on all positions (the first upload's figures came from the same inaccurate source; Schwab cash already includes any dividends received). LumiraDx (CUSIP G5709L109, 1,070 sh, $0 value, $192.49 cost) left out on Will's choice. No transactions recorded for the sells (prices/dates unknown). Backup of the DB before the change: `data/backups/pif-2026-10-08-before-schwab-update.db`.
- AI recap now live with OPENAI_API_KEY. Default model changed to gpt-6-luna after a same-input comparison (nano cited unrelated headlines and speculated; luna was accurate and cheapest, ~$0.0007/recap).

## 2026-10-08 — Claude (Today page redesign: morning briefing)
- Did: rebuilt `public/views/today.js` as a briefing: header with greeting, market clock and edition picker; "30-second read" (plain sentences from the numbers, `briefingLines` in lib/marketNews.js, stored per edition); 6 index tiles with 5-day sparklines (15-min bars); photo lead story + card grid (photos preferred, text cards otherwise) + list; portfolio day panel with company logos (Finnhub profile2, cached 30 days); "On deck" with Fed countdown. On phones the portfolio and On deck move above the stories (CSS `order` with `display: contents`).
- Images: Finnhub sends outlet logos for Reuters/Bloomberg and Yahoo's logo for many company stories; `realImage()` drops those. Real photos are mostly CNBC (~20 of 100), resized via CNBC's `w`/`h` params.
- Found, not fixed: `.sr-only` text inside sideways-scrolling containers escapes them (no positioned ancestor) and makes the whole page scroll sideways on phones. Confirmed on Research → Street (664px at a 375px screen; 375px with `.table-scroll, .table-wrap, .subtabs, .tabnav { position: relative; }`). Fixed only for the Today chips row.

## 2026-10-08 — Claude (Holdings time frames)
- Did: Holdings page has a "Gains for 1D / 5D / 1M / 3M / YTD / 1Y / All" selector (remembered per browser). Gain $, Gain %, the gain card and winners/losers follow it. "All" = vs cost basis (unchanged); 1D = live quote change; the rest = live price vs the close before the frame, at today's share counts, price only (no dividends). One request, `GET /api/portfolio/period-bases`, returns every frame's base close for every holding from the cached 2y daily charts (same cache as the Research risk tab). Pure date logic in `lib/periods.js` with unit tests. Nothing committed.
- Gotchas: there are no recorded transactions, so frames can't reflect buys/sells inside the period; they show how today's holdings moved.

## 2026-10-08 — Claude (Today news page)
- Did: new top-level **Today** page (`#/today`). The scheduler saves 3 editions each weekday (premarket ~8:00, midday ~12:30, postmarket ~4:30 PM ET) into the new `news_editions` table: filtered Finnhub wire headlines, holdings news (only items that actually name the company), market numbers, and an AI recap from Claude Haiku 5.5 (`marketRecap` in `lib/sources/claude.js`, low effort, JSON schema, numbered source citations). Page toggles editions and goes back 3 weekdays; side column is live (indices, sectors, movers, Fed, next 7 days). Fed FOMC calendar + press RSS come from `lib/sources/fed.js`, which also fills FOMC dates on the Calendar page now. Pure logic + tests in `lib/marketNews.js`. Nothing committed.
- Recap provider: OpenAI if `OPENAI_API_KEY` is set (`lib/sources/openai.js`, Responses API + strict json_schema, default `gpt-5-nano`, override with `OPENAI_RECAP_MODEL` / `OPENAI_RECAP_EFFORT`), else Claude Haiku 5.5 if `ANTHROPIC_API_KEY` is set, else "AI recap: coming soon". Will plans to add an OpenAI key.
- Unfinished: neither provider has been called for real (no keys locally). Both request shapes were checked by intercepting fetch; a hand-written simulated recap was run through the real parse/save/render path on a DB copy (not the real DB). Each real run logs `[today] <date> <slot> recap (<model>): N in / N out tokens, ~$cost`.
- Gotchas: a slot is only captured inside its own window, so if the server is down at 8 AM, that premarket edition is "missed", not back-filled at noon. Capturing an edition makes ~32 Finnhub company-news calls (~23s cold, background only). Holding earnings on the page wait at most 4s (Finnhub limit is shared with background jobs).

## 2026-10-07 — Claude (glossary terms, Market tab groups, 13F name search, cold-cache timing)
- Did: `term()` glossary links on Valuation, Street, Performance and the Factors column headers (new entries in `public/glossary.js`; `sortHeader` gained an `after` option so a "?" can sit next to a sort button). Market sub-tabs grouped as Backdrop / Signals / Tools (`subTabs` accepts an optional third `group` field). 13F managers can be found by name: `GET /api/13f/search?q=` uses EDGAR full-text search limited to 13F-HR filings, filtered to filers whose own name matches (`parseManagerSearch` in `lib/thirteenF.js`, unit + live tests). Nothing committed.
- Timing (cold `api_cache`, copy of the DB, scheduler off, 32 holdings, empty watchlist): Factors 2.8s, Base rate 0.6–1.8s, Backtest 0.8s, Index radar 2.5s, Forced sellers 2.2s. None moved to the background job.
- Unfinished / found in review: Factors table's initial sort is a no-op (`dir: "desc"` string; sortRows expects 1/-1) and `bindSort` is re-attached on every render. "crowding" (attention-spike) alerts and Holdings badges link to the research Overview, which has no attention panel (`TAB` in `public/views/alerts.js` has no `crowding` key). DCF upside uses green/red `signed()` while the sensitivity table is deliberately neutral.
- Gotchas: static files are cached 10 min (`maxAge`), so after editing `public/` a reload in the same browser can show old JS; use a new port or hard reload. Many cold server starts in a row get `www.sec.gov` to return 429 for a while, which fails 3 live research tests until it clears.

## 2026-10-07 — Claude (multi-agent setup)
- Did: added `CLAUDE.md`, `AGENTS.md`, this file. No git changes — repo already had ~45 uncommitted files before this.
- In progress / unfinished: those ~45 pre-existing uncommitted changes (congressTrades, govContracts, paperTrading features and related test/public/route files) are still uncommitted — review and commit before heavy multi-agent use. `codex-output/` folder mentioned in CLAUDE.md/AGENTS.md was not created — create it when Codex first needs it.
- Gotchas: repo has both `render.yaml` (live deploy, Render) and a leftover `.vercel/` folder (not current) — don't treat `.vercel/` as live.
