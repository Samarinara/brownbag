import { recipeInputSchema, strongRefSchema, type RecipeInput } from '../shared/atproto';

export type PublicationIntent = {
  id: string;
  recipe: RecipeInput;
  existing?: { uri: string; cid: string };
  draftId?: string;
};
// Reuse the recovery namespace so Clear device data also removes these intents.
const intentKey = (key: string) => `${key}:publication`;
export function readPublicationIntent(key: string): PublicationIntent | undefined {
  try {
    const raw = JSON.parse(localStorage.getItem(intentKey(key)) || 'null');
    if (!raw || !/^[0-9a-f-]{36}$/i.test(raw.id)) return undefined;
    return {
      id: raw.id,
      recipe: recipeInputSchema.parse(raw.recipe),
      ...(raw.existing ? { existing: strongRefSchema.parse(raw.existing) } : {}),
      ...(raw.draftId ? { draftId: raw.draftId } : {}),
    };
  } catch {
    return undefined;
  }
}
export function persistPublicationIntent(key: string, intent: PublicationIntent) {
  try {
    localStorage.setItem(intentKey(key), JSON.stringify(intent));
  } catch {
    throw new Error(
      'Device backup is unavailable. Enable device storage before publishing so an interrupted publication can be recovered safely.',
    );
  }
}
export function removePublicationIntent(key: string) {
  try {
    localStorage.removeItem(intentKey(key));
  } catch {
    /* Already published. */
  }
}
