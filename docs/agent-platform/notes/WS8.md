## 2026-11-20, Claude (WS8: observability, evals and cost control)
- Did:
  - Run steps now record `ms`, `costUsd` and `tier` (model) and `ms`, a 600-char `preview`, `as_of` (tool) in `lib/agents/runs.js`. Older runs still trace: model time is inferred from step gaps (marked estimated) and cost priced from tokens.
  - `lib/agents/metrics.js`: `trace(run)` (waterfall spans, totals, verification, child runs via `parentRunId`), `agentStats(key)`, `agentsOverview()`, `fundSpend()` (by agent, member, tier, day; month-end projection at the last 7 days' pace; top 10 runs; level ok/pace/warn/over at 80%). Agent keys are `a<agentId>` or `w<workflow>`; a built-in agent's key also counts its workflow's runs from before `agentId` existed.
  - `lib/agents/health.js`: failure streak (3 in a row), agent monthly budget (`spec.budget.perMonthUsd`), fund cap at 80% and 100%, scheduled agent past `nextRunAt` by 2h. Posts a feed `agent_alert` and an `agentHealth` inbox notification to owner and admins, once per day (budget: per month). Job `agent_health` every 15 min.
  - `routes/agentMetrics.js` (auto-mounted): `GET /agents/runs/:id/trace`, `/agents/stats`, `/agents/stats/:key`, `/agents/health`, `/admin/ai-spend` (admins), `GET /agents/feedback-reasons`, `POST /agents/runs/:id/reasons`.
  - `lib/schema/observability.js`: `agent_health_alerts`, `agent_eval_results`, `agent_feedback.reasons`.
  - Front end: `#/agents/trace/:id` (`public/views/agents/trace.js`), Stats tab + `#/agents/stats/:key` (`stats.js`), `#/ai-spend` (`public/views/aiSpend.js`), reason chips under every Useful/Not useful/Wrong group (`public/feedbackReasons.js`, loaded from `public/routes.d/observability.js`), `public/css/trace.css`.
  - Evals: `eval/agents/*.json` golden cases (filing_flash x2, ask_pif x1), `lib/agents/evalAgents.js`, `npm run eval:agents` (`--plan-only`, `--fake`, `--save`, `--record <runId>`). Runs on a temp copy of the DB; `--save` writes results (shown on the agent's stats page) and one `eval_agents` cost row to the real DB. Nightly job only with `AGENT_EVALS_NIGHTLY=1` (around 9:00 UTC).
- Unfinished:
  - `#/agents/runs/:id` still opens the old run view in `public/views/agents.js` (WS11's file). To make the trace the run page, WS11 or the integration pass should change `mountRun` to `return (await import("./agents/trace.js")).mount(container, params)`. `#/agents/trace/:id` works now.
  - No nav link to `#/ai-spend` yet (index.html is WS11's); link it from Settings or the admin menu.
  - Stretch not done: A/B compare of two agent versions. "Cost per useful run" is on the stats page.
  - No eval cases yet for WS2 engine templates; add `eval/agents/<slug>.json` with `"workflow": "engine"` once the engine is wrapped as a workflow.
- Gotchas:
  - Live evals cost real money; `--fake` is free and is what `test/agentObservability.test.js` runs.
  - The `personal price alerts` test failed once in a full `npm test` run and passes alone (flaky, not WS8).

README paragraph for WS12:
> **Agent observability.** Every agent run has a trace (Agents → a run → "How it was made", or `#/agents/trace/<id>`): each model turn and tool call on a timeline with its time, tokens, cost, input and a preview of its output, plus the run's quote and number checks. Agents → Stats shows each agent's runs, success rate, typical cost and time, and member ratings (with reasons). Admins see the fund's AI spend at `#/ai-spend`, with a month-end projection and a red banner at 80% of the cap; agents that keep failing, run out of budget or stop firing alert their owner and the admins. `npm run eval:agents` replays fixed golden cases (`eval/agents/`) to check a prompt or model change.
