import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'recipes.db'));
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  story TEXT NOT NULL DEFAULT '',
  cook_time TEXT NOT NULL DEFAULT '',
  servings TEXT NOT NULL DEFAULT '',
  difficulty TEXT NOT NULL DEFAULT 'Easy',
  diet TEXT NOT NULL DEFAULT 'omnivore',
  source_type TEXT NOT NULL DEFAULT 'own',
  source_url TEXT NOT NULL DEFAULT '',
  hero_kind TEXT NOT NULL DEFAULT 'photo',
  ai_variant INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recipe_ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recipe_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 5),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(recipe_id, user_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_recipes_user ON recipes(user_id);
CREATE INDEX IF NOT EXISTS idx_ingredients_recipe ON recipe_ingredients(recipe_id);
CREATE INDEX IF NOT EXISTS idx_steps_recipe ON recipe_steps(recipe_id);
CREATE INDEX IF NOT EXISTS idx_ratings_recipe ON ratings(recipe_id);
CREATE INDEX IF NOT EXISTS idx_ratings_user ON ratings(user_id);
CREATE INDEX IF NOT EXISTS idx_comments_recipe ON comments(recipe_id);
`);

function run(sql, params = []) {
  return db.prepare(sql).run(...params);
}
function get(sql, params = []) {
  return db.prepare(sql).get(...params);
}
function all(sql, params = []) {
  return db.prepare(sql).all(...params);
}
function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ---- users ----

export function createUser({ name, email, passwordHash }) {
  const info = run(
    'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
    [name, email, passwordHash]
  );
  return getUserById(Number(info.lastInsertRowid));
}

export function getUserByEmail(email) {
  return get('SELECT * FROM users WHERE email = ?', [email.trim().toLowerCase()]);
}

export function getUserById(id) {
  return get('SELECT * FROM users WHERE id = ?', [id]);
}

// ---- recipes ----

export function createRecipe({
  userId, title, story, cookTime, servings, difficulty, diet,
  sourceType, sourceUrl, heroKind, aiVariant, ingredients, steps,
}) {
  return transaction(() => {
    const info = run(
      `INSERT INTO recipes
        (user_id, title, story, cook_time, servings, difficulty, diet, source_type, source_url, hero_kind, ai_variant)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, title, story, cookTime, servings, difficulty, diet, sourceType, sourceUrl, heroKind, aiVariant]
    );
    const recipeId = Number(info.lastInsertRowid);
    ingredients.forEach((text, i) => {
      run('INSERT INTO recipe_ingredients (recipe_id, position, text) VALUES (?, ?, ?)', [recipeId, i, text]);
    });
    steps.forEach((text, i) => {
      run('INSERT INTO recipe_steps (recipe_id, position, text) VALUES (?, ?, ?)', [recipeId, i, text]);
    });
    return recipeId;
  });
}

const RATING_AGG_JOIN = `
  LEFT JOIN (
    SELECT recipe_id, AVG(stars) AS avg_stars, COUNT(*) AS rating_count
    FROM ratings GROUP BY recipe_id
  ) rt ON rt.recipe_id = r.id
`;

export function listRecipes({ q, vegan, vegetarian, ingredient, sortRecent } = {}) {
  const clauses = [];
  const params = [];
  if (q && q.trim()) {
    clauses.push('(r.title LIKE ? OR u.name LIKE ? OR r.story LIKE ?)');
    const needle = `%${q.trim()}%`;
    params.push(needle, needle, needle);
  }
  if (vegan) {
    clauses.push("r.diet = 'vegan'");
  } else if (vegetarian) {
    clauses.push("r.diet IN ('vegetarian','vegan')");
  }
  if (ingredient && ingredient.trim()) {
    clauses.push(`EXISTS (SELECT 1 FROM recipe_ingredients ri WHERE ri.recipe_id = r.id AND ri.text LIKE ?)`);
    params.push(`%${ingredient.trim()}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const order = sortRecent ? 'ORDER BY r.created_at DESC, r.id DESC' : 'ORDER BY r.id ASC';
  const rows = all(
    `SELECT r.*, u.name AS author_name,
            COALESCE(rt.avg_stars, 0) AS avg_stars,
            COALESCE(rt.rating_count, 0) AS rating_count
     FROM recipes r
     JOIN users u ON u.id = r.user_id
     ${RATING_AGG_JOIN}
     ${where}
     ${order}`,
    params
  );
  rows.forEach((r) => { r.ingredients = getIngredientsForRecipe(r.id); });
  return rows;
}

export function listRecipesByUser(userId) {
  const rows = all(
    `SELECT r.*, u.name AS author_name,
            COALESCE(rt.avg_stars, 0) AS avg_stars,
            COALESCE(rt.rating_count, 0) AS rating_count
     FROM recipes r
     JOIN users u ON u.id = r.user_id
     ${RATING_AGG_JOIN}
     WHERE r.user_id = ?
     ORDER BY r.id DESC`,
    [userId]
  );
  rows.forEach((r) => { r.ingredients = getIngredientsForRecipe(r.id); });
  return rows;
}

function getIngredientsForRecipe(id) {
  return all('SELECT text FROM recipe_ingredients WHERE recipe_id = ? ORDER BY position ASC', [id]).map((row) => row.text);
}
function getStepsForRecipe(id) {
  return all('SELECT text FROM recipe_steps WHERE recipe_id = ? ORDER BY position ASC', [id]).map((row) => row.text);
}

export function getRecipeById(id, currentUserId) {
  const recipe = get(
    `SELECT r.*, u.name AS author_name,
            COALESCE(rt.avg_stars, 0) AS avg_stars,
            COALESCE(rt.rating_count, 0) AS rating_count
     FROM recipes r
     JOIN users u ON u.id = r.user_id
     ${RATING_AGG_JOIN}
     WHERE r.id = ?`,
    [id]
  );
  if (!recipe) return null;
  recipe.ingredients = getIngredientsForRecipe(id);
  recipe.steps = getStepsForRecipe(id);
  recipe.comments = all(
    `SELECT c.text, c.created_at, u.name AS author
     FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.recipe_id = ? ORDER BY c.id ASC`,
    [id]
  );
  recipe.myRating = currentUserId
    ? (get('SELECT stars FROM ratings WHERE recipe_id = ? AND user_id = ?', [id, currentUserId])?.stars ?? null)
    : null;
  return recipe;
}

// ---- ratings ----

export function upsertRating({ recipeId, userId, stars }) {
  run(
    `INSERT INTO ratings (recipe_id, user_id, stars) VALUES (?, ?, ?)
     ON CONFLICT(recipe_id, user_id) DO UPDATE SET stars = excluded.stars`,
    [recipeId, userId, stars]
  );
  return get(
    `SELECT COALESCE(AVG(stars),0) AS avg_stars, COUNT(*) AS rating_count
     FROM ratings WHERE recipe_id = ?`,
    [recipeId]
  );
}

// ---- comments ----

export function addComment({ recipeId, userId, text }) {
  const info = run('INSERT INTO comments (recipe_id, user_id, text) VALUES (?, ?, ?)', [recipeId, userId, text]);
  return get(
    `SELECT c.id, c.text, c.created_at, u.name AS author
     FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?`,
    [Number(info.lastInsertRowid)]
  );
}

export function countRecipesByUser(userId) {
  return get('SELECT COUNT(*) AS n FROM recipes WHERE user_id = ?', [userId]).n;
}

export function isEmpty() {
  return get('SELECT COUNT(*) AS n FROM users').n === 0;
}

export default db;
