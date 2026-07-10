import pg from 'pg';

const { Pool } = pg;

// Postgres returns bigint (COUNT) and numeric (AVG) columns as strings by
// default to avoid precision loss. Our counts/averages never approach that
// scale, so parse them as plain JS numbers everywhere automatically.
pg.types.setTypeParser(20, (val) => parseInt(val, 10)); // int8 / bigint
pg.types.setTypeParser(1700, parseFloat); // numeric

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required (e.g. the connection string from your Render Postgres instance).');
}

const useSsl = !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
});

await pool.query(`
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recipes (
  id SERIAL PRIMARY KEY,
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recipe_ingredients (
  id SERIAL PRIMARY KEY,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recipe_steps (
  id SERIAL PRIMARY KEY,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ratings (
  id SERIAL PRIMARY KEY,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (recipe_id, user_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id SERIAL PRIMARY KEY,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recipes_user ON recipes(user_id);
CREATE INDEX IF NOT EXISTS idx_ingredients_recipe ON recipe_ingredients(recipe_id);
CREATE INDEX IF NOT EXISTS idx_steps_recipe ON recipe_steps(recipe_id);
CREATE INDEX IF NOT EXISTS idx_ratings_recipe ON ratings(recipe_id);
CREATE INDEX IF NOT EXISTS idx_ratings_user ON ratings(user_id);
CREATE INDEX IF NOT EXISTS idx_comments_recipe ON comments(recipe_id);
`);

// Lets every query below keep using SQLite-style "?" placeholders; this
// rewrites them to Postgres's positional "$1, $2, ..." before executing.
function toPgQuery(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}
async function run(sql, params = []) {
  return pool.query(toPgQuery(sql), params);
}
async function get(sql, params = []) {
  const res = await pool.query(toPgQuery(sql), params);
  return res.rows[0];
}
async function all(sql, params = []) {
  const res = await pool.query(toPgQuery(sql), params);
  return res.rows;
}
async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---- users ----

export async function createUser({ name, email, passwordHash }) {
  return get(
    'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?) RETURNING *',
    [name, email, passwordHash]
  );
}

export async function getUserByEmail(email) {
  return get('SELECT * FROM users WHERE email = ?', [email.trim().toLowerCase()]);
}

export async function getUserById(id) {
  return get('SELECT * FROM users WHERE id = ?', [id]);
}

// ---- recipes ----

export async function createRecipe({
  userId, title, story, cookTime, servings, difficulty, diet,
  sourceType, sourceUrl, heroKind, aiVariant, ingredients, steps,
}) {
  return transaction(async (client) => {
    const insertRecipe = await client.query(
      toPgQuery(`INSERT INTO recipes
        (user_id, title, story, cook_time, servings, difficulty, diet, source_type, source_url, hero_kind, ai_variant)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`),
      [userId, title, story, cookTime, servings, difficulty, diet, sourceType, sourceUrl, heroKind, aiVariant]
    );
    const recipeId = insertRecipe.rows[0].id;
    for (let i = 0; i < ingredients.length; i++) {
      await client.query(
        toPgQuery('INSERT INTO recipe_ingredients (recipe_id, position, text) VALUES (?, ?, ?)'),
        [recipeId, i, ingredients[i]]
      );
    }
    for (let i = 0; i < steps.length; i++) {
      await client.query(
        toPgQuery('INSERT INTO recipe_steps (recipe_id, position, text) VALUES (?, ?, ?)'),
        [recipeId, i, steps[i]]
      );
    }
    return recipeId;
  });
}

const RATING_AGG_JOIN = `
  LEFT JOIN (
    SELECT recipe_id, AVG(stars) AS avg_stars, COUNT(*) AS rating_count
    FROM ratings GROUP BY recipe_id
  ) rt ON rt.recipe_id = r.id
`;

export async function listRecipes({ q, vegan, vegetarian, ingredient, sortRecent } = {}) {
  const clauses = [];
  const params = [];
  if (q && q.trim()) {
    clauses.push('(r.title ILIKE ? OR u.name ILIKE ? OR r.story ILIKE ?)');
    const needle = `%${q.trim()}%`;
    params.push(needle, needle, needle);
  }
  if (vegan) {
    clauses.push("r.diet = 'vegan'");
  } else if (vegetarian) {
    clauses.push("r.diet IN ('vegetarian','vegan')");
  }
  if (ingredient && ingredient.trim()) {
    clauses.push(`EXISTS (SELECT 1 FROM recipe_ingredients ri WHERE ri.recipe_id = r.id AND ri.text ILIKE ?)`);
    params.push(`%${ingredient.trim()}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const order = sortRecent ? 'ORDER BY r.created_at DESC, r.id DESC' : 'ORDER BY r.id ASC';
  const rows = await all(
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
  for (const r of rows) { r.ingredients = await getIngredientsForRecipe(r.id); }
  return rows;
}

export async function listRecipesByUser(userId) {
  const rows = await all(
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
  for (const r of rows) { r.ingredients = await getIngredientsForRecipe(r.id); }
  return rows;
}

async function getIngredientsForRecipe(id) {
  const rows = await all('SELECT text FROM recipe_ingredients WHERE recipe_id = ? ORDER BY position ASC', [id]);
  return rows.map((row) => row.text);
}
async function getStepsForRecipe(id) {
  const rows = await all('SELECT text FROM recipe_steps WHERE recipe_id = ? ORDER BY position ASC', [id]);
  return rows.map((row) => row.text);
}

export async function getRecipeById(id, currentUserId) {
  const recipe = await get(
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
  recipe.ingredients = await getIngredientsForRecipe(id);
  recipe.steps = await getStepsForRecipe(id);
  recipe.comments = await all(
    `SELECT c.text, c.created_at, u.name AS author
     FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.recipe_id = ? ORDER BY c.id ASC`,
    [id]
  );
  recipe.myRating = currentUserId
    ? (await get('SELECT stars FROM ratings WHERE recipe_id = ? AND user_id = ?', [id, currentUserId]))?.stars ?? null
    : null;
  return recipe;
}

// ---- ratings ----

export async function upsertRating({ recipeId, userId, stars }) {
  await run(
    `INSERT INTO ratings (recipe_id, user_id, stars) VALUES (?, ?, ?)
     ON CONFLICT (recipe_id, user_id) DO UPDATE SET stars = excluded.stars`,
    [recipeId, userId, stars]
  );
  return get(
    `SELECT COALESCE(AVG(stars),0) AS avg_stars, COUNT(*) AS rating_count
     FROM ratings WHERE recipe_id = ?`,
    [recipeId]
  );
}

// ---- comments ----

export async function addComment({ recipeId, userId, text }) {
  const inserted = await get(
    'INSERT INTO comments (recipe_id, user_id, text) VALUES (?, ?, ?) RETURNING id',
    [recipeId, userId, text]
  );
  return get(
    `SELECT c.id, c.text, c.created_at, u.name AS author
     FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?`,
    [inserted.id]
  );
}

export async function countRecipesByUser(userId) {
  const row = await get('SELECT COUNT(*) AS n FROM recipes WHERE user_id = ?', [userId]);
  return row.n;
}

export async function isEmpty() {
  const row = await get('SELECT COUNT(*) AS n FROM users');
  return row.n === 0;
}

export default pool;
