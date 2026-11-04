import { createStore, get, set, del, values, clear } from 'idb-keyval';
import type { RecipeView } from '../shared/atproto';
import { draftInputSchema } from '../shared/atproto';

// Preview sessions use isolated memory storage, including publication recovery.
let demoStorage: Map<string, string> | undefined;
let demoOffline: Map<string, OfflineRecipe> | undefined;
export function enableDemoStorage() {
  demoStorage = new Map();
  demoOffline = new Map();
}
export const recoveryStorage = {
  getItem: (key: string) =>
    demoStorage ? (demoStorage.get(key) ?? null) : localStorage.getItem(key),
  setItem: (key: string, value: string) => {
    if (demoStorage) demoStorage.set(key, value);
    else localStorage.setItem(key, value);
  },
  removeItem: (key: string) => {
    if (demoStorage) demoStorage.delete(key);
    else localStorage.removeItem(key);
  },
};

// Only deliberately downloaded PUBLIC recipes go here. No session or private API cache.
const recipes = createStore('brownbag-offline-v1', 'recipes');
export type OfflineRecipe = { recipe: RecipeView; savedAt: string };
export const offlineRecipes = () =>
  demoOffline ? Promise.resolve([...demoOffline.values()]) : values<OfflineRecipe>(recipes);
export const offlineRecipe = (uri: string) =>
  demoOffline ? Promise.resolve(demoOffline.get(uri)) : get<OfflineRecipe>(uri, recipes);
export async function removeOfflineRecipe(uri: string) {
  if (demoOffline) demoOffline.delete(uri);
  else await del(uri, recipes);
  window.dispatchEvent(new Event('brownbag-offline-changed'));
}
export async function saveOfflineRecipe(recipe: RecipeView) {
  // Photos remain online; store just the recipe text and attribution.
  const textRecipe: RecipeView = {
    uri: recipe.uri,
    cid: recipe.cid,
    authorDid: recipe.authorDid,
    authorHandle: recipe.authorHandle,
    authorDisplayName: recipe.authorDisplayName,
    record: { ...recipe.record, images: undefined },
  };
  const copy = { recipe: textRecipe, savedAt: new Date().toISOString() };
  if (demoOffline) demoOffline.set(recipe.uri, copy);
  else await set(recipe.uri, copy, recipes);
  window.dispatchEvent(new Event('brownbag-offline-changed'));
}

const draftPrefix = 'brownbag-recovery-v1:';
export const recoveryKey = (did: string, route: string) => `${draftPrefix}${did}:${route}`;
export function readRecovery(key: string) {
  try {
    const raw = recoveryStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = draftInputSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
export function writeRecovery(key: string, data: unknown): boolean {
  try {
    recoveryStorage.setItem(key, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}
export function removeRecovery(key: string) {
  try {
    recoveryStorage.removeItem(key);
  } catch {
    /* Storage may be disabled. */
  }
}
export async function clearDeviceData() {
  if (demoStorage) {
    demoStorage.clear();
    demoOffline?.clear();
    window.dispatchEvent(new Event('brownbag-device-data-cleared'));
    return;
  }
  // Run both even if one storage backend is unavailable.
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(draftPrefix)) localStorage.removeItem(key);
    }
  } finally {
    await clear(recipes);
    window.dispatchEvent(new Event('brownbag-device-data-cleared'));
  }
}
