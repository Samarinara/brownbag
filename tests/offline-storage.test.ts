import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearDeviceData,
  offlineRecipes,
  readRecovery,
  recoveryKey,
  removeRecovery,
  saveOfflineRecipe,
  writeRecovery,
} from '../src/offline-storage';
import { RECIPE_COLLECTION, type RecipeView } from '../shared/atproto';

// Browser storage stand-ins: assertions exercise persistence, account isolation and clearing.
const storage: Record<string, string> = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: string) => {
      storage[key] = value;
      Object.defineProperty(localStorage, key, { value, configurable: true, enumerable: true });
    },
    removeItem: (key: string) => {
      delete storage[key];
      delete (localStorage as unknown as Record<string, unknown>)[key];
    },
  },
});
Object.defineProperty(globalThis, 'window', { value: new EventTarget() });

test('offline recipes keep public text and attribution, excluding photos and private cookbook metadata', async () => {
  const recipe: RecipeView = {
    uri: `at://did:plc:test/${RECIPE_COLLECTION}/abc`,
    cid: 'test',
    authorDid: 'did:plc:test',
    authorHandle: 'cook.test',
    record: {
      $type: RECIPE_COLLECTION,
      title: 'Soup',
      createdAt: new Date().toISOString(),
      ingredients: [{ name: 'Beans' }],
      instructions: [{ text: 'Simmer' }],
      images: [],
    },
    cookbookTags: ['private tag'],
    cookbookAddedAt: 'private date',
  };
  await saveOfflineRecipe(recipe);
  const [saved] = await offlineRecipes();
  assert.equal(saved.recipe.record.title, 'Soup');
  assert.equal(saved.recipe.authorHandle, 'cook.test');
  assert.equal(saved.recipe.record.images, undefined);
  assert.equal(saved.recipe.cookbookTags, undefined);
  assert.equal(saved.recipe.cookbookAddedAt, undefined);
});

test('draft recovery is account/route scoped and rejects corrupt data', () => {
  const key = recoveryKey('did:plc:alice', '/recipe/new');
  const draft = { title: 'Unfinished', ingredients: [{ name: '' }], instructions: [{ text: '' }] };
  assert.equal(writeRecovery(key, draft), true);
  assert.deepEqual(readRecovery(key), draft);
  assert.equal(readRecovery(recoveryKey('did:plc:bob', '/recipe/new')), undefined);
  assert.equal(readRecovery(recoveryKey('did:plc:alice', '/recipe/edit?uri=x')), undefined);
  writeRecovery(key, { unexpected: true });
  assert.equal(readRecovery(key), undefined);
  removeRecovery(key);
  assert.equal(readRecovery(key), undefined);
});

test('sign-out/device clearing removes offline recipes and draft backups, retaining unrelated preferences', async () => {
  writeRecovery(recoveryKey('did:plc:alice', '/recipe/new'), {
    title: 'Secret',
    ingredients: [],
    instructions: [],
  });
  localStorage.setItem('brownbag-theme', 'dark');
  await clearDeviceData();
  assert.deepEqual(await offlineRecipes(), []);
  assert.equal(readRecovery(recoveryKey('did:plc:alice', '/recipe/new')), undefined);
  assert.equal(localStorage.getItem('brownbag-theme'), 'dark');
});
