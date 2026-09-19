import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recipeInputSchema, strongRefSchema, RECIPE_COLLECTION } from '../shared/atproto.js';
import {
  createRecipeRecord,
  parseRecipeUri,
  validateRecipeRecord,
} from '../server/atproto/records.js';

const input = {
  title: 'Bread',
  ingredients: [{ quantity: '1 1/2', unit: 'cups', name: 'flour' }],
  instructions: [{ text: 'Mix and bake.' }],
};
const did = 'did:plc:abcdefghijklmnopqrstuvwx';
const uri = `at://${did}/${RECIPE_COLLECTION}/3mabcdefg2345`;
const cid = 'bafyre' + 'a'.repeat(53);

test('portable recipe quantities use strings and numeric fields require integers', () => {
  assert.equal(recipeInputSchema.parse(input).ingredients[0].quantity, '1 1/2');
  assert.equal(
    recipeInputSchema.safeParse({ ...input, ingredients: [{ name: 'flour', quantity: 1.5 }] })
      .success,
    false,
  );
  assert.equal(recipeInputSchema.safeParse({ ...input, cookMinutes: 1.5 }).success, false);
});

test('publishing rejects private data and client-authored timestamps', () => {
  for (const property of ['notes', 'metadata', 'privateNotes', 'authorDid', 'createdAt']) {
    assert.throws(() => createRecipeRecord({ ...input, [property]: 'private' }));
  }
  assert.throws(() =>
    createRecipeRecord({ ...input, ingredients: [{ name: 'flour', secret: 'private' }] }),
  );
});

test('recipe updates preserve original creation time and do not mutate input', () => {
  const first = createRecipeRecord(input, undefined, '2026-01-01T00:00:00.000Z');
  const updated = createRecipeRecord(
    { ...input, title: 'Better bread' },
    first,
    '2026-02-01T00:00:00.000Z',
  );
  assert.equal(updated.createdAt, first.createdAt);
  assert.equal(updated.updatedAt, '2026-02-01T00:00:00.000Z');
  assert.equal(first.title, 'Bread');
  assert.equal(first.updatedAt, undefined);
});

test('recipe references and mutation URIs reject malformed or foreign targets', () => {
  assert.deepEqual(strongRefSchema.parse({ uri, cid }), { uri, cid });
  assert.equal(parseRecipeUri(uri, did).rkey, '3mabcdefg2345');
  assert.throws(() => parseRecipeUri(uri, 'did:plc:other'));
  for (const bad of [
    uri + '?x=y',
    uri + '#fragment',
    uri.replace(RECIPE_COLLECTION, 'app.bsky.feed.post'),
    uri.replace('3mabcdefg2345', '..'),
    uri.replace(did, 'cook.example'),
  ]) {
    assert.throws(() => parseRecipeUri(bad));
    assert.equal(strongRefSchema.safeParse({ uri: bad, cid }).success, false);
  }
  assert.equal(strongRefSchema.safeParse({ uri, cid: 'not-a-cid' }).success, false);
});

test('record limit counts UTF-8 bytes and bounds the complete payload', () => {
  assert.equal(recipeInputSchema.safeParse({ ...input, title: '🍞'.repeat(51) }).success, false);
  const record = createRecipeRecord(input);
  assert.throws(
    () =>
      validateRecipeRecord({
        ...record,
        instructions: Array.from({ length: 64 }, () => ({ text: 'x'.repeat(10000) })),
      }),
    /128 KiB/,
  );
});
