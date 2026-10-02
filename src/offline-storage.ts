import { createStore, get, set, del, values, clear } from 'idb-keyval';
import type { RecipeView } from '../shared/atproto';
import { draftInputSchema } from '../shared/atproto';

// Only deliberately downloaded PUBLIC recipes go here. No session or private API cache.
const recipes = createStore('brownbag-offline-v1', 'recipes');
export type OfflineRecipe = { recipe: RecipeView; savedAt: string };
export const offlineRecipes = () => values<OfflineRecipe>(recipes);
export const offlineRecipe = (uri: string) => get<OfflineRecipe>(uri, recipes);
export async function removeOfflineRecipe(uri: string) {
  await del(uri, recipes);
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
  await set(recipe.uri, { recipe: textRecipe, savedAt: new Date().toISOString() }, recipes);
  window.dispatchEvent(new Event('brownbag-offline-changed'));
}

const draftPrefix = 'brownbag-recovery-v1:';
export const recoveryKey = (did: string, route: string) => `${draftPrefix}${did}:${route}`;
export function readRecovery(key: string) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = draftInputSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
export function writeRecovery(key: string, data: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}
export function removeRecovery(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* Storage may be disabled. */
  }
}
export async function clearDeviceData() {
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
