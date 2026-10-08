# Agents working in this repo

`CLAUDE.md` is the source of truth (what this app is, how to run/test it, data conventions, multi-agent setup). Read it and `README.md` first. This file only adds what's specific to non-Claude-Code agents or running multiple agents/accounts at once; don't duplicate CLAUDE.md here.

## Before you start
Read `AGENT_NOTES.md` for the running handoff log. Add an entry before you finish.

## Codex-specific
- Output that isn't a direct code change (scratch data, one-off exports/analysis) goes in `codex-output/`, not into `data/` or mixed into `lib/`/`routes/`.
- Never commit or print values from `.env`, `.env.local`, `.env.backup-before-keys`.
- Don't delete or overwrite `data/pif.db` — see CLAUDE.md's Data section.

## Multi-agent concurrency
See the "Multi-agent / multi-account" section in `CLAUDE.md` for the worktree convention and current uncommitted-work status.
