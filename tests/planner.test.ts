import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { PGlite } from '@electric-sql/pglite';
import { NetworkStore } from '../server/network-store.js';
import { PlannerStore, pruneMealPlans } from '../server/planner.js';
import { createNetworkApp } from '../server/network-app.js';
import { createRecipeRecord } from '../server/atproto/records.js';
import { RECIPE_COLLECTION } from '../shared/atproto.js';
import {
  addDays,
  calendarDateSchema,
  localDate,
  retentionStart,
  weekStart,
} from '../shared/planner.js';
import type { Database } from '../server/db.js';

test('planner calendar arithmetic validates dates and starts weeks on Sunday', () => {
  assert.equal(weekStart('2026-09-24'), '2026-09-20');
  assert.equal(weekStart('2026-09-20'), '2026-09-20');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(calendarDateSchema.safeParse('2026-02-29').success, false);
  assert.equal(calendarDateSchema.safeParse('2028-02-29').success, true);
  assert.equal(retentionStart(new Date('2026-03-31T00:00:00Z')), '2026-02-28');
  assert.equal(retentionStart(new Date('2028-03-31T00:00:00Z')), '2028-02-29');
});

test('private planner APIs preserve duplicates, notes, order, settings and retention; recipe deletion cascades', async () => {
  const pg = new PGlite();
  const adapt = (pg: any): Database => ({
    query: async (sql, params = []) => (await pg.query(sql, params)).rows,
    transaction: (fn) => pg.transaction((tx: any) => fn(adapt(tx))),
  });
  for (const name of ['001_network', '003_cookbook', '004_meal_planner'])
    await pg.exec(await readFile(new URL(`../migrations/${name}.sql`, import.meta.url), 'utf8'));
  const store = new NetworkStore(adapt(pg));
  const planner = new PlannerStore(store);
  const alice = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
  const bob = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
  await store.actor(alice);
  await store.actor(bob);
  const uri = `at://${alice}/${RECIPE_COLLECTION}/pasta`;
  const event = {
    did: alice,
    collection: RECIPE_COLLECTION,
    rkey: 'pasta',
    cid: 'bafyre' + 'a'.repeat(53),
    rev: '001',
    record: createRecipeRecord({
      title: 'Pasta',
      ingredients: [{ name: 'pasta' }],
      instructions: [{ text: 'Boil.' }],
    }),
  };
  await store.index(event);
  for (const [token, did] of [
    ['alice-token', alice],
    ['bob-token', bob],
  ])
    await store.db.query(
      "INSERT INTO app_sessions(hash,did,expires_at) VALUES ($1,$2,now()+interval '1 hour')",
      [createHash('sha256').update(token).digest('hex'), did],
    );
  const app = createNetworkApp({ origin: 'http://localhost', store, oauth: {} as any });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const request = (
    path: string,
    token = 'alice-token',
    method = 'GET',
    body?: unknown,
    origin?: string,
  ) =>
    fetch(root + path, {
      method,
      headers: {
        ...(token ? { cookie: `brownbag_session=${token}` } : {}),
        'Content-Type': 'application/json',
        ...(origin ? { origin } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const date = localDate();
  const path = `/planner?from=${date}&to=${addDays(date, 6)}`;
  try {
    assert.equal((await request(path, '')).status, 401);
    assert.equal((await request('/planner/settings', '')).status, 401);
    assert.deepEqual(await (await request('/planner/settings')).json(), { defaultSlot: 'dinner' });
    assert.equal(
      (await request('/planner/settings', 'alice-token', 'PUT', { defaultSlot: 'lunch' })).status,
      200,
    );
    assert.deepEqual(await planner.settings(alice), { defaultSlot: 'lunch' });
    assert.deepEqual(await planner.settings(bob), { defaultSlot: 'dinner' });
    const first = { id: randomUUID(), uri, date, slot: 'dinner', note: 'Make extra sauce' };
    assert.equal(
      (await request('/planner', 'alice-token', 'POST', first, 'https://foreign.example')).status,
      403,
    );
    assert.equal((await request('/planner', 'alice-token', 'POST', first)).status, 201);
    assert.equal(
      (await request('/planner', 'alice-token', 'POST', first)).status,
      201,
      'safe retry does not duplicate',
    );
    const second = { ...first, id: randomUUID(), note: 'For tomorrow' };
    assert.equal((await request('/planner', 'alice-token', 'POST', second)).status, 201);
    const third = { ...first, id: randomUUID() };
    assert.equal(
      (await request('/planner', 'bob-token', 'POST', third)).status,
      201,
      'any public recipe can be planned without bookmarking',
    );
    let list = await (await request(path)).json();
    assert.deepEqual(
      list.entries.map((entry: any) => entry.id),
      [first.id, second.id],
    );
    assert.equal(list.entries[0].note, first.note);
    assert.equal((await (await request(path, 'bob-token')).json()).entries.length, 1);
    assert.equal(
      (await request(`/planner/${first.id}`, 'bob-token', 'PATCH', { note: 'stolen' })).status,
      404,
    );
    assert.equal((await request(`/planner/${first.id}`, 'bob-token', 'DELETE')).status, 404);
    assert.equal((await request('/planner', 'bob-token', 'POST', first)).status, 409);
    assert.equal(
      (
        await request(`/planner/${first.id}`, 'alice-token', 'PATCH', {
          date: addDays(date, 1),
          slot: 'lunch',
          note: 'Pack it',
        })
      ).status,
      200,
    );
    list = await (await request(path)).json();
    assert.equal(list.entries.find((entry: any) => entry.id === first.id).slot, 'lunch');
    assert.equal(
      (await request(`/planner/${first.id}`, 'alice-token', 'PATCH', { date, slot: 'dinner' }))
        .status,
      200,
    );
    assert.deepEqual(
      (await planner.list(alice, date, date)).map((entry) => entry.id),
      [first.id, second.id],
      'moving preserves insertion order',
    );
    assert.equal(
      (
        await request('/planner', 'alice-token', 'POST', {
          ...first,
          id: randomUUID(),
          date: '2026-02-30',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request('/planner', 'alice-token', 'POST', {
          ...first,
          id: randomUUID(),
          date: '2000-01-01',
        })
      ).status,
      400,
    );
    assert.equal(
      (await request(`/planner/${first.id}`, 'alice-token', 'PATCH', { note: 'x'.repeat(2001) }))
        .status,
      400,
    );
    const future = { ...first, id: randomUUID(), date: '2099-01-01' };
    assert.equal((await request('/planner', 'alice-token', 'POST', future)).status, 201);
    const expired = randomUUID();
    await store.db.query(
      "INSERT INTO meal_entries(id,did,uri,planned_date,slot) VALUES ($1,$2,$3,'2000-01-01','other')",
      [expired, bob, uri],
    );
    const boundary = randomUUID();
    await store.db.query(
      "INSERT INTO meal_entries(id,did,uri,planned_date,slot) VALUES ($1,$2,$3,((now() AT TIME ZONE 'UTC')::date - interval '1 month')::date,'other')",
      [boundary, bob, uri],
    );
    await pruneMealPlans(store.db);
    assert.equal(
      (await store.db.query('SELECT id FROM meal_entries WHERE id=$1', [expired])).length,
      0,
    );
    assert.equal(
      (await store.db.query('SELECT id FROM meal_entries WHERE id=$1', [boundary])).length,
      1,
    );
    assert.equal((await planner.list(alice, '2099-01-01', '2099-01-01')).length, 1);
    assert.equal((await request(`/planner/${second.id}`, 'alice-token', 'DELETE')).status, 200);
    await store.index({ ...event, deleted: true, rev: '002' });
    assert.equal(
      (await store.db.query('SELECT id FROM meal_entries')).length,
      0,
      'deleting recipe removes every past and future reference',
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pg.close();
  }
});
