# Agent platform contracts

Copy of plan section 3 as built by WS1 on `platform/agent-upgrade`. Names are final; to change
something, add a field, don't rename. The **"As built"** section at the end lists what
WS1 adjusted or added.


WS1 creates every table and module stub in this section in its **first commit, within the first
hour**, and gets it merged to the integration branch first. Owners named below then fill in the
real behaviour. Names here are final; if an owner needs a change, add a field, don't rename.

### 3.1 Tables (WS1 creates, in `lib/schema/platform.js`)

```sql
-- One row per agent: built-ins (existing workflows) and member-made ones.
agents (
  id INTEGER PK, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, description TEXT DEFAULT '',
  icon TEXT DEFAULT 'bot', kind TEXT CHECK (kind IN ('builtin','custom')) NOT NULL,
  workflow TEXT,                 -- builtin: existing workflow name; custom: 'engine'
  ownerId INTEGER REFERENCES members(id) ON DELETE SET NULL,
  visibility TEXT CHECK (visibility IN ('private','team')) DEFAULT 'team',
  status TEXT CHECK (status IN ('active','paused','archived','suspended')) DEFAULT 'active',
  spec TEXT NOT NULL DEFAULT '{}',  -- section 3.2
  version INTEGER NOT NULL DEFAULT 1, forkedFrom INTEGER REFERENCES agents(id),
  lastRunAt TEXT, nextRunAt TEXT, createdAt, updatedAt )
agent_versions (agentId, version, spec, editedBy, note, createdAt, PRIMARY KEY (agentId, version))
agent_follows (agentId, memberId, notify TEXT DEFAULT 'inbox', createdAt, PK (agentId, memberId))

-- agent_runs gains (addColumn): agentId, parentRunId, trigger TEXT ('schedule','event','manual',
-- 'handoff','mention','rule'), triggeredBy INTEGER (member), shared INTEGER DEFAULT 0, summary TEXT

-- Team feed: everything members and agents do that others should see.
feed_items (id, kind TEXT, actorType TEXT CHECK IN ('member','agent','system'), actorId INTEGER,
  agentId, runId, symbol, pitchId, title TEXT, body TEXT /* JSON */, visibility TEXT DEFAULT 'team',
  importance TEXT CHECK IN ('high','normal','low') DEFAULT 'normal', createdAt)
feed_comments (id, itemId, memberId, agentId, runId, text, createdAt)
feed_reactions (itemId, memberId, emoji, PK (itemId, memberId, emoji))

-- Shared memory (section 3.3).
agent_memory (id, scope TEXT CHECK IN ('fund','symbol','agent','member'), scopeKey TEXT,
  kind TEXT CHECK IN ('fact','observation','decision','preference','open_question','prediction'),
  text TEXT NOT NULL, sourceRunId, sourceUrl TEXT, asOf TEXT, confidence REAL,
  status TEXT CHECK IN ('proposed','active','superseded','retracted') DEFAULT 'active',
  supersedesId, createdByAgent, createdByMember, expiresAt, createdAt)

-- Blackboard / handoffs between agents.
agent_messages (id, fromAgentId, fromRunId, toAgentId /* null = topic broadcast */, topic TEXT,
  kind TEXT CHECK IN ('handoff','finding','request','answer'), symbol, payload TEXT /* JSON */,
  status TEXT CHECK IN ('open','claimed','done','dropped') DEFAULT 'open', claimedByRunId, createdAt)

-- Thesis over time (WS4 fills in).
thesis_pillars (id, symbol, pitchId, ord, text, kpi TEXT /* JSON rule, section 3.5 */,
  status TEXT CHECK IN ('intact','watch','weakened','broken','unknown') DEFAULT 'unknown',
  createdBy, createdAt, updatedAt, retiredAt)
thesis_checks (id, symbol, pillarId /* null = whole thesis */, runId, status, score REAL,
  evidence TEXT /* JSON [{text, source_url, as_of}] */, method TEXT CHECK IN ('rule','ai','member'),
  createdAt)
thesis_versions (id, symbol, text, targetPrice, editedBy, createdAt)   -- written on every thesis save
scenario_marks (id, symbol, runId, bullProb, baseProb, bearProb, note, createdAt) -- probabilities over time
```

Indexes on `(scope, scopeKey, status)`, `(symbol, createdAt)`, `(agentId, createdAt)`,
`(topic, status)`. WS1 also seeds one `agents` row per existing workflow (kind `builtin`, owner
null, visibility team) and back-fills `agent_runs.agentId` by workflow name.

### 3.2 Agent spec (JSON in `agents.spec`; WS2 owns validation in `lib/agents/spec.js`)

```jsonc
{
  "v": 1,
  "scope": { "universe": "holdings" | "watchlist" | "symbols" | "fund", "symbols": ["NVDA"] },
  "triggers": [
    { "type": "schedule", "cron": "30 8 * * 1-5", "tz": "America/New_York" },   // or "preset": "premarket"|"close"|"weekly_fri"
    { "type": "event", "on": "filing", "forms": ["8-K","10-Q","10-K"], "items": ["2.02"] },
    { "type": "event", "on": "price_move", "sigma": 2 },          // vol-scaled move
    { "type": "event", "on": "earnings_soon", "days": 7 },
    { "type": "event", "on": "insider_buy" | "tripwire" | "news_high" | "thirteenf" | "ips_breach" | "pitch_status" | "estimate_revision" },
    { "type": "handoff", "topic": "thesis" },                     // another agent posted to this topic
    { "type": "manual" }
  ],
  "conditions": [ { "metric": "quote.changePct", "op": "<", "value": -5 } ],   // all must pass; free, no model
  "steps": [
    { "id": "d1", "type": "tool", "tool": "get_research_overview", "args": { "symbol": "$symbol" } },
    { "id": "r1", "type": "rule", "if": { "metric": "d1.pe", "op": ">", "value": 40 }, "else": "stop" },
    { "id": "a1", "type": "ai", "tier": "cheap" | "mid" | "top", "instructions": "…",
      "tools": ["get_filings", "…"], "maxSteps": 6, "output": "brief" | "verdict" | "score" | "list" | "scenario",
      "recall": true }
  ],
  "outputs": [
    { "type": "feed", "when": "always" | "changed" | "verdict_not:intact" },
    { "type": "notify", "who": "owner" | "followers" | "team", "tier": "push" | "inbox" | "digest", "when": "…" },
    { "type": "memory", "scope": "symbol", "kind": "observation" },
    { "type": "thesis_check" },                         // writes thesis_checks rows (WS4)
    { "type": "proposal", "kind": "thesis_status" | "tripwire" | "watchlist_add" | "pillar_status" },
    { "type": "handoff", "topic": "thesis", "to": "agent-slug?" }
  ],
  "budget": { "perRunUsd": 0.10, "perMonthUsd": 3 },
  "runAs": "owner"          // the triggering member for manual/mention runs
}
```

Rules: an agent with no `ai` step costs nothing and needs no AI access to *run*, but creating any
agent requires AI access (keeps it with the same members). `$symbol`, `$event.*`, `$prev.*`
(last run's output) and step ids are the only variables. Conditions/rule ops: `< <= > >= == !=
crosses_above crosses_below changed pct_change_gt in`. Max 12 steps, max 3 `ai` steps.

### 3.3 Memory API (`lib/agents/memory.js`; WS1 stub, WS5 owns)

```js
remember({ scope, scopeKey, kind, text, sourceRunId, sourceUrl, asOf, confidence, agentId, memberId }) -> id
recall({ symbol, agentId, memberId, kinds, limit = 20, query }) -> [{ id, scope, kind, text, sourceUrl, asOf, createdAt, by }]
supersede(oldId, newFields) -> id ;  retract(id, memberId)
dossier(symbol) -> { facts, observations, decisions, openQuestions, predictions, lastUpdated }
```

`RunContext` gains `ctx.recall(opts)` and `ctx.remember(opts)` (WS1 adds the two passthrough
methods; WS5 makes recall feed the model prompt as `<memory>` blocks marked untrusted-but-internal).

### 3.4 Feed, bus, jobs (`lib/platform/`; WS1 creates working minimal versions)

```js
// lib/platform/feed.js  (WS1 minimal; WS7 extends in lib/feed/*)
post({ kind, actorType, actorId, agentId, runId, symbol, pitchId, title, body, importance }) -> id   // also publishes SSE 'feed'
// lib/platform/bus.js   (WS1; WS2 + WS5 use)
emit(type, payload)          // app events: 'filing','price_move','tripwire','pitch_status','agent_output',…
on(type, handler)            // in-process subscribers (the trigger matcher)
handoff({ fromAgentId, fromRunId, toAgentId, topic, kind, symbol, payload }) -> id  // writes agent_messages + emit('handoff')
// lib/platform/jobs.js  (WS1; called by scheduler.js once)
register(name, { everyMs, fn })      // noOverlap built in; scheduler starts all registered jobs
// lib/platform/cron.js  (WS1)
nextRun(cronOrPreset, tz, from = new Date()) -> Date      // 5-field cron subset + presets, market-holiday aware via lib/calendar.js
```

Feed `kind` values (append-only list in `lib/platform/feed.js`): `agent_brief`, `agent_alert`,
`thesis_change`, `memory_added`, `handoff`, `ask_shared`, `pitch_opened`, `vote_closed`,
`trade_executed`, `tripwire_tripped`, `note_shared`, `agent_created`, `agent_edited`, `digest`.

### 3.5 Thesis KPI rule (`thesis_pillars.kpi`; WS4 owns evaluation)

```jsonc
{ "metric": "fundamentals.revenueGrowthYoY", "op": ">=", "value": 0.20, "window": "ttm",
  "source": "sec" | "yahoo" | "estimates" | "price" | "custom", "staleAfterDays": 120 }
```
Metric names come from a registry `lib/metrics/registry.js` (WS2 creates; WS4 and WS10 add
entries) mapping a dotted name to `{ label, unit, fetch(symbol) -> { value, asOf, sourceUrl } }`.
This one registry powers agent conditions, thesis KPIs and chart overlays.

### 3.6 Front-end registries (WS1)

- `public/routes.d/*.js`: each file `export default { pattern: "feed/:tab?", load: () => import("../views/feed.js"), section: "agents" }`. `public/router.js` loads them all (a static list in `public/routes.d/index.js` that each WS appends one line to; append-only).
- `public/views/agents/<tab>.js`: each exports `{ key, label, order, render(el, ctx) }`. WS11's Agents shell lists the files in `public/views/agents/index.js` (append-only) and skips any that fail to import.
- `public/css/<ws>.css`: linked from `public/css/index.css` (WS1 creates; append-only `@import`).
- Shared UI from WS11 (available after wave 2, guard imports until then): `public/ui/agentChip.js` (agent avatar + name + status dot), `public/ui/runCard.js`, `public/ui/feedItem.js`.



## As built (WS1, 2026-11-19)

### Schema (3.1)
- `lib/schema/index.js` runs every other `lib/schema/*.js` (platform.js first, then file-name
  order). Each file exports `function (db, { addColumn })`, must be idempotent, and must **not**
  `require("../../db")` (db.js is still loading). Add your tables in `lib/schema/<ws>.js`.
- All columns in 3.1 exist with the stated CHECKs. Timestamps are SQLite `datetime('now')` text
  (`YYYY-MM-DD HH:MM:SS`, UTC) like the rest of the app. JSON columns default to `'{}'`/`'[]'`.
- Additions: `feed_reactions.createdAt`; `thesis_checks.status` uses the pillar status values.
- `agent_runs.trigger` is an SQLite keyword but works unquoted.
- Built-in agents: one row per workflow, `slug` = workflow with `_` → `-` (e.g. `filing-flash`),
  `spec` = `{"v":1}`. The list (16, including ask_pif and the desk workflows) is `BUILTINS` in
  `lib/schema/platform.js`. Old runs are back-filled to their agent by workflow.

### Runs (`lib/agents/runs.js`)
- `runs.run({ workflow, eventId, memberId, symbol, agentId, parentRunId, trigger, triggeredBy }, fn)`.
  `agentId` defaults to the workflow's built-in agent (`runs.agentIdFor(workflow)`); `trigger`
  defaults to `event` (eventId), `manual` (memberId) or `schedule`; `triggeredBy` defaults to memberId.
- `RunContext` has `agentId, parentRunId, trigger, triggeredBy, symbol, workflow`, plus
  `ctx.recall(opts)` (defaults symbol/agentId/memberId to the run's) and `ctx.remember(opts)`
  (stamps `sourceRunId` and `agentId`).
- On success: `agent_runs.summary` is set from `output.summary|headline|verdict|answer|title`;
  `agents.lastRunAt` updated; `bus.emit('agent_output', { runId, agentId, workflow, symbol, memberId, parentRunId, trigger, output })`;
  built-in agents (not `runs.PRIVATE_WORKFLOWS` = ask_pif, compare, what_if, meeting_prep, ideas,
  pitch_primer, and not weekly_memo) post `feed.post({ kind: 'agent_brief' })`. **Custom agents
  never auto-post**: the engine (WS2) posts through the spec's `outputs`.

### Feed, bus, jobs, cron (3.4)
- `feed.post(...) -> id` also publishes SSE `feed` (members only, team visibility) and
  `bus.emit('feed', item)`. Extra: `feed.get(id)`, `feed.list({ limit, before, symbol, agentId, kind, memberId })`.
  Unknown kinds throw; add to `KINDS` (append-only).
- `bus.emit(type, payload, { sync })` runs handlers after the emitter returns (or awaits them with
  `sync: true`); `bus.on` returns an unsubscribe fn; `'*'` receives every event; a failing
  handler is logged, never thrown. Extras: `bus.recent({ type, limit })` (in-memory last 200),
  `bus.claim(messageId, runId) -> bool` (first claimer wins), `bus.HANDOFF_KINDS`.
- `jobs.register(name, { everyMs, fn, delayMs = 0 })`, `jobs.runOnce(name)`, `jobs.status()`.
  `scheduler.start()` calls `jobs.start()`; tests can call `runOnce` without starting timers.
- `cron.nextRun(cronOrPreset, tz = 'America/New_York', from = new Date(), { marketDays })` →
  Date or null. Presets: `premarket` 8:30, `open` 9:45, `midday` 12:00, `close` 16:15,
  `evening` 19:00 (trading days only), `weekly_mon` 8:00, `weekly_fri` 17:00, `daily` 7:00 (ET).
  DST: a non-existent wall time runs right after the jump (02:30 → 03:30); a repeated one runs
  once (first). Also `cron.describe`, `cron.parse`, `cron.PRESETS`.
- Market holidays: `lib/calendar.js` now exports `marketHolidays(year)` (Set of YYYY-MM-DD) and
  `isTradingDay(date)`.

### Memory (3.3)
- All five functions exist with plain SQL (newest first, `query` = substring match). `recall`
  returns fund-scoped memories plus the symbol/agent/member scopes asked for, active and
  unexpired only. `by` = `{ type: 'agent'|'member', id, name }`. Scope keys: symbol uppercased,
  agent/member keys are the id as text.

### HTTP
- `routes/*.js` with `module.exports.autoMount = true` is mounted under `/api` automatically.
- `routes/platform.js` (signed-in): `GET /api/platform/health`, `GET /api/platform/feed`,
  `GET /api/platform/agents`. WS7 may build its richer feed API in its own router.

### Front end (3.6)
- `public/routes.d/index.js` exports `ROUTE_FILES` (append file names). Each file's default export
  is an entry or an array of entries `{ pattern, load, section }`; `?` marks optional trailing
  segments. Routes already in `public/app.js` win on a clash (e.g. `/agents/:tab` already exists:
  use the Agents tab registry for Agents tabs, not routes.d).
- `public/views/agents/index.js` exports `TAB_FILES` (append file names) and `loadTabs()`.
- `public/css/index.css` is linked from `index.html`; append `@import url("<ws>.css");`.
