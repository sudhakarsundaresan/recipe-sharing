# Simmer — recipe sharing prototype

A working recipe-sharing website: registration/login, browsing and filtering recipes, publishing your own recipes (ingredients and steps stored separately), star ratings tracked per user, and comments.

## Run it

```
npm install
node serve.mjs
```

Then open http://localhost:4200 (override with `PORT=xxxx node serve.mjs`). The SQLite database (`data/recipes.db`) is created and seeded automatically on first run.

Seeded demo accounts all share the password `simmer-demo` (e.g. `mira.chen@example.com`), or just register a new account from the UI.

## Stack

- Node.js + Express, session-based auth (`bcryptjs` for password hashing)
- SQLite via the built-in `node:sqlite` module — no native build step
- Single-file vanilla JS frontend (`index.html`), no bundler/framework

## Data model

- `users` — registered accounts
- `recipes` — one row per recipe
- `recipe_ingredients` / `recipe_steps` — separate tables, ordered by position, linked to a recipe
- `ratings` — one row per (recipe, user), so each person's rating is tracked against their profile; the average shown on a recipe is computed from all rows
- `comments` — per-recipe comments tied to the commenting user
