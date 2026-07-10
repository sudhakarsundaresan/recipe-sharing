# Simmer — recipe sharing prototype

A working recipe-sharing website: registration/login, browsing and filtering recipes, publishing your own recipes (ingredients and steps stored separately, including real YouTube-video extraction via an n8n workflow), star ratings tracked per user, and comments.

## Run it locally

1. Get a Postgres database — the free tier works fine. Easiest is [Render Postgres](https://render.com) (dashboard → New → PostgreSQL → copy the "External Database URL").
2. `cp .env.example .env` and fill in `DATABASE_URL` (and generate a `SESSION_SECRET`).
3. Install and run:
   ```
   npm install
   npm start
   ```
4. Open http://localhost:4200 (override the port with `PORT=xxxx` in `.env`).

The database schema is created automatically on first run, and seeded with 12 demo recipes/accounts (password `simmer-demo`, e.g. `mira.chen@example.com`) if the database is empty — or just register a new account from the UI.

## Deploy to Render

This repo includes a `render.yaml` Blueprint that provisions both the web service and a Postgres database, wired together automatically:

1. Push this repo to GitHub (already done).
2. In Render: **New +** → **Blueprint** → connect this repo. Render reads `render.yaml` and creates the `simmer` web service plus a `simmer-db` Postgres database, linking `DATABASE_URL` and generating a random `SESSION_SECRET` for you.
3. Deploy. Render builds with `npm install` and starts with `npm start`.

Notes on the free tier: free Postgres databases on Render expire after 90 days (you'd recreate one and update the linked env var); free web services spin down after 15 minutes of inactivity and take ~30-50s to wake back up on the next request. Fine for letting people test the app; upgrade the plans in `render.yaml` if you want it always-on/persistent long-term.

## Stack

- Node.js + Express, session-based auth (`bcryptjs` for password hashing)
- PostgreSQL via `pg` (node-postgres)
- Single-file vanilla JS frontend (`index.html`), no bundler/framework
- YouTube recipe extraction via an n8n workflow (transcription + AI agent) — see `extractRecipeFromYouTube` in `serve.mjs`

## Data model

- `users` — registered accounts
- `recipes` — one row per recipe
- `recipe_ingredients` / `recipe_steps` — separate tables, ordered by position, linked to a recipe
- `ratings` — one row per (recipe, user), so each person's rating is tracked against their profile; the average shown on a recipe is computed from all rows
- `comments` — per-recipe comments tied to the commenting user
