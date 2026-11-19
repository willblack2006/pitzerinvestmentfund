## 2026-11-19 · WS1 platform foundation (Claude Code, thread "Build agent platform foundation")

**Did**
- Cut the integration branch `platform/agent-upgrade` from `main` @ db3b130.
- `lib/schema/{index,platform}.js`: every table in plan 3.1, the six new `agent_runs` columns,
  indexes, 16 built-in agents (one per workflow) and the `agentId` back-fill. `db.js` gained one line.
- `lib/platform/{cron,jobs,bus,feed}.js` working versions; `lib/calendar.js` gained NYSE
  `marketHolidays`/`isTradingDay`; `scheduler.start()` starts registered jobs.
- `lib/agents/memory.js` (plain SQL remember/recall/supersede/retract/dossier).
- `lib/agents/runs.js`: agentId/parentRunId/trigger/triggeredBy, ctx.recall/remember, summary,
  `bus.emit('agent_output')` and `agent_brief` feed posts for built-in, non-private workflows.
- `server.js` auto-mounts routers flagged `autoMount`; `routes/platform.js` (health, feed, agents).
- Front-end registries: `public/routes.d/`, `public/views/agents/index.js`, `public/css/index.css`.
- `docs/agent-platform/CONTRACTS.md` (section 3 + "as built"), `test/platform.test.js` (22 tests).

**Unfinished**
- Bus events are in memory only (`bus.recent`); no persisted replay.
- No producers emit app events yet besides `agent_output`, `handoff` and `feed`: WS2 wires
  filing/price_move/tripwire etc. into `bus.emit` where they happen.

**Gotchas**
- Schema files must not require db.js (circular); they get `db` as an argument.
- Built-in agent slugs use hyphens, workflows use underscores.
- Custom agents don't auto-post to the feed from `runs.run`; the engine posts per spec outputs.
- Existing `/agents/:tab` route in app.js wins over any routes.d `agents/...` pattern.

**README paragraph for WS12**
> Agent platform foundation: every agent (built-in workflows and member-made ones) is a row in
> `agents`; runs record which agent, what triggered them and any parent run. Agents share a
> memory (`agent_memory`), hand work to each other through `agent_messages`, and post what they
> find to a team feed (`feed_items`, live over SSE). Background jobs register with
> `lib/platform/jobs.js`, schedules use `lib/platform/cron.js` (NYSE holiday aware). New tables go
> in `lib/schema/`, new API routers set `autoMount`, new pages add a file in `public/routes.d/`.
> Contracts: `docs/agent-platform/CONTRACTS.md`.
