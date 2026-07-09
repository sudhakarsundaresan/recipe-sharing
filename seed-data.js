import bcrypt from 'bcryptjs';
import { createUser, getUserByEmail, createRecipe, upsertRating, addComment, isEmpty } from './db.js';

// Shared password for every seeded demo account — fine for a local prototype.
export const SEED_PASSWORD = 'simmer-demo';

// The 8 original recipe authors from the design's mock data, plus a handful of
// extra "taste testers" so we have enough distinct people to reproduce rating
// counts as high as 10 without anyone rating their own recipe.
const AUTHORS = [
  'Mira Chen', 'Theo Alvarez', 'Priya Nair', 'Owen Park',
  'Sofia Marsh', 'Naomi Reyes', 'Kenji Sato', 'Elin Whitfield',
];
const EXTRA_TASTERS = [
  'Ravi Patel', 'Zara Ahmed', 'Liam O’Connor', 'Ana Souza', 'Chidi Okafor',
];

function slugEmail(name) {
  return name.toLowerCase().replace(/[^a-z ]/g, '').trim().replace(/\s+/g, '.') + '@example.com';
}

const RECIPES = [
  {
    title: "Grandma's Golden Squash Soup", author: 'Mira Chen', diet: 'vegan',
    story: "A soup my grandmother made every first cold Sunday of autumn, simmered slow until the whole house smelled like cinnamon and squash.",
    cookTime: '35', servings: '4', difficulty: 'Easy',
    ingredients: ['2 lbs butternut squash, cubed', '1 yellow onion, chopped', '3 cups vegetable stock', '1/2 cup coconut milk', '1 tsp cinnamon', 'Salt and pepper to taste'],
    steps: ['Roast the squash and onion at 400°F for 25 minutes until soft.', 'Blend the roasted vegetables with stock until smooth.', 'Simmer on the stove, stir in coconut milk and cinnamon.', 'Season to taste and serve warm with crusty bread.'],
    ratingSum: 23, ratingCount: 5,
    comments: [{ author: 'Priya Nair', text: 'Made this last night — so cozy!' }, { author: 'Owen Park', text: 'Added a pinch of nutmeg, worked great.' }],
  },
  {
    title: 'Forest Mushroom Risotto', author: 'Theo Alvarez', diet: 'vegetarian',
    story: "Foraged chanterelles from a rainy walk in the woods, folded slowly into rice until it turned the color of the forest floor.",
    cookTime: '50', servings: '4', difficulty: 'Medium',
    ingredients: ['1.5 cups arborio rice', '4 cups mushroom stock, warm', '8 oz mixed wild mushrooms', '1/2 cup white wine', '1/2 cup parmesan, grated', '2 tbsp butter'],
    steps: ['Sauté mushrooms in butter until golden, set aside.', 'Toast the rice, then deglaze with white wine.', 'Add warm stock one ladle at a time, stirring often.', 'Fold in mushrooms and parmesan just before serving.'],
    ratingSum: 44, ratingCount: 9,
    comments: [{ author: 'Sofia Marsh', text: 'The best risotto I have made at home.' }],
  },
  {
    title: 'Sunday Morning Cinnamon Rolls', author: 'Priya Nair', diet: 'vegetarian',
    story: "These fill the kitchen with warmth before anyone is even out of bed — a small ritual worth waking up early for.",
    cookTime: '120', servings: '8', difficulty: 'Medium',
    ingredients: ['4 cups flour', '1 packet active yeast', '1/2 cup sugar', '1/2 cup butter, melted', '2 tbsp cinnamon', '1 cup cream cheese frosting'],
    steps: ['Proof the yeast in warm milk with a spoon of sugar.', 'Knead the dough and let it rise for one hour.', 'Roll flat, spread butter and cinnamon sugar, then roll tight.', 'Slice, prove again, and bake at 375°F for 22 minutes.', 'Frost generously while still warm.'],
    ratingSum: 47, ratingCount: 10,
    comments: [{ author: 'Kenji Sato', text: 'My kids ask for these every weekend now.' }, { author: 'Naomi Reyes', text: 'So soft. Perfect recipe.' }],
  },
  {
    title: 'Wildflower Honey Lemon Cake', author: 'Sofia Marsh', diet: 'vegetarian',
    story: "Bright and a little wild, like the honey from the hives past the orchard fence, this one is for slow afternoons.",
    cookTime: '55', servings: '8', difficulty: 'Easy',
    ingredients: ['2 cups flour', '3/4 cup wildflower honey', '3 eggs', '1/2 cup olive oil', 'Zest of 2 lemons', '1/2 cup buttermilk'],
    steps: ['Whisk honey, eggs and oil until pale and glossy.', 'Fold in flour, lemon zest and buttermilk until just combined.', 'Pour into a greased pan and bake at 350°F for 40 minutes.', 'Cool completely before slicing.'],
    ratingSum: 18, ratingCount: 4,
    comments: [{ author: 'Elin Whitfield', text: 'Not too sweet, just right.' }],
  },
  {
    title: 'Rustic Tomato & Basil Galette', author: 'Owen Park', diet: 'vegetarian',
    story: "An end-of-summer galette, folded imperfectly by hand — the imperfection is the whole point.",
    cookTime: '60', servings: '6', difficulty: 'Medium',
    ingredients: ['1 sheet pie dough', '4 heirloom tomatoes, sliced', '1/2 cup ricotta', '1/4 cup basil, torn', '2 tbsp olive oil', '1 egg, beaten for wash'],
    steps: ['Roll out the dough on a floured surface.', 'Spread ricotta in the center, leaving a 2-inch border.', 'Layer tomatoes and basil, then fold the edges over.', 'Brush with egg wash and bake at 400°F for 35 minutes.'],
    ratingSum: 20, ratingCount: 5,
    comments: [],
  },
  {
    title: 'Ember-Roasted Root Vegetables', author: 'Naomi Reyes', diet: 'vegan',
    story: "Roasted low and slow until the edges char just slightly, like something pulled straight from a hearth.",
    cookTime: '45', servings: '4', difficulty: 'Easy',
    ingredients: ['2 carrots, halved', '2 parsnips, halved', '1 sweet potato, cubed', '1 red onion, quartered', '3 tbsp olive oil', 'Fresh thyme'],
    steps: ['Toss all vegetables with olive oil, thyme, salt and pepper.', 'Spread on a sheet pan in a single layer.', 'Roast at 425°F for 35–40 minutes, turning once.', 'Finish with a squeeze of lemon before serving.'],
    ratingSum: 33, ratingCount: 7,
    comments: [{ author: 'Mira Chen', text: 'So simple and so good.' }],
  },
  {
    title: 'Miso Butter Ramen', author: 'Kenji Sato', diet: 'omnivore',
    story: "A bowl built from patience — a broth simmered for hours, finished with a spoon of miso butter right before serving.",
    cookTime: '180', servings: '2', difficulty: 'Hard',
    ingredients: ['4 cups chicken stock', '2 tbsp white miso', '2 tbsp butter', '2 soft-boiled eggs', '2 portions ramen noodles', '2 scallions, sliced'],
    steps: ['Simmer stock gently for at least 2 hours.', 'Whisk miso and butter into the hot broth until glossy.', 'Cook noodles separately and divide into bowls.', 'Ladle broth over noodles, top with egg and scallions.'],
    ratingSum: 46, ratingCount: 9,
    comments: [{ author: 'Theo Alvarez', text: 'Restaurant quality, honestly.' }],
  },
  {
    title: 'Blackberry Sage Crumble', author: 'Elin Whitfield', diet: 'vegetarian',
    story: "Picked wild blackberries along the hedgerow, and a little sage from the garden to make it taste like late summer.",
    cookTime: '50', servings: '6', difficulty: 'Easy',
    ingredients: ['4 cups blackberries', '2 tbsp sugar', '1 tsp chopped sage', '1 cup oats', '1/2 cup flour', '1/3 cup cold butter, cubed'],
    steps: ['Toss blackberries with sugar and sage, spread in a baking dish.', 'Mix oats, flour and butter with fingers until crumbly.', 'Scatter the crumble topping over the berries.', 'Bake at 375°F for 35 minutes until golden and bubbling.'],
    ratingSum: 27, ratingCount: 6,
    comments: [{ author: 'Naomi Reyes', text: 'The sage is such a lovely surprise.' }],
  },
  {
    title: 'Classic Beef Bourguignon', author: 'Owen Park', diet: 'omnivore',
    story: "A rainy-day braise — beef simmered for hours in red wine until it falls apart at the touch of a fork.",
    cookTime: '210', servings: '6', difficulty: 'Hard',
    ingredients: ['3 lbs beef chuck, cubed', '4 strips bacon, chopped', '1 bottle red wine', '2 carrots, sliced', '1 onion, chopped', '2 cups beef stock', '8 oz pearl onions', '8 oz mushrooms'],
    steps: ['Brown the bacon, then sear the beef in the rendered fat.', 'Sauté carrots and onion, then return beef to the pot.', 'Add wine and stock, cover, and braise at 325°F for 3 hours.', 'Stir in pearl onions and mushrooms for the last 30 minutes.'],
    ratingSum: 41, ratingCount: 8,
    comments: [{ author: 'Theo Alvarez', text: 'Worth every minute of braising.' }],
  },
  {
    title: 'Grilled Lemon Herb Chicken', author: 'Naomi Reyes', diet: 'omnivore',
    story: "A weeknight staple — bright with lemon and herbs, charred just enough on the grill.",
    cookTime: '30', servings: '4', difficulty: 'Easy',
    ingredients: ['4 chicken thighs, bone-in', '2 lemons, juiced and zested', '3 cloves garlic, minced', '2 tbsp olive oil', '1 tbsp fresh thyme', '1 tbsp fresh rosemary'],
    steps: ['Whisk lemon juice, zest, garlic, oil and herbs into a marinade.', 'Marinate the chicken for at least 1 hour.', 'Grill over medium-high heat, turning once, about 22 minutes.', 'Rest for 5 minutes before serving.'],
    ratingSum: 36, ratingCount: 8,
    comments: [{ author: 'Mira Chen', text: 'So easy for a weeknight dinner.' }],
  },
  {
    title: 'Bacon-Wrapped Asparagus Bites', author: 'Kenji Sato', diet: 'omnivore',
    story: "A five-ingredient appetizer that disappears the moment it hits the table.",
    cookTime: '25', servings: '4', difficulty: 'Easy',
    ingredients: ['1 bunch asparagus, trimmed', '8 strips bacon, halved', '2 tbsp brown sugar', '1 tsp black pepper', '1 tbsp olive oil'],
    steps: ['Wrap each asparagus spear with a half-strip of bacon.', 'Arrange on a sheet pan and sprinkle with brown sugar and pepper.', 'Roast at 400°F for 18-20 minutes until bacon is crisp.', 'Serve warm.'],
    ratingSum: 22, ratingCount: 5,
    comments: [],
  },
  {
    title: 'Pan-Seared Salmon with Dill', author: 'Sofia Marsh', diet: 'omnivore',
    story: "A quick, elegant dinner — crisp-skinned salmon finished with a bright dill and lemon butter.",
    cookTime: '20', servings: '2', difficulty: 'Easy',
    ingredients: ['2 salmon fillets, skin-on', '2 tbsp butter', '1 lemon, sliced', '2 tbsp fresh dill, chopped', 'Salt and pepper to taste'],
    steps: ['Season the salmon and sear skin-side down for 5 minutes.', 'Flip and cook 3 more minutes until just cooked through.', 'Add butter, lemon and dill to the pan and baste.', 'Serve immediately with the pan sauce.'],
    ratingSum: 26, ratingCount: 6,
    comments: [{ author: 'Priya Nair', text: 'That dill butter is everything.' }],
  },
];

function ensureUser(name, passwordHash) {
  const email = slugEmail(name);
  const existing = getUserByEmail(email);
  if (existing) return existing;
  return createUser({ name, email, passwordHash });
}

// Distributes `count` distinct star ratings (1-5) that sum to `sum`.
function distributeStars(sum, count) {
  const base = Math.min(5, Math.max(1, Math.floor(sum / count)));
  const remainder = sum - base * count;
  const stars = [];
  for (let i = 0; i < count; i++) {
    stars.push(i < remainder ? Math.min(5, base + 1) : base);
  }
  return stars;
}

export function seed() {
  if (!isEmpty()) return;

  const passwordHash = bcrypt.hashSync(SEED_PASSWORD, 10);
  const userByName = new Map();
  for (const name of [...AUTHORS, ...EXTRA_TASTERS]) {
    userByName.set(name, ensureUser(name, passwordHash));
  }
  const allNames = [...AUTHORS, ...EXTRA_TASTERS];

  RECIPES.forEach((recipe, idx) => {
    const author = userByName.get(recipe.author);
    const recipeId = createRecipe({
      userId: author.id,
      title: recipe.title,
      story: recipe.story,
      cookTime: recipe.cookTime,
      servings: recipe.servings,
      difficulty: recipe.difficulty,
      diet: recipe.diet,
      sourceType: 'own',
      sourceUrl: '',
      heroKind: idx % 4 === 3 ? 'ai' : 'photo',
      aiVariant: idx % 4,
      ingredients: recipe.ingredients,
      steps: recipe.steps,
    });

    // Pick distinct raters (excluding the author), rotating the start point
    // per recipe so different recipes get different rater mixes.
    const raterPool = allNames.filter((n) => n !== recipe.author);
    const rotated = raterPool.slice(idx % raterPool.length).concat(raterPool.slice(0, idx % raterPool.length));
    const raters = rotated.slice(0, recipe.ratingCount);
    const stars = distributeStars(recipe.ratingSum, recipe.ratingCount);
    raters.forEach((raterName, i) => {
      upsertRating({ recipeId, userId: userByName.get(raterName).id, stars: stars[i] });
    });

    recipe.comments.forEach((c) => {
      const commenter = userByName.get(c.author);
      if (commenter) addComment({ recipeId, userId: commenter.id, text: c.text });
    });
  });
}
