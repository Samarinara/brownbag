import { createId } from '../id';
import { enableDemoStorage } from '../offline-storage';
import { ApiError, setDemoTransport, setDemoImages } from '../api';
import { RECIPE_COLLECTION, type RecipeView, type RecipeInput } from '../../shared/atproto';
import { addDays, localDate, weekStart, type MealEntry, type MealSlot } from '../../shared/planner';
import { shoppingEnd, type ShoppingList, type ShoppingItem } from '../../shared/shopping';
import { type Draft, editableRecipe } from '../recipe-editor';

const did = 'did:plc:brownbaguidemo';
const stamp = new Date().toISOString();
const makeRecipe = (id: string, data: RecipeInput): RecipeView => ({
  uri: `at://${did}/${RECIPE_COLLECTION}/${id}`,
  cid: 'bafyre' + 'a'.repeat(53),
  authorDid: did,
  authorHandle: 'demo.brownbag',
  authorDisplayName: 'The Brownbag kitchen',
  record: { ...data, $type: RECIPE_COLLECTION, createdAt: stamp, updatedAt: stamp },
});
export const sampleRecipes = [
  makeRecipe('lemon-pasta', {
    title: 'Lemon & butter pasta',
    summary: 'A bright, simple supper for the nights you want something comforting.',
    description:
      'This is our Tuesday-night favourite. Save a mug of pasta water before draining; it makes the sauce wonderfully silky.',
    prepMinutes: 10,
    cookMinutes: 15,
    yield: { quantity: '2', unit: 'servings' },
    tags: ['Dinner', 'Vegetarian'],
    ingredients: [
      { quantity: '250', unit: 'g', name: 'pasta' },
      { quantity: '40', unit: 'g', name: 'butter' },
      { quantity: '1', name: 'lemon', preparation: 'zested and juiced' },
      { quantity: '30', unit: 'g', name: 'parmesan', preparation: 'finely grated' },
    ],
    instructions: [
      { text: 'Bring a large pan of salted water to the boil. Cook the pasta until just tender.' },
      { text: 'Melt the butter gently, then add the lemon zest and a splash of pasta water.' },
      { text: 'Toss in the pasta, lemon juice and parmesan. Stir until glossy, then serve.' },
    ],
  }),
  makeRecipe('tomato-soup', {
    title: 'Roasted tomato soup',
    summary: 'Sweet roasted tomatoes, a little garlic, and bread for dipping.',
    prepMinutes: 10,
    cookMinutes: 35,
    yield: { quantity: '4', unit: 'bowls' },
    tags: ['Lunch', 'Vegetarian'],
    ingredients: [
      { quantity: '800', unit: 'g', name: 'tomatoes' },
      { quantity: '2', name: 'garlic cloves' },
      { quantity: '2', unit: 'tbsp', name: 'olive oil' },
      { quantity: '500', unit: 'ml', name: 'vegetable stock' },
    ],
    instructions: [
      { text: 'Roast the tomatoes and garlic with olive oil at 200°C for 30 minutes.' },
      { text: 'Blend with the stock and warm gently. Season to taste.' },
    ],
  }),
  makeRecipe('overnight-oats', {
    title: 'Apple overnight oats',
    summary: 'Breakfast, ready before the kettle boils.',
    prepMinutes: 5,
    yield: { quantity: '2', unit: 'jars' },
    tags: ['Breakfast'],
    ingredients: [
      { quantity: '100', unit: 'g', name: 'rolled oats' },
      { quantity: '250', unit: 'ml', name: 'milk' },
      { quantity: '1', name: 'apple' },
    ],
    instructions: [
      { text: 'Mix the oats and milk in two jars. Grate in the apple and stir.' },
      { text: 'Cover and chill overnight. Add cinnamon before serving.' },
    ],
  }),
];

/** Installed only by the lazy-loaded demo entry point. No fetch or real account writes. */
export function installDemoApi() {
  enableDemoStorage();
  let recipes = structuredClone(sampleRecipes);
  const images = new Map<string, string>();
  setDemoImages(
    (uri, index) => {
      const ref = recipes.find((recipe) => recipe.uri === uri)?.record.images?.[index]?.image.ref
        .$link;
      return ref ? images.get(ref) : undefined;
    },
    (ref) => images.get(ref),
  );
  let drafts: Draft[] = [
    {
      id: 'demo-draft',
      data: { ...editableRecipe(recipes[1].record), title: 'My next soup' },
      updatedAt: stamp,
    },
  ];
  const bookmarks = new Map(
    recipes.map((r) => [
      r.uri,
      r.record.tags?.filter((tag) => ['Breakfast', 'Lunch', 'Dinner', 'Snack'].includes(tag)) ?? [],
    ]),
  );
  let defaultSlot: MealSlot = 'dinner';
  const start = weekStart(localDate());
  let entries: MealEntry[] = Array.from({ length: 7 }, (_, index) => ({
    id: `demo-meal-${index}`,
    date: addDays(start, index),
    slot: index % 3 === 0 ? 'lunch' : 'dinner',
    note: index === 2 ? 'Make a little extra for tomorrow.' : '',
    recipe: recipes[index % recipes.length],
  }));
  const purchased = new Set<string>();
  let keys: { id: string; name: string; prefix: string }[] = [
    { id: 'demo-key', name: 'Kitchen helper', prefix: 'demo' },
  ];
  const findRecipe = (uri: string) => {
    const recipe = recipes.find((r) => r.uri === uri);
    if (!recipe) throw new ApiError(404, 'This sample recipe was removed.');
    return recipe;
  };
  const shopping = (from: string, days: number): ShoppingList => {
    const to = shoppingEnd(from, days);
    const planned = entries.filter((entry) => entry.date >= from && entry.date <= to);
    const items = new Map<string, ShoppingItem>();
    for (const entry of planned)
      for (const ingredient of entry.recipe.record.ingredients) {
        const key = `${ingredient.name}:${ingredient.unit ?? ''}`;
        const existing = items.get(key);
        const quantity =
          ingredient.quantity && Number.isFinite(Number(ingredient.quantity))
            ? Number(ingredient.quantity)
            : null;
        if (existing) {
          if (quantity !== null)
            existing.quantity = String(Number(existing.quantity ?? 0) + quantity);
          else existing.unspecified.push(ingredient.quantity || 'as needed');
        } else
          items.set(key, {
            key,
            groupKey: key,
            fingerprint: key,
            ingredient: ingredient.name,
            unit: ingredient.unit ?? '',
            quantity: quantity === null ? null : String(quantity),
            unspecified: quantity === null ? [ingredient.quantity || 'as needed'] : [],
            checked: purchased.has(key),
          });
      }
    return { from, to, days, mealCount: planned.length, items: [...items.values()] };
  };
  setDemoTransport(async (path, options) => {
    const url = new URL(path, 'https://demo.invalid');
    const method = options.method ?? 'GET';
    const body = typeof options.body === 'string' ? JSON.parse(options.body) : {};
    const uri = url.searchParams.get('uri') ?? body.uri;
    let result: unknown;
    switch (url.pathname) {
      case '/images': {
        if (!(options.body instanceof Blob)) throw new ApiError(400, 'Choose a sample photo.');
        const ref =
          'bafkrei' +
          Array.from(
            crypto.getRandomValues(new Uint8Array(52)),
            (n) => 'abcdefghijklmnopqrstuvwxyz234567'[n % 32],
          ).join('');
        images.set(ref, URL.createObjectURL(options.body));
        result = {
          image: {
            $type: 'blob',
            ref: { $link: ref },
            mimeType: options.body.type,
            size: options.body.size,
          },
        };
        break;
      }
      case '/config':
        result = { configured: true };
        break;
      case '/me':
        result = { did, handle: 'demo.brownbag' };
        break;
      case '/recipes':
        if (method === 'POST') {
          const recipe = makeRecipe(createId(), body.recipe);
          recipes.push(recipe);
          result = recipe;
        } else {
          const q = (url.searchParams.get('q') ?? '').toLowerCase();
          const feed = url.searchParams.get('feed');
          const tag = url.searchParams.get('tag');
          result = {
            recipes: recipes.filter(
              (r) =>
                (feed !== 'cookbook' || bookmarks.has(r.uri)) &&
                (!tag || bookmarks.get(r.uri)?.includes(tag)) &&
                (!q ||
                  `${r.record.title} ${r.record.summary ?? ''} ${r.record.ingredients.map((ingredient) => ingredient.name).join(' ')}`
                    .toLowerCase()
                    .includes(q)),
            ),
          };
        }
        break;
      case '/recipe':
        if (method === 'DELETE') {
          recipes = recipes.filter((r) => r.uri !== uri);
          entries = entries.filter((e) => e.recipe.uri !== uri);
          result = {};
        } else if (method === 'PUT') {
          const previous = findRecipe(body.uri);
          const updated = {
            ...previous,
            record: { ...previous.record, ...body.recipe, updatedAt: new Date().toISOString() },
          };
          recipes = recipes.map((r) => (r.uri === uri ? updated : r));
          entries = entries.map((e) => (e.recipe.uri === uri ? { ...e, recipe: updated } : e));
          result = updated;
        } else result = findRecipe(uri);
        break;
      case '/cookbook/entry':
        result = { saved: bookmarks.has(uri), tags: bookmarks.get(uri) ?? [] };
        break;
      case '/cookbook/tags':
        result = {
          tags: [
            ...new Set([
              'Breakfast',
              'Lunch',
              'Dinner',
              'Snack',
              ...[...bookmarks.values()].flat(),
            ]),
          ],
        };
        break;
      case '/bookmarks':
        if (method === 'DELETE') bookmarks.delete(body.uri);
        else bookmarks.set(body.uri, body.tags ?? ['Dinner']);
        result = {};
        break;
      case '/drafts':
        if (method === 'POST') {
          const draft = { id: createId(), data: body.data, updatedAt: stamp };
          drafts.push(draft);
          result = draft;
        } else result = { drafts };
        break;
      case '/planner/settings':
        if (method === 'PUT') defaultSlot = body.defaultSlot;
        result = { defaultSlot };
        break;
      case '/planner':
        if (method === 'POST') {
          const entry = {
            id: body.id ?? createId(),
            date: body.date,
            slot: body.slot,
            note: body.note ?? '',
            recipe: findRecipe(body.uri),
          };
          if (!entries.some((e) => e.id === entry.id)) entries.push(entry);
          result = entry;
        } else
          result = {
            entries: entries.filter(
              (e) =>
                e.date >= (url.searchParams.get('from') ?? '') &&
                e.date <= (url.searchParams.get('to') ?? '9999'),
            ),
          };
        break;
      case '/planner/shopping-list':
        result = shopping(
          url.searchParams.get('from') ?? localDate(),
          Number(url.searchParams.get('days') ?? 7),
        );
        break;
      case '/planner/shopping-list/check':
        if (body.checked) purchased.add(body.key);
        else purchased.delete(body.key);
        result = shopping(body.from, body.days);
        break;
      case '/ingredients/suggestions':
        result = { suggestions: [] };
        break;
      case '/keys':
        if (method === 'POST') {
          keys.push({ id: createId(), name: body.name, prefix: 'demo' });
          result = { token: 'demo-only-key-no-real-account-access' };
        } else result = { keys };
        break;
      case '/proposals':
        result = { proposals: [] };
        break;
      case '/sync':
      case '/auth/logout':
        result = {};
        break;
      default:
        if (url.pathname.startsWith('/planner/')) {
          const id = url.pathname.slice('/planner/'.length);
          if (method === 'DELETE') entries = entries.filter((e) => e.id !== id);
          else entries = entries.map((e) => (e.id === id ? { ...e, ...body } : e));
          result = {};
        } else if (url.pathname.startsWith('/drafts/')) {
          const id = url.pathname.slice('/drafts/'.length);
          if (method === 'DELETE') drafts = drafts.filter((d) => d.id !== id);
          else drafts = drafts.map((d) => (d.id === id ? { ...d, data: body.data } : d));
          result = {};
        } else if (url.pathname.startsWith('/keys/')) {
          keys = keys.filter((k) => k.id !== url.pathname.slice('/keys/'.length));
          result = {};
        } else throw new ApiError(400, 'This action is not available in the sample kitchen.');
    }
    return structuredClone(result);
  });
}
