## 2026-11-19 · WS2 agent engine: triggers, rules, steps, outputs (Claude Code, thread "Build agent engine and triggers")

**Did**
- `lib/agents/spec.js`: validates and normalizes the plan 3.2 spec. Errors and warnings are
  `{path, message}` (`steps[1]`, `triggers[0]`, `scope`, `budget`...) so the builder can point at
  the field; typo'd metrics get "Did you mean". Limits: 12 steps, 3 AI steps, 8 triggers, 10
  conditions, 8 outputs, 50 tickers. Cost estimate per run (AI turns × tier price, plus web
  searches), typical run, runs per month from the schedule, and `describe(spec)` in plain English.
  Schedule presets are the ones in `lib/platform/cron.js`. `get_my_notes` is blocked in agent specs
  (private notes must never reach the feed or memory).
- `lib/metrics/registry.js`: 58 metrics in groups quote, price, valuation, fundamentals, street,
  ownership, fund, thesis, news, risk. Each returns `{ value, asOf, sourceUrl }`; the 15 price
  metrics also have `history()` for the dry run. `register()` is how WS4/WS10 add theirs.
  `createLoaders()` memoizes Yahoo quote summary, chart, allocation etc. per evaluation.
- `lib/agents/conditions.js`: the free checks (`< <= > >= == != in changed crosses_above
  crosses_below pct_change_gt`) on registry metrics, step results (`d1.pe`), `$prev.*`, `$event.*`.
- `lib/agents/engine.js` `runAgent(agent, {symbol, trigger, event, triggeredBy, parentRunId, depth})`:
  conditions first (a miss records no run), then tool / rule / ai steps inside `runs.run`, then
  outputs (feed, notify, memory, thesis_check, proposal, handoff) with `when` rules (always, changed,
  nonempty, verdict:x, verdict_not:x, score_gt:n, score_lt:n). AI steps get the agent's tool
  allowlist and tier, earlier step data wrapped as untrusted, the previous run's result, and
  recalled memory. Guardrails: per-run and per-month agent budget (on top of fund/member caps),
  max runs/day (default 24), quiet hours, auto-pause after 3 failed runs in a row (feed item +
  owner notification), suspended/archived/paused honoured, handoff depth 3, no self-trigger.
  New proposal kinds `watchlist_add` and `tripwire` (review-by date), applied only on approval.
- `lib/agents/triggers.js`: one-minute schedule job (`agent-schedules`, uses `nextRunAt`, claims
  the slot so it never runs twice), 15-minute `agent-market-events` job (price_move from the
  vol-scaled move, earnings_soon, ips_breach; only computed for symbols some agent listens to),
  bus listeners for every event type plus handoffs, and a one-at-a-time run queue. Every fire is a
  row in `agent_trigger_log` (dedupe across restarts, and the builder's "fired" history).
- New event producers (one guarded `bus.emit` line each): filing (`lib/agents/index.js`),
  tripwire (`lib/tripwires.js`), pitch_status (`routes/pitches.js`), insider_buy and
  estimate_revision (`lib/signals.js`), news_high (`routes/newsTriage.js`), thirteenf
  (`lib/thirteenFLive.js`).
- `lib/agents/dryRun.js`: replays schedules, price moves, stored filings, tripwires and pitch
  history over 30/90 days with conditions evaluated as of each date. No model calls.
- `routes/agentEngine.js` (auto-mounted): CRUD, versions/restore, fork (starts private and paused),
  pause/resume, admin suspend/unsuspend, run now, dry run (saved and unsaved), validate, estimate,
  templates, follow/unfollow, and `GET /api/metrics`. Shapes agreed with WS3.
- `lib/schema/engine.js`: `agent_trigger_log`, `agent_metric_state` (baseline for "changed" and
  "crosses" even when a condition stopped the run).
- 12 templates in `lib/agents/templates/` (8 AI, 4 rule-only/free).
- `lib/notify.js` TYPES: `agentRun`.
- `test/agentEngine.test.js`: 15 tests.

**Unfinished**
- Stretch not done: cross-symbol "rank the watchlist" agents, digest outputs that batch a day.
- Rule steps aren't replayed by the dry run (they read live tool data); it says so in `notes`.
- `earnings_soon`, `news_high`, `insider_buy`, `thirteenf` can't be backtested (no stored history).
- Manual "run now" waits for the run to finish (Ask PIF does the same); a long AI agent holds
  the request up to its maxSteps.

**Gotchas**
- Verified with a fake OpenAI and stubbed Yahoo only; no live data in the build sandbox.
- `routes/agentEngine.js` sorts before `routes/platform.js`, so its `GET /platform/agents`
  (richer shape) wins over WS1's.
- The thesis_check output calls WS4's `lib/thesis` `recordCheck`/`record` when present, else
  writes `thesis_checks` directly.
- Set `DISABLE_AGENT_TRIGGERS=true` to keep the schedule and market-event jobs off.

**README paragraph for WS12**
> Member-made agents: anyone with AI access can build an agent from a template or from scratch:
> what it watches (holdings, watchlist, tickers or the whole fund), when it wakes up (a schedule,
> a filing, a big move, earnings coming, a tripwire, another agent's finding), free rule checks on
> about 60 metrics, optional AI steps with a chosen set of read-only tools, and where results go
> (team feed, notifications, shared memory, thesis checks, proposals for a member to approve,
> handoffs to other agents). Each agent has its own budget, a cost estimate before saving, and a
> dry run that shows when it would have fired over the last 30 or 90 days. Agents can never trade.
