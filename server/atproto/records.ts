import {
  RECIPE_COLLECTION,
  didSchema,
  recipeInputSchema,
  recipeRecordSchema,
  type RecipeRecord,
} from '../../shared/atproto.js';

export const MAX_RECIPE_RECORD_BYTES = 128 * 1024;

export function parseRecipeUri(uri: string, ownerDid?: string) {
  const match = /^at:\/\/([^/]+)\/([^/]+)\/([A-Za-z0-9._~:-]{1,512})$/.exec(uri);
  if (!match || match[2] !== RECIPE_COLLECTION || ['.', '..'].includes(match[3])) {
    throw new Error('Invalid recipe URI');
  }
  const did = didSchema.parse(match[1]);
  if (ownerDid !== undefined && did !== ownerDid)
    throw new Error('Recipe belongs to another account');
  return { did, collection: RECIPE_COLLECTION, rkey: match[3] };
}

export function validateRecipeRecord(value: unknown): RecipeRecord {
  const record = recipeRecordSchema.parse(value);
  if (Buffer.byteLength(JSON.stringify(record), 'utf8') > MAX_RECIPE_RECORD_BYTES) {
    throw new Error('Recipe exceeds the 128 KiB record limit');
  }
  return record;
}

export function createRecipeRecord(
  input: unknown,
  previous?: RecipeRecord,
  now = new Date().toISOString(),
): RecipeRecord {
  const data = recipeInputSchema.parse(input);
  return validateRecipeRecord({
    ...data,
    $type: RECIPE_COLLECTION,
    createdAt: previous ? recipeRecordSchema.parse(previous).createdAt : now,
    ...(previous ? { updatedAt: now } : {}),
  });
}
