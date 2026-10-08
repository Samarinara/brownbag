import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import type { Database } from '../server/db.js';
import { NetworkStore } from '../server/network-store.js';
import { createNetworkApp } from '../server/network-app.js';
import { createRecipeRecord } from '../server/atproto/records.js';
import { RECIPE_COLLECTION } from '../shared/atproto.js';

const did = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const cid = 'bafyre' + 'a'.repeat(53);
const adapt = (pg: any): Database => ({
  query: async (text, params = []) => (await pg.query(text, params)).rows,
  transaction: (fn) => pg.transaction((tx: any) => fn(adapt(tx))),
});
const migration = async (pg: PGlite, file: string) =>
  pg.exec(await readFile(new URL(`../migrations/${file}.sql`, import.meta.url), 'utf8'));
const event = (
  rkey: string,
  ingredients: { name: string; unit?: string; quantity?: string }[],
) => ({
  did,
  collection: RECIPE_COLLECTION,
  rkey,
  cid,
  rev: '3mabc234567ac',
  record: createRecipeRecord(
    { title: 'Soup', ingredients, instructions: [{ text: 'Cook.' }] },
    undefined,
    '2026-01-01T00:00:00.000Z',
  ),
});
const uri = (rkey: string) => `at://${did}/${RECIPE_COLLECTION}/${rkey}`;

test('ingredient migration backfills text, parses quantities and maintains revision-safe projections', async () => {
  const pg = new PGlite();
  try {
    await migration(pg, '001_network');
    const store = new NetworkStore(adapt(pg));
    const first = event('first', [
      { name: '  CaRRoTs  ', unit: '  CUPS ', quantity: '1 ½' },
      { name: 'carrots', unit: 'cups', quantity: '1/2' },
      { name: 'CARROTS', unit: 'G', quantity: '100' },
      { name: 'Salt', quantity: 'to taste' },
      { name: 'SALT', quantity: '1' },
    ]);
    await store.index(first);
    await migration(pg, '005_ingredient_index');
    assert.deepEqual(
      (await store.recipe(uri('first'))).record.ingredients,
      first.record.ingredients,
    );
    const second = event('second', [
      { name: 'Carrots', unit: 'CuPs', quantity: '2.5' },
      { name: 'salt', quantity: '1–2' },
      { name: '100% cocoa', unit: 'g', quantity: '.5' },
      { name: '100X cocoa', unit: 'g', quantity: '1' },
    ]);
    await store.index(second);
    assert.deepEqual(await store.ingredientSuggestions('ingredient', '  CAR'), [
      { value: 'carrots', recipeCount: 2 },
    ]);
    assert.deepEqual(await store.ingredientSuggestions('unit', 'CU'), [
      { value: 'cups', recipeCount: 2 },
    ]);
    assert.deepEqual(await store.ingredientSuggestions('ingredient', '100%'), [
      { value: '100% cocoa', recipeCount: 1 },
    ]);
    const groups = await store.ingredientGroups([uri('first'), uri('second'), uri('first')]);
    const cups = groups.find((group) => group.ingredient === 'carrots' && group.unit === 'cups')!;
    assert.equal(Number(cups.totalQuantity), 4.5);
    assert.equal(cups.occurrences, 3);
    assert.equal(cups.entries.length, 3);
    assert.equal(cups.recipeCount, 2);
    const salt = groups.find((group) => group.ingredient === 'salt')!;
    assert.equal(salt.totalQuantity, null);
    assert.equal(Number(salt.knownQuantity), 1);
    assert.equal(salt.unquantifiedCount, 2);
    assert.equal((await store.recipes({ ingredient: 'CARROTS', unit: 'cups' })).recipes.length, 2);
    assert.equal((await store.recipes({ ingredient: 'CARROTS', unit: 'G' })).recipes.length, 1);
    assert.equal((await store.recipes({ ingredient: 'carrot' })).recipes.length, 0);
    for (const [text, expected] of [
      ['0', 0],
      ['1/2', 0.5],
      ['1 1/2', 1.5],
      ['1½', 1.5],
      ['⅜', 0.375],
      [' 2.25 ', 2.25],
      ['1 / 4', 0.25],
      ['1/0', null],
      ['-1', null],
      ['1-2', null],
      ['about 2', null],
      ['', null],
      ['1,000', null],
    ] as const) {
      const [result] = await store.db.query('SELECT ingredient_quantity($1)::text AS value', [
        text,
      ]);
      assert.equal(result.value === null ? null : Number(result.value), expected, text);
    }
    await store.index({
      ...second,
      record: { ...second.record, ingredients: [{ name: 'Pepper', quantity: '1' }] },
      rev: '3mabc234567ad',
    });
    await store.index(second);
    assert.deepEqual(await store.ingredientSuggestions('ingredient', 'car'), [
      { value: 'carrots', recipeCount: 1 },
    ]);
    await store.db.query('UPDATE public_recipes SET hidden=true WHERE uri=$1', [uri('first')]);
    assert.deepEqual(await store.ingredientSuggestions('ingredient', 'car'), []);
    assert.deepEqual(await store.ingredientGroups([uri('first')]), []);
    await store.db.query('UPDATE actors SET active=false WHERE did=$1', [did]);
    assert.deepEqual(await store.ingredientSuggestions('ingredient'), []);
    await store.db.query('UPDATE actors SET active=true WHERE did=$1', [did]);
    await store.index({ ...first, rev: '3mabc234567ad', deleted: true });
    const rows = await store.db.query('SELECT * FROM recipe_ingredients WHERE recipe_uri=$1', [
      uri('first'),
    ]);
    assert.equal(rows.length, 0);
    await store.index(first);
    assert.deepEqual(await store.ingredientSuggestions('ingredient', 'car'), []);
  } finally {
    await pg.close();
  }
});

test('ingredient HTTP endpoints expose suggestions, filters and safe grouping with bounded input', async () => {
  const pg = new PGlite();
  let server: ReturnType<ReturnType<typeof createNetworkApp>['listen']> | undefined;
  try {
    for (const name of ['001_network', '003_cookbook', '005_ingredient_index'])
      await migration(pg, name);
    const store = new NetworkStore(adapt(pg));
    await store.index(event('first', [{ name: 'CARROTS', unit: 'CUPS', quantity: '1/2' }]));
    server = createNetworkApp({ origin: 'http://localhost', store, oauth: {} as any }).listen(
      0,
      '127.0.0.1',
    );
    await new Promise<void>((resolve) => server!.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const suggestions = await fetch(`${base}/api/ingredients/suggestions?q=Car`);
    assert.equal(suggestions.status, 200);
    assert.deepEqual(await suggestions.json(), {
      suggestions: [{ value: 'carrots', recipeCount: 1 }],
    });
    const recipes = await (await fetch(`${base}/api/recipes?ingredient=carrots&unit=cups`)).json();
    assert.equal(recipes.recipes.length, 1);
    const group = (uris: string[]) =>
      fetch(`${base}/api/ingredients/group`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uris }),
      });
    const response = await group([uri('first')]);
    assert.equal(response.status, 200);
    assert.equal(Number((await response.json()).groups[0].totalQuantity), 0.5);
    assert.equal((await group([])).status, 400);
    assert.equal((await group(Array(101).fill(uri('first')))).status, 400);
    assert.equal((await group(['invalid'])).status, 400);
    assert.equal((await fetch(`${base}/api/ingredients/suggestions?kind=invalid`)).status, 400);
    assert.equal((await fetch(`${base}/api/ingredients/suggestions?limit=51`)).status, 400);
    assert.equal((await fetch(`${base}/api/recipes?ingredient=`)).status, 400);
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await pg.close();
  }
});
