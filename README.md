# Pitzer Investment Fund — Holdings Tracker

A small web app for tracking the fund's stock positions: everyone can view holdings and
totals, and anyone with the shared edit password can add, change, or remove positions.

## Stack
- Node.js + Express (API + static file server)
- SQLite (via `better-sqlite3`), file-based, seeded from `seed.js` on first run
- Plain HTML/CSS/JS frontend (no build step)

## Local development
```bash
npm install
npm start
```
Visit http://localhost:3000. Default edit password is `pitzerfund` (see below to change it).

## Changing the edit password
Set the `EDIT_PASSWORD` environment variable before starting the server:
```bash
EDIT_PASSWORD="your-new-password" npm start
```
Anyone who knows this password can click "Unlock editing" on the site to add/edit/delete
positions. Viewing the tracker never requires a password.

## Deploying (Render.com)
This repo includes a `render.yaml` for a one-click-ish deploy with a persistent disk (so the
SQLite database survives restarts):

1. Push this repo to GitHub.
2. In Render, choose **New > Blueprint**, point it at the repo — it will read `render.yaml`.
3. When prompted, set the `EDIT_PASSWORD` environment variable to your fund's shared password.
4. Deploy. Render will give you a public URL to share with fund members.

Any other Node host that supports a persistent disk/volume (Railway, Fly.io, a VPS) works the
same way — just make sure `DB_PATH` points at a persistent volume, not ephemeral storage.

## Data
`seed.js` has the initial 32 positions transcribed from the fund's Yahoo Finance portfolio
screenshots (as of 2026-10-04). It only seeds the database on first run — once the app is live,
all changes happen through the UI and persist in the SQLite file at `DB_PATH` (default
`data/pif.db`, gitignored).
