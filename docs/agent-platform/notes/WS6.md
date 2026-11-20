# WS6: Agent teams (committee, deep research, portfolio review)

## Did
- `lib/agents/orchestrator.js`: `startTeam()` runs a parent run that spawns worker runs in parallel (max 4) under one team budget, with a reserve kept for the synthesis step. Workers are normal `agent_runs` rows with `parentRunId`; `team_runs` / `team_children` (`lib/schema/teams.js`) hold the tree. `getTree()`, `listRuns()`.
- `lib/agents/workflows/committee.js`: Bull, Bear, Risk & policy, Valuation memos → one rebuttal round → PM synthesis (agreements, disagreements with what would settle them, lean + confidence). Pitch lean is yes/no/abstain; holding lean is intact/watch/weakened/broken. Notifies the pitch author.
- `lib/agents/workflows/deepResearch.js`: planner (cheap) → 4-6 area workers (mid, web search) → dossier. Sourced findings and open questions go to shared memory.
- `lib/agents/workflows/portfolioReview.js`: cheap scorecard per holding (max 30) → top-tier "five things for Monday". Weekly job Sunday 4 PM ET via `jobs.register`.
- `lib/agents/teams.js`: registry, built-in `agents` rows (`committee`, `deep-research`, `portfolio-review`), limits, bus wiring (`pitch_status: voting` → committee once a day per pitch; `handoff` topics `committee` / `deep_research`).
- `routes/agentTeams.js` (auto-mounted): `GET /api/agents/teams`, `GET /api/agents/teams/runs[/:id]`, `POST /api/agents/teams/:team/runs` (202 + runId, page polls), `GET /api/pitches/:id/committee`.
- UI: Agents → Teams tab (`public/views/agents/teams.js`), run page `#/agents/teams/:id` (`public/views/teamRun.js`, `routes.d/teams.js`), committee panel on the pitch page (`public/views/pitch/committee.js`, one guarded line in `pitch.js`), shared rendering in `public/views/teamsShared.js`, `public/css/teams.css`.
- Tests: `test/agentTeams.test.js` (9).

## Decisions to confirm (Will)
- Team runs are billed to the fund's monthly AI budget, not the member's daily cap (a committee costs more than the $0.50 daily cap). Limited instead: 3 manual runs per member per day, 12 per day fund-wide, 2 at once. Env: `TEAM_RUNS_PER_MEMBER_DAY`, `TEAM_RUNS_PER_DAY`, `TEAM_RUNS_CONCURRENT`.
- Per-run caps: committee $0.75, deep research $1.00, review $0.60 (`TEAM_*_BUDGET_USD`). Tiers: `TEAM_WORKER_TIER`, `TEAM_SYNTH_TIER`, `TEAM_REVIEW_*_TIER`.
- Auto committee when a pitch opens for a vote is on; `TEAM_COMMITTEE_ON_VOTE=false` turns it off. The lean is shown during blind voting; hide it if that anchors votes.
- Team runs are visible to every member with AI access.

## Unfinished
- Stretch: devil's advocate on any feed item; red team using committee rebuttals.
- Teams tab appears once WS11's Agents shell reads `public/views/agents/index.js`; until then the run page and pitch panel work, the tab route falls back to Briefs.
- Checked with a fake OpenAI only; no live model run.

## Gotchas
- Workers deliberately get no `agentId`, so `runs.run` doesn't post one feed item per worker; only the parent (built-in agent) posts.
- The team budget is checked before each model turn, so a run can overshoot by the turns already in flight.
- A server restart marks running team runs failed (existing `markInterrupted`).

## README paragraph
**Agent teams.** Under Agents → Teams, members can convene an investment committee (Bull, Bear, Risk and Valuation agents debate a pitch or holding, rebut each other, and a PM agent sums up and says how the committee leans), run deep research on a new name (parallel analyst agents and a written dossier saved to shared memory), or run the weekly portfolio review (five things to discuss at Monday's meeting, also automatic every Sunday). Every worker is its own inspectable run; each team run has a hard cost cap and comes out of the fund's AI budget.
