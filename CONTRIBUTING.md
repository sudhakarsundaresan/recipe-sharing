# Contributing to Simmer

Thanks for wanting to contribute! This project takes contributions via the standard GitHub fork + pull request workflow.

## Getting set up

1. **Fork** this repo (button top-right on GitHub), then clone your fork:
   ```
   git clone https://github.com/<your-username>/recipe-sharing.git
   cd recipe-sharing
   ```
2. **Get a Postgres database** for local development — the free tier works fine. Easiest is [Render Postgres](https://render.com) (dashboard → New → PostgreSQL → copy the "External Database URL"), or point at any Postgres instance you already have.
3. **Configure your environment**:
   ```
   cp .env.example .env
   ```
   Fill in `DATABASE_URL`, and generate a `SESSION_SECRET`:
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
4. **Install and run**:
   ```
   npm install
   npm start
   ```
   Open http://localhost:4200. The schema is created and seeded automatically on first run.

## Making a change

1. Create a branch off `main` for your change:
   ```
   git checkout -b your-branch-name
   ```
2. Make your change. This is a small, dependency-light project on purpose:
   - `index.html` — the entire frontend (single file, vanilla JS, no build step)
   - `serve.mjs` — the Express server and all API routes
   - `db.js` — the Postgres schema and data-access layer
   - `seed-data.js` — demo accounts/recipes seeded on first run
3. **Verify it manually** before opening a PR — there's no automated test suite yet, so exercise the actual flow your change touches: register/log in, browse, publish a recipe, rate, comment, etc. If your change touches the YouTube-extraction flow (`extractRecipeFromYouTube` in `serve.mjs`), test it against a real video, since that path calls an external n8n webhook.
4. Commit with a message that explains *why*, not just *what*.
5. Push to your fork and open a pull request against this repo's `main` branch. Describe what changed and how you tested it.

## Using an AI coding assistant

Totally fine to use Claude Code, Antigravity, or similar — they don't change the workflow above. Point them at your cloned fork, let them make the edits, and either have them run the git commands (branch/commit/push) or do that part yourself. Either way, changes still land as a normal PR from your fork into `main`, reviewed the same as any other contribution.

## A few conventions

- No build step, no bundler, no framework — keep it that way unless there's a strong reason to change it.
- Prefer small, focused PRs over large ones.
- Don't commit `.env` or any real credentials — `.env.example` documents what's needed.
- Match the existing code style (plain functions, template-literal HTML rendering in `index.html`, `?`-placeholder SQL queries in `db.js` — see the `toPgQuery` helper).
