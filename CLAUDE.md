# Pitzer Investment Fund — project notes

Full feature description is in `README.md` — read that first for what the app does. This file covers how to run it, conventions, and multi-agent/account setup.

## What it is
A Node/Express app (`server.js`) with a vanilla-JS frontend (`public/`, hash-routed via `public/router.js`) and a libsql/sqlite backing store (`db.js`, data in `data/pif.db`). Routes live in `routes/`, business logic in `lib/`.

## Running it
```bash
npm install
npm start              # node server.js
npm test               # node --test test/*.test.js
npm run test:live      # LIVE=1 node --test test/*.test.js (hits live data sources)
```
Seed/reset local data with `seed.js`.

## Deployment
Live deploy is **Render** (`render.yaml`). There's also a `.vercel/` folder in this repo from an earlier setup — that is not the current deployment target; don't update it or treat it as live without checking with Will first.

## Data
- `data/pif.db` (+ `-shm`/`-wal`) is the sqlite database, gitignored, generated. It's the live source of truth for the running app, not meant to be committed.
- `.env` / `.env.local` hold API keys (gitignored). `.env.example` shows the shape, no real values — keep that file in sync when you add a new required var, without putting the real value in it.
- Don't delete or overwrite `data/pif.db` directly. If you need a fresh local DB, use `seed.js` or ask Will before wiping it.

## Multi-agent / multi-account (added 2026-10-07)
This project is worked on by two separate Claude Code accounts (different `CLAUDE_CONFIG_DIR`s) and OpenAI Codex sessions, plus Will himself.
- **Read `AGENT_NOTES.md` first** at the start of a session, and add an entry before finishing with anything non-trivial done — what you did, what's unfinished, gotchas.
- **As of 2026-10-07 there are ~45 uncommitted files** (mid-feature: congressTrades, govContracts, paperTrading, etc.) — check `git status` before assuming main reflects what's deployed or what another agent just did.
- **Codex output**: anything Codex generates that isn't a direct code edit (scratch data, one-off exports/analysis) goes in `codex-output/`, not into `data/` or mixed into `lib/`/`routes/`.
- **Worktrees for concurrent edits**: if two agents need to work at the same literal moment, use a git worktree per account (`git worktree add ../pitzerinvestmentfund-<account> <branch>`) rather than sharing one checkout, then merge back to `main` the same session and delete the worktree/branch. Don't let accounts diverge on long-lived separate branches — everyone should stay close to `main`.
- Never commit `.env`, `.env.local`, `.env.backup-before-keys`, or anything under `data/` — already gitignored, just don't force-add them.
