# WS4: Thesis tracking over time

## Did
- `lib/thesis/`: `kpi.js` (KPI rule evaluation: holds → intact, near miss ≤10% → watch, clear miss → weakened, stale/missing → unknown; rules never mark "broken"), `health.js` (health score, overall status, drift, scenario expected value, catalyst hit rate; all pure), `metrics.js` (23 thesis metrics read from one cached `/api/research/:symbol` per pass, also registered into `lib/metrics/registry.js`), `store.js` (pillars, checks, versions, scenario marks, catalysts, daily health snapshots), `evaluate.js` (daily rule pass, per-symbol summary, board), `ai.js` (suggest pillars from a pitch, per-pillar AI check, suggest scenario odds; all file proposals), `index.js` (registers workflows and the `thesis_rules` job every 3h; each pillar is rule-checked at most once a day).
- `lib/schema/thesis.js`: extra columns on the WS1 thesis tables (weight, reviewDays, origin, consensus, statusBy, lastValue, check value/detail/memberId/prevStatus/moved, mark memberId/source) and new tables `thesis_catalysts`, `thesis_health`, `thesis_promises` (promises table only; extraction not built).
- Who may move a pillar: a member always (needs a sentence of evidence); a KPI rule only while the status was last set by a rule; AI only through an approved `pillar_status` proposal. "Hand back to the KPI rule" undoes a member override.
- Proposal kinds: `thesis_pillars`, `pillar_status` (also accepts engine proposals with no pillar → whole-thesis check), `scenario_update`.
- Feed: `thesis_change` on every pillar move, retire, catalyst hit/miss, odds update. Bus: `thesis_change` event (agents can trigger on it).
- Engine integration: `require("lib/thesis").recordCheck` returns a check id for the engine's `thesis_check` output.
- Hooks: `routes/research.js` thesis PUT writes `thesis_versions`; `scheduled.js` thesisCheck also runs the per-pillar AI check.
- API `routes/theses.js` (auto-mounted): board, timeline, pillar CRUD, status override, release, evaluate now, catalysts, scenario marks, AI suggest/check.
- UI: `#/theses` board (holdings × pillars, health, 6-month sparkline, drift, next catalyst, filters); Research → Thesis gets the timeline (price, health, pillar lanes with every check, edit/tripwire/catalyst marks), pillars editor, scenario odds, catalysts, evidence log, versions with line diff. CSS in `public/css/thesis.css`.
- Tests: `test/thesis.test.js` (unit + DB + mocked OpenAI), `test/thesisApi.test.js`.

## Unfinished
- Stretch: promise tracker (table only), post-mortem writer.
- No nav link to `#/theses` (index.html is WS11's): the timeline links to it ("All holdings"). WS11: please add Theses under Research.
- Screenshots were taken mid-build on a seeded DB (not saved to the shared folder, to save usage).

## Gotchas
- `createdBy` / `editedBy` are member ids (WS1 schema), not names.
- Live prices and price history in the theses routes are capped at 6s so an offline source never hangs the page.
- Health leaves out pillars that are unknown or past their review window instead of counting them as intact.

## README paragraph (for WS12)
**Thesis tracking.** Each holding's thesis is split into 3 to 6 pillars, the claims it depends on, each optionally tied to a number (for example revenue growth ≥ 20%). KPI rules re-check those numbers daily, agents check pillars against new filings and earnings briefs (a member approves any change), and members record their own calls with evidence. The Theses page shows every holding's pillars, a 0 to 100 health score and its trend, drift from the original pitch, and the next catalyst; Research → Thesis shows the whole history on one time axis with scenario odds and the probability-weighted value.
