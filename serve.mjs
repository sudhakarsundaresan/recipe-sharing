import express from 'express';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createUser, getUserByEmail, getUserById,
  createRecipe, listRecipes, listRecipesByUser, getRecipeById,
  upsertRating, addComment, countRecipesByUser,
} from './db.js';
import { seed } from './seed-data.js';

seed();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? Number(process.env.PORT) : 4200;
const app = express();

app.use(express.json());
app.use(session({
  secret: 'simmer-local-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000 },
}));

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email };
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in.' });
  next();
}

function cardShape(r) {
  const avg = Number(r.avg_stars) || 0;
  return {
    id: r.id,
    title: r.title,
    author: r.author_name,
    diet: r.diet,
    cookTime: r.cook_time,
    servings: r.servings,
    difficulty: r.difficulty,
    story: r.story,
    sourceType: r.source_type,
    sourceUrl: r.source_url,
    heroKind: r.hero_kind,
    aiVariant: r.ai_variant,
    createdAt: r.created_at,
    avg: Math.round(avg * 10) / 10,
    ratingCount: r.rating_count,
    ...(r.ingredients ? { ingredients: r.ingredients } : {}),
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---- auth ----

app.post('/api/register', (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  if (!name) return res.status(400).json({ error: 'Please tell us your name.' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (getUserByEmail(email)) return res.status(409).json({ error: 'An account with that email already exists.' });

  const user = createUser({ name, email, passwordHash: bcrypt.hashSync(password, 10) });
  req.session.userId = user.id;
  res.json({ user: publicUser(user) });
});

app.post('/api/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!EMAIL_RE.test(email) || !password) {
    return res.status(400).json({ error: 'Please fill in email and password.' });
  }
  const user = getUserByEmail(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  req.session.userId = user.id;
  res.json({ user: publicUser(user) });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const user = getUserById(req.session.userId);
  if (!user) return res.json({ user: null });
  res.json({ user: publicUser(user), recipeCount: countRecipesByUser(user.id) });
});

// ---- recipes ----

app.get('/api/recipes', (req, res) => {
  const { q, vegan, vegetarian, ingredient, sort } = req.query;
  const rows = listRecipes({
    q, ingredient,
    vegan: vegan === '1' || vegan === 'true',
    vegetarian: vegetarian === '1' || vegetarian === 'true',
    sortRecent: sort === 'recent',
  });
  res.json({ recipes: rows.map(cardShape) });
});

app.get('/api/me/recipes', requireAuth, (req, res) => {
  const rows = listRecipesByUser(req.session.userId);
  res.json({ recipes: rows.map(cardShape) });
});

function extractYouTubeId(url) {
  const m = String(url || '').match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{6,})/);
  return m ? m[1] : null;
}
function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return String(url || '').replace(/^https?:\/\//, '').split('/')[0]; }
}

// Placeholder stand-in for a real extraction pipeline (e.g. an n8n webhook
// that transcribes a video or scrapes a recipe page). Swap the body of this
// function for a real call when wiring one up.
function mockExtractRecipe(mode) {
  return {
    ingredients: [
      `Main ingredient, as shown in the ${mode === 'youtube' ? 'video' : 'source page'}`,
      '2 tbsp seasoning or spice blend',
      '1/2 cup liquid or sauce base',
      'Salt and pepper to taste',
    ],
    steps: [
      'Prepare all ingredients as demonstrated in the source.',
      'Cook using the method described, adjusting heat as needed.',
      'Combine components and finish to taste.',
      'Plate and serve — edit these auto-extracted steps any time.',
    ],
    cookTime: '30', servings: '4', difficulty: 'Medium',
  };
}

app.post('/api/recipes', requireAuth, (req, res) => {
  const b = req.body || {};
  const mode = b.sourceType === 'youtube' || b.sourceType === 'link' ? b.sourceType : 'own';
  const title = String(b.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Please add a title.' });

  const diet = ['omnivore', 'vegetarian', 'vegan'].includes(b.diet) ? b.diet : 'omnivore';
  const heroKind = b.heroKind === 'ai' ? 'ai' : 'photo';
  const aiVariant = Number.isInteger(b.aiVariant) ? b.aiVariant : 0;

  if (mode === 'own') {
    const ingredients = (Array.isArray(b.ingredients) ? b.ingredients : []).map((s) => String(s).trim()).filter(Boolean);
    const steps = (Array.isArray(b.steps) ? b.steps : []).map((s) => String(s).trim()).filter(Boolean);
    if (ingredients.length === 0 || steps.length === 0) {
      return res.status(400).json({ error: 'Please add a title, at least one ingredient and one step.' });
    }
    const id = createRecipe({
      userId: req.session.userId, title,
      story: String(b.story || '').trim() || 'A recipe worth sharing.',
      cookTime: String(b.cookTime || '').trim() || '—',
      servings: String(b.servings || '').trim() || '—',
      difficulty: ['Easy', 'Medium', 'Hard'].includes(b.difficulty) ? b.difficulty : 'Easy',
      diet, sourceType: 'own', sourceUrl: '', heroKind, aiVariant, ingredients, steps,
    });
    return res.json({ id });
  }

  const sourceUrl = String(b.sourceUrl || '').trim();
  if (!/^https?:\/\//i.test(sourceUrl)) {
    return res.status(400).json({ error: 'Please add a valid link starting with http:// or https://' });
  }
  if (mode === 'youtube' && !extractYouTubeId(sourceUrl)) {
    return res.status(400).json({ error: "That doesn't look like a valid YouTube link." });
  }
  const mock = mockExtractRecipe(mode);
  const id = createRecipe({
    userId: req.session.userId, title,
    story: String(b.story || '').trim() || `Shared from ${mode === 'youtube' ? 'a YouTube video' : 'the web'} and auto-extracted by our recipe assistant.`,
    cookTime: mock.cookTime, servings: mock.servings, difficulty: mock.difficulty,
    diet, sourceType: mode, sourceUrl, heroKind, aiVariant,
    ingredients: mock.ingredients, steps: mock.steps,
  });
  res.json({ id, domain: domainOf(sourceUrl) });
});

app.get('/api/recipes/:id', (req, res) => {
  const recipe = getRecipeById(Number(req.params.id), req.session.userId || null);
  if (!recipe) return res.status(404).json({ error: 'Recipe not found.' });
  const videoId = recipe.source_type === 'youtube' ? extractYouTubeId(recipe.source_url) : null;
  res.json({
    recipe: {
      ...cardShape(recipe),
      ingredients: recipe.ingredients,
      steps: recipe.steps,
      comments: recipe.comments,
      myRating: recipe.myRating,
      domain: recipe.source_url ? domainOf(recipe.source_url) : '',
      videoEmbedUrl: videoId ? `https://www.youtube.com/embed/${videoId}` : '',
    },
  });
});

app.put('/api/recipes/:id/rating', requireAuth, (req, res) => {
  const stars = Number(req.body.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    return res.status(400).json({ error: 'Rating must be an integer from 1 to 5.' });
  }
  const recipe = getRecipeById(Number(req.params.id), null);
  if (!recipe) return res.status(404).json({ error: 'Recipe not found.' });
  const agg = upsertRating({ recipeId: recipe.id, userId: req.session.userId, stars });
  res.json({ avg: Math.round(Number(agg.avg_stars) * 10) / 10, ratingCount: agg.rating_count, myRating: stars });
});

app.post('/api/recipes/:id/comments', requireAuth, (req, res) => {
  const text = String(req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Comment cannot be empty.' });
  const recipe = getRecipeById(Number(req.params.id), null);
  if (!recipe) return res.status(404).json({ error: 'Recipe not found.' });
  const comment = addComment({ recipeId: recipe.id, userId: req.session.userId, text });
  res.json({ comment });
});

app.use(express.static(__dirname));

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
