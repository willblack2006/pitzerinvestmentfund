## 2026-11-20 · WS7 team feed and shared agents (Claude Code)

**Did**
- `#/feed` (filters: all, holdings, followed agents, mine, members, agents, important; ticker and member pickers), `#/feed/t/:symbol` ticker room, `#/feed/item/:id` single thread. Day separators, "Seen up to here" marker, unread dots, pinned items, live insertion (a "N new posts" button when scrolled down), "Running now" chips.
- Comments and reactions on every item. `@Member` notifies (type `mention`, only if they can see the item). `@agent-slug` (or `@pif`) runs that agent with the item and thread as untrusted context, billed to the commenter (`trigger: 'mention'`), and posts its answer in the thread. Custom agents go through WS2's `engine.runAgent`; built-ins and `@pif` answer through Ask PIF (`ask()` gained an optional `context`). At most 2 agents per comment; members without AI access get a notice.
- Share to feed: `POST/DELETE /api/agents/runs/:id/share` (Ask PIF, desk, primer, red team) sets `agent_runs.shared` and posts `ask_shared`. Teammates can open the shared run (`routes/agents.js` run/feedback checks allow shared runs) and "Ask a follow-up" (`POST /api/feed/:id/follow-up`) as their own private run with `parentRunId`.
- Agent profiles `#/agents/a/:slug` (owner, triggers in plain English, scope, outputs, stats, acceptance, month cost, followers, recent runs, memory written, versions, latest posts, who else is viewing) with Follow + notify level, Run now, Ask, Duplicate, Edit, Pause/Resume, Suspend (WS2 endpoints). Team agents tab (`public/views/agents/directory.js`): search, sort by followed/useful/recent/name, mine only.
- Following: levels `all`, `inbox` (default: important posts right away, rest in the evening digest), `digest`, `off` (stored as `none` so WS2's engine skips it; `push`/`none` from WS2's API are read as `all`/`off`). Job `feed_follow_notify` (1 min, one folded notification per agent per pass) and `feed_follow_digest` (weekdays 22:00 UTC). New notify type `agentFollowed`.
- Activity posts: pitch opened, vote closed/executed, trades (in `lib/events.js` fundChanged), tripwire tripped, note shared with the club. `lib/feed/activity.js` also exports `agentCreated/agentEdited` (WS2 already posts `agent_created` itself, so these are unused for now).
- Privacy: visitors get 401; private agents' posts show only to owner and admins; live events for private items are targeted; the client re-fetches on the `feed` SSE event instead of trusting its payload.
- Files: `lib/feed/*`, `lib/schema/feed.js` (feed_reads, feed_cursors, feed_pins, comment columns), `routes/feed.js`, `routes/agentProfiles.js`, `public/feed/feedUi.js`, `public/views/feed.js`, `public/views/agents/{feed,directory,profile}.js`, `public/css/feed.css`, `public/routes.d/feed.js`; one-liners in `routes/pitches.js`, `routes/notes.js`, `lib/tripwires.js`, `lib/events.js`, `lib/notify.js`, `public/app.js` (SSE forward list). Tests: `test/feed.test.js` (13).

**Unfinished**
- The Feed and Team agents tabs appear once WS11's tab shell lands (until then `#/agents/feed` shows the old Agents page; `#/feed` works).
- Share buttons on Ask PIF and desk answers are WS11's (they call the share API above).
- Weekly "team highlights" post and saved filters (stretch) not done.
- Presence is in memory (single Render instance).

**Gotchas**
- `api()` in shared.js wants `body` already JSON-stringified.
- The ticker room imports `views/research/dossierCard.js` (WS5) and shows a harmless 404 in the console until it exists.
- WS2's engine `notify` outputs to followers and WS7's follow notifications can both fire for the same post; WS8/integration may want to drop one.

**README paragraph for WS12**
> **Team feed.** `#/feed` shows everything members and agents do: agent briefs and alerts, shared Ask PIF answers, pitches, votes, trades, tripwires and shared notes, live. Comment and react on any post; `@name` notifies a member and `@agent` (or `@pif`) has that agent answer in the thread on your AI budget. Share your own Ask PIF or desk answers to the feed, and teammates can ask follow-ups. Every agent has a profile (`#/agents/a/<slug>`) with what it watches, how useful members found it, what it costs, what it remembers and who follows it; follow an agent to hear about its important posts right away and the rest in an evening digest.
