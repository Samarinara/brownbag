import {
  RECIPE_COLLECTION,
  MAX_RECIPE_RECORD_BYTES,
  didSchema,
  recipeInputSchema,
  recipeRecordSchema,
  type RecipeRecord,
} from '../../shared/atproto.js';

export { MAX_RECIPE_RECORD_BYTES } from '../../shared/atproto.js';

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
  // The AT Protocol SDK returns BlobRef/CID objects; validate their wire representation.
  const record = recipeRecordSchema.parse(JSON.parse(JSON.stringify(value)));
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
