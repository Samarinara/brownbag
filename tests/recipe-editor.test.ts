import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptRecipe, editableRecipe, blankRecipe } from '../src/recipe-editor.js';
import { recipeInputSchema, type RecipeInput } from '../shared/atproto.js';
import { createRecipeRecord } from '../server/atproto/records.js';

const full: RecipeInput = {
  title: 'Dumplings, two ways',
  summary: 'A family recipe',
  description: 'Mix, fold, steam.\nFreeze the extras.',
  ingredients: [
    { quantity: '1 ½', unit: 'cups', name: 'flour', preparation: 'sifted', group: 'Dough' },
    { quantity: 'to taste', name: 'salt', group: 'Filling' },
  ],
  instructions: [
    { text: 'Mix the dough.\nRest for 30 minutes.', group: 'Dough' },
    { text: 'Fold and steam.', group: 'Assembly' },
  ],
  yield: { quantity: '24–30', unit: 'dumplings', display: 'Enough for 4 hungry people' },
  prepMinutes: 0,
  cookMinutes: 30,
  tags: ['Family, favourites', '饺子'],
  language: 'zh-Hant',
  source: { name: 'Family cookbook', url: 'https://example.com/dumplings' },
  derivedFrom: {
    uri: 'at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/page.polli.brownbag.recipe/original',
    cid: 'bafyre' + 'a'.repeat(53),
  },
  adaptationNote: 'A different filling',
  images: [
    {
      image: {
        $type: 'blob',
        ref: { $link: 'bafkrei' + 'a'.repeat(52) },
        mimeType: 'image/webp',
        size: 321,
      },
      alt: 'Folded dumplings',
      width: 800,
      height: 600,
    },
  ],
};

test('editing round-trips every recipe field without repository metadata or shared mutable state', () => {
  const record = createRecipeRecord(full);
  const editable = editableRecipe(record);
  assert.deepEqual(recipeInputSchema.parse(editable), full);
  editable.ingredients[0].name = 'changed';
  assert.equal(record.ingredients[0].name, 'flour');
  assert.deepEqual(editableRecipe(blankRecipe()), blankRecipe());
});

test('adaptations credit the selected version and never reuse another account’s blobs', () => {
  const record = createRecipeRecord(full);
  const uri = 'at://did:plc:bbbbbbbbbbbbbbbbbbbbbbbb/page.polli.brownbag.recipe/dumplings';
  const cid = 'bafyre' + 'b'.repeat(53);
  const result = adaptRecipe(record, uri, cid);
  assert.deepEqual(result.derivedFrom, { uri, cid });
  assert.equal(result.images, undefined);
  assert.equal(result.adaptationNote, undefined);
  assert.deepEqual(result.ingredients, full.ingredients);
  assert.equal(record.images?.length, 1);
  assert.equal(recipeInputSchema.safeParse(result).success, true);
});

test('publication size accounts for UTF-8 and record metadata while drafts can remain longer', async () => {
  const { fitsPublishedRecord } = await import('../src/recipe-editor.js');
  assert.equal(fitsPublishedRecord(full), true);
  const long = {
    ...full,
    instructions: Array.from({ length: 64 }, () => ({ text: '🍞'.repeat(2500) })),
  };
  assert.equal(recipeInputSchema.safeParse(long).success, true);
  assert.equal(fitsPublishedRecord(long), false);
});

test('recipes returned by the account SDK retain photo references when edited', async () => {
  const { BlobRef } = await import('@atproto/lexicon');
  const { jsonToIpld } = await import('@atproto/common-web');
  const { validateRecipeRecord } = await import('../server/atproto/records.js');
  const record = createRecipeRecord(full);
  const sdkRecord = {
    ...record,
    images: record.images!.map((photo) => ({
      ...photo,
      image: BlobRef.fromJsonRef(jsonToIpld(photo.image) as any),
    })),
  };
  const normalized = validateRecipeRecord(sdkRecord);
  assert.deepEqual(normalized.images, full.images);
  assert.deepEqual(
    createRecipeRecord({ ...full, title: 'Updated' }, normalized).images,
    full.images,
  );
});
