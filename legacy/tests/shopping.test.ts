import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createTestDatabase } from './support/database.js';
import { NetworkStore } from '../server/network-store.js';
import { PlannerStore } from '../server/planner.js';
import { ShoppingStore } from '../server/shopping.js';
import { createNetworkApp } from '../server/network-app.js';
import { createRecipeRecord } from '../server/atproto/records.js';
import { RECIPE_COLLECTION } from '../shared/atproto.js';
import { addDays, localDate } from '../shared/planner.js';
import { shoppingRangeSchema, type ShoppingList } from '../shared/shopping.js';

test('shopping ranges default to seven inclusive days and reject invalid bounds', () => {
  assert.equal(shoppingRangeSchema.parse({ from: '2026-12-30' }).days, 7);
  for (const days of [0, 94, 1.5, 'x']) {
    assert.equal(shoppingRangeSchema.safeParse({ from: '2026-12-30', days }).success, false);
  }
});

test('shopping APIs combine every meal, convert units, and persist private range checks safely', async () => {
  const { pg, db } = await createTestDatabase();
  const store = new NetworkStore(db);
  const planner = new PlannerStore(store);
  const shopping = new ShoppingStore(store);
  const alice = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
  const bob = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
  await store.actor(alice);
  await store.actor(bob);
  const event = (
    rkey: string,
    ingredients: { name: string; quantity?: string; unit?: string }[],
  ) => ({
    did: alice,
    collection: RECIPE_COLLECTION,
    rkey,
    cid: 'bafyre' + 'a'.repeat(53),
    rev: '001',
    record: createRecipeRecord({ title: rkey, ingredients, instructions: [{ text: 'Cook.' }] }),
  });
  const first = event('soup', [
    { name: '  CARROTS ', quantity: '5' },
    { name: 'rice', quantity: '1/2', unit: 'kg' },
    { name: 'oil', quantity: '1½', unit: 'tbsp' },
    { name: 'salt', quantity: 'to taste' },
    { name: 'herbs' },
    { name: 'beans', quantity: '1', unit: 'can' },
    { name: 'milk', quantity: '1', unit: 'cup' },
    { name: 'milk', quantity: '100', unit: 'g' },
    { name: 'pepper', quantity: '1–2', unit: 'tsp' },
    { name: 'zero', quantity: '0' },
    { name: 'precise', quantity: '9007199254740993', unit: 'g' },
  ]);
  const second = event('salad', [
    { name: 'carrots', quantity: '5', unit: 'each' },
    { name: 'RICE', quantity: '250', unit: 'grams' },
    { name: 'oil', quantity: '1.5', unit: 'teaspoons' },
    { name: 'salt', quantity: '1' },
    { name: 'beans', quantity: '2', unit: 'CANS' },
    { name: 'milk', quantity: '100', unit: 'ml' },
  ]);
  await store.index(first);
  await store.index(second);
  const uri = (rkey: string) => `at://${alice}/${RECIPE_COLLECTION}/${rkey}`;
  const from = localDate();
  async function plan(did: string, rkey: string, offset: number) {
    const id = randomUUID();
    await planner.add(did, { id, uri: uri(rkey), date: addDays(from, offset), slot: 'dinner' });
    return id;
  }
  const soup1 = await plan(alice, 'soup', 0);
  const soup2 = await plan(alice, 'soup', 6);
  await plan(alice, 'salad', 2);
  await plan(alice, 'salad', -1);
  await plan(alice, 'salad', 7);
  await plan(bob, 'salad', 0);
  for (const [token, did] of [
    ['alice-token', alice],
    ['bob-token', bob],
  ]) {
    await store.db.query(
      "INSERT INTO app_sessions(hash,did,expires_at) VALUES ($1,$2,now()+interval '1 hour')",
      [createHash('sha256').update(token).digest('hex'), did],
    );
  }
  const app = createNetworkApp({ origin: 'http://localhost', store, oauth: {} as any });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/planner/shopping-list`;
  const request = (
    suffix: string,
    token = 'alice-token',
    method = 'GET',
    body?: unknown,
    origin?: string,
  ) =>
    fetch(root + suffix, {
      method,
      headers: {
        ...(token ? { cookie: `brownbag_session=${token}` } : {}),
        'Content-Type': 'application/json',
        ...(origin ? { origin } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const query = `?from=${from}&days=7`;
  try {
    assert.equal((await request(query, '')).status, 401);
    for (const days of ['0', '94', '1.5', 'nope'])
      assert.equal((await request(`?from=${from}&days=${days}`)).status, 400);
    assert.equal((await request('?from=2026-02-30')).status, 400);
    const list: ShoppingList = await (await request(query)).json();
    const routedResponse = await request(query + '&path=planner%2Fshopping-list');
    assert.equal(routedResponse.status, 200, 'routing metadata does not reject a valid range');
    assert.deepEqual(await routedResponse.json(), list);
    const defaultRangeResponse = await request(`?from=${from}&path=planner%2Fshopping-list`);
    assert.equal(defaultRangeResponse.status, 200);
    assert.deepEqual(await defaultRangeResponse.json(), list);
    assert.equal(
      (await request(`?from=${from}&days=0&path=planner%2Fshopping-list`)).status,
      400,
      'routing metadata does not bypass range validation',
    );
    assert.equal(list.to, addDays(from, 6));
    assert.equal(list.mealCount, 3);
    const item = (ingredient: string, unit = '') =>
      list.items.find((i) => i.ingredient === ingredient && i.unit === unit)!;
    assert.equal(item('carrots').quantity, '15');
    assert.equal(item('rice', 'g').quantity, '1250');
    assert.equal(item('oil', 'ml').quantity, '51.753676734375');
    assert.equal(item('milk', 'ml').quantity, '573.176473');
    assert.equal(item('milk', 'g').quantity, '200');
    assert.equal(item('beans', 'can').quantity, '2');
    assert.equal(item('beans', 'cans').quantity, '2', 'unrecognized units remain separate');
    assert.equal(
      item('precise', 'g').quantity,
      '18014398509481986',
      'database totals preserve numeric precision',
    );
    assert.equal(item('zero').quantity, '0');
    assert.equal(item('salt').quantity, '1');
    assert.deepEqual(item('salt').unspecified, ['to taste', 'to taste']);
    assert.equal(item('herbs').quantity, null);
    assert.deepEqual(item('herbs').unspecified, ['Amount not specified', 'Amount not specified']);
    assert.deepEqual(item('pepper', 'ml').unspecified, ['1–2 tsp', '1–2 tsp']);
    const carrots = item('carrots');
    const check = {
      from,
      days: 7,
      key: carrots.key,
      fingerprint: carrots.fingerprint,
      checked: true,
    };
    assert.equal(
      (
        await request('/check', 'alice-token', 'PUT', {
          ...check,
          path: 'planner/shopping-list/check',
        })
      ).status,
      400,
      'purchase bodies still reject unrecognized fields',
    );
    const salt = item('salt');
    await shopping.setChecked(alice, { ...check, key: salt.key, fingerprint: salt.fingerprint });
    const nextDaySalt = (await shopping.list(alice, addDays(from, 1), 6)).items.find(
      (i) => i.groupKey === salt.groupKey,
    )!;
    assert.equal(nextDaySalt.checked, true);
    assert.equal(nextDaySalt.quantity, '1');
    assert.deepEqual(
      nextDaySalt.unspecified,
      ['to taste'],
      'unspecified purchases also expire with their meal date',
    );
    const carrotRows = (list: ShoppingList) =>
      list.items.filter((i) => i.groupKey === carrots.groupKey);
    assert.equal((await request('/check', '', 'PUT', check)).status, 401);
    assert.equal(
      (await request('/check', 'alice-token', 'PUT', check, 'https://foreign.example')).status,
      403,
    );
    assert.equal(
      (await request('/check', 'bob-token', 'PUT', check)).status,
      409,
      'another account cannot tick this total',
    );
    const boughtResponse = await request('/check', 'alice-token', 'PUT', check);
    assert.equal(boughtResponse.status, 200);
    const bought: ShoppingList = await boughtResponse.json();
    assert.equal(carrotRows(bought)[0].checked, true);
    const reloaded = new ShoppingStore(new NetworkStore(store.db));
    assert.equal(carrotRows(await reloaded.list(alice, from, 7))[0].checked, true);
    assert.equal(carrotRows(await reloaded.list(bob, from, 7))[0].checked, false);
    assert.equal(
      carrotRows(await reloaded.list(alice, from, 6))[0].checked,
      true,
      'overlapping ranges share purchased quantities',
    );
    const nextDay = carrotRows(await reloaded.list(alice, addDays(from, 1), 6));
    assert.deepEqual(
      nextDay.map((i) => [i.quantity, i.checked]),
      [['10', true]],
      'past-day requirements and their purchased credits disappear together',
    );
    await planner.update(alice, soup1, { note: 'Serve hot.' });
    assert.equal(carrotRows(await shopping.list(alice, from, 7))[0].checked, true);
    const newMeal = await plan(alice, 'salad', 3);
    let rows = carrotRows(await shopping.list(alice, from, 7));
    assert.deepEqual(
      rows.map((i) => [i.quantity, i.checked]),
      [
        ['15', true],
        ['5', false],
      ],
      'new requirements appear as only the difference',
    );
    assert.equal(
      (await request('/check', 'alice-token', 'PUT', check)).status,
      409,
      'stale snapshots cannot purchase changed quantities',
    );
    const extra = rows.find((i) => !i.checked)!;
    await shopping.setChecked(alice, { ...check, key: extra.key, fingerprint: extra.fingerprint });
    assert.deepEqual(
      carrotRows(await shopping.list(alice, from, 7)).map((i) => [i.quantity, i.checked]),
      [['20', true]],
    );
    const afterAddedMeal = carrotRows(await shopping.list(alice, addDays(from, 4), 3));
    assert.deepEqual(
      afterAddedMeal.map((i) => [i.quantity, i.checked]),
      [['5', true]],
      'each new purchase expires with the meal it was bought for',
    );
    await planner.remove(alice, newMeal);
    await planner.remove(alice, soup2);
    rows = carrotRows(await shopping.list(alice, from, 7));
    assert.deepEqual(
      rows.map((i) => [i.quantity, i.checked]),
      [['10', true]],
      'decreases stay checked',
    );
    await plan(alice, 'soup', 6);
    await plan(alice, 'salad', 4);
    assert.deepEqual(
      carrotRows(await shopping.list(alice, from, 7)).map((i) => [i.quantity, i.checked]),
      [['20', true]],
      'unused purchases cover requirements added before expiry',
    );
    await store.index({
      ...first,
      rev: '002',
      record: { ...first.record, ingredients: [{ name: 'carrots', quantity: '6' }] },
    });
    rows = carrotRows(await shopping.list(alice, from, 7));
    assert.deepEqual(
      rows.map((i) => [i.quantity, i.checked]),
      [
        ['20', true],
        ['2', false],
      ],
      'recipe edits preserve purchases and expose only increased quantities',
    );
    const checkedRow = rows.find((i) => i.checked)!;
    await shopping.setChecked(alice, {
      ...check,
      key: checkedRow.key,
      fingerprint: checkedRow.fingerprint,
      checked: false,
    });
    assert.deepEqual(
      carrotRows(await shopping.list(alice, from, 7)).map((i) => [i.quantity, i.checked]),
      [['22', false]],
      'unchecking removes purchase credits',
    );
    await store.db.query('UPDATE public_recipes SET hidden=true WHERE uri=$1', [uri('soup')]);
    assert.equal((await shopping.list(alice, from, 7)).mealCount, 2);
    await store.db.query('UPDATE actors SET active=false WHERE did=$1', [alice]);
    assert.deepEqual((await shopping.list(bob, from, 7)).items, []);
    await store.db.query('UPDATE actors SET active=true WHERE did=$1', [alice]);
    await store.index({ ...second, rev: '002', deleted: true });
    assert.deepEqual((await shopping.list(alice, from, 7)).items, []);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pg.close();
  }
});
