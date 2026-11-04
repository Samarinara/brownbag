import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createTestDatabase, applyTestMigrations } from './support/database.js';
import { NetworkStore } from '../server/network-store.js';
import { PlannerStore } from '../server/planner.js';
import { PrivateDataStore, privateDataSchema } from '../server/private-data.js';
import { createNetworkApp } from '../server/network-app.js';
import { createRecipeRecord } from '../server/atproto/records.js';
import { RECIPE_COLLECTION } from '../shared/atproto.js';

const alice = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const bob = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
const date = '2099-01-01';
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
const uri = `at://${alice}/${RECIPE_COLLECTION}/pasta`;
const draft = { title: '', ingredients: [], instructions: [] };

async function populate(store: NetworkStore) {
  await store.actor(alice);
  await store.actor(bob);
  await store.index(event);
  await store.saveDraft(alice, draft);
  await store.saveDraft(bob, { ...draft, title: 'Bob secret' });
  await store.saveCookbook(alice, uri, ['Dinner']);
  const planner = new PlannerStore(store);
  await planner.setSettings(alice, 'lunch');
  await planner.add(alice, { id: randomUUID(), uri, date, slot: 'dinner', note: 'Alice secret' });
  await planner.add(bob, { id: randomUUID(), uri, date, slot: 'lunch', note: 'Bob secret' });
  await store.db.query(
    `INSERT INTO shopping_purchases(did,planned_date,item_key,quantity,unspecified)
    VALUES ($1,$2,$3,1.250,$4::text::jsonb)`,
    [alice, date, 'a'.repeat(64), JSON.stringify(['pinch'])],
  );
}

test('migration backfills existing plans and preserves them through public projection rebuilding', async () => {
  const fixture = await createTestDatabase({ versions: [1, 3, 4] });
  const store = new NetworkStore(fixture.db);
  try {
    await store.actor(alice);
    await store.actor(bob);
    await store.index(event);
    const id = randomUUID();
    await fixture.db.query(
      'INSERT INTO meal_entries(id,did,uri,planned_date,slot,note) VALUES ($1,$2,$3,$4,$5,$6)',
      [id, bob, uri, date, 'dinner', 'Keep this'],
    );
    await applyTestMigrations(fixture.db, [9]);
    const [snapshot] = await fixture.db.query(
      'SELECT recipe_cid,recipe_record FROM meal_entries WHERE id=$1',
      [id],
    );
    assert.equal(snapshot.recipe_cid, event.cid);
    assert.equal(snapshot.recipe_record.title, 'Pasta');
    await fixture.db.query('TRUNCATE public_recipes CASCADE');
    const planner = new PlannerStore(store);
    assert.deepEqual(
      (await planner.list(bob, date, date)).map((row) => [
        row.id,
        row.note,
        row.recipe.record.title,
      ]),
      [[id, 'Keep this', 'Pasta']],
    );
    assert.equal((await planner.list(alice, date, date)).length, 0);
    await store.index({ ...event, record: { ...event.record, title: 'Better pasta' }, rev: '003' });
    assert.equal((await planner.list(bob, date, date))[0].recipe.record.title, 'Better pasta');
    await store.index({ ...event, deleted: true, rev: '002' });
    assert.equal(
      (await planner.list(bob, date, date)).length,
      1,
      'stale tombstone cannot remove a meal',
    );
    await store.index({ ...event, deleted: true, rev: '004' });
    assert.equal(
      (await fixture.db.query('SELECT id FROM meal_entries')).length,
      0,
      'accepted deletion retains the existing deletion policy',
    );
  } finally {
    await fixture.close();
  }
});

test('projection fallback preserves moderation visibility and inactive author restrictions', async () => {
  const fixture = await createTestDatabase();
  const store = new NetworkStore(fixture.db);
  try {
    await populate(store);
    const planner = new PlannerStore(store);
    await fixture.db.query('UPDATE public_recipes SET hidden=true WHERE uri=$1', [uri]);
    await fixture.db.query('DELETE FROM public_recipes WHERE uri=$1', [uri]);
    assert.equal((await planner.list(alice, date, date)).length, 0);
    await store.index({ ...event, rev: '002' });
    const [recipe] = await fixture.db.query('SELECT hidden FROM public_recipes WHERE uri=$1', [
      uri,
    ]);
    assert.equal(recipe.hidden, true, 'a rebuilt projection cannot unhide a moderated recipe');
    assert.equal((await planner.list(bob, date, date)).length, 0);
    await fixture.db.query('UPDATE public_recipes SET hidden=false WHERE uri=$1', [uri]);
    await fixture.db.query('DELETE FROM public_recipes WHERE uri=$1', [uri]);
    assert.equal((await planner.list(bob, date, date)).length, 1);
    await fixture.db.query('UPDATE actors SET active=false WHERE did=$1', [alice]);
    assert.equal((await planner.list(bob, date, date)).length, 0);
    assert.equal(
      (await fixture.db.query('SELECT id FROM meal_entries')).length,
      2,
      'restrictions hide rather than erase private plans',
    );
  } finally {
    await fixture.close();
  }
});

test('private export roundtrip is account scoped, exact for quantities, and idempotent', async () => {
  const source = await createTestDatabase();
  const target = await createTestDatabase();
  try {
    const store = new NetworkStore(source.db);
    await populate(store);
    const data = new PrivateDataStore(store);
    await source.db.query(`INSERT INTO oauth_sessions(key,value) VALUES ($1,$2::text::jsonb)`, [
      'sensitive-session',
      JSON.stringify({ token: 'never-export-token' }),
    ]);
    await source.db.query(
      `INSERT INTO agent_keys(id,did,name,hash,prefix) VALUES ($1,$2,'Assistant','never-export-hash','secret')`,
      [randomUUID(), alice],
    );
    const exported = await data.export(alice);
    assert.equal(exported.drafts.length, 1);
    assert.equal(exported.meals.length, 1);
    assert.equal(exported.meals[0].note, 'Alice secret');
    assert.equal(JSON.stringify(exported).includes('Bob secret'), false);
    assert.equal(JSON.stringify(exported).includes('never-export'), false);
    assert.equal(JSON.stringify(exported).includes('recipe_record'), false);
    const targetStore = new NetworkStore(target.db);
    await targetStore.actor(alice);
    await targetStore.actor(bob);
    await targetStore.index(event);
    const restored = new PrivateDataStore(targetStore);
    await restored.restore(bob, exported);
    await restored.restore(bob, exported);
    const after = await restored.export(bob);
    assert.deepEqual(
      { ...after, sourceDid: exported.sourceDid, exportedAt: exported.exportedAt },
      exported,
    );
    assert.equal(
      (await restored.export(alice)).drafts.length,
      0,
      'source DID grants no cross-account access',
    );
    assert.equal((await new PlannerStore(targetStore).list(alice, date, date)).length, 0);
    for (const table of [
      'oauth_sessions',
      'app_sessions',
      'agent_keys',
      'proposals',
      'audit_events',
    ])
      assert.equal((await target.db.query(`SELECT * FROM ${table}`)).length, 0);
    await assert.rejects(
      () => restored.restore(alice, exported),
      (error: any) => error.status === 409,
      'global IDs owned by a different account cannot be overwritten',
    );
  } finally {
    await source.close();
    await target.close();
  }
});

test('restore validates the whole file and rolls back every write on a conflict or unavailable recipe', async () => {
  const fixture = await createTestDatabase();
  const store = new NetworkStore(fixture.db);
  try {
    await populate(store);
    const data = new PrivateDataStore(store);
    const exported = await data.export(alice);
    assert.equal(privateDataSchema.safeParse({ ...exported, version: 2 }).success, false);
    assert.equal(privateDataSchema.safeParse({ ...exported, oauth_sessions: [] }).success, false);
    assert.equal(
      privateDataSchema.safeParse({ ...exported, meals: [exported.meals[0], exported.meals[0]] })
        .success,
      false,
    );
    assert.equal(
      privateDataSchema.safeParse({
        ...exported,
        purchases: [{ ...exported.purchases[0], quantity: '-1' }],
      }).success,
      false,
    );
    const freshDraft = { ...exported.drafts[0], id: randomUUID() };
    const conflict = {
      ...exported,
      drafts: [freshDraft],
      meals: [{ ...exported.meals[0], note: 'Conflicting note' }],
    };
    await assert.rejects(
      () => data.restore(alice, conflict),
      (error: any) => error.status === 409,
    );
    assert.equal(
      (await store.drafts(alice)).length,
      1,
      'early inserts roll back on a late conflict',
    );
    assert.equal((await new PlannerStore(store).list(alice, date, date))[0].note, 'Alice secret');
    const unavailable = {
      ...exported,
      drafts: [freshDraft],
      meals: [{ ...exported.meals[0], id: randomUUID(), uri: uri + 'unknown' }],
    };
    await assert.rejects(
      () => data.restore(alice, unavailable),
      (error: any) => error.status === 409,
    );
    assert.equal((await store.drafts(alice)).length, 1);
    await fixture.db.query('UPDATE public_recipes SET hidden=true WHERE uri=$1', [uri]);
    await assert.rejects(
      () => data.restore(alice, exported),
      (error: any) => error.status === 409,
      'import cannot bypass moderation',
    );
    await fixture.db.query('UPDATE public_recipes SET hidden=false WHERE uri=$1', [uri]);
    await store.index({ ...event, deleted: true, rev: '002' });
    await assert.rejects(
      () => data.restore(alice, exported),
      (error: any) => error.status === 409,
      'import cannot resurrect deleted records',
    );
  } finally {
    await fixture.close();
  }
});

test('private data endpoints require authentication and same-origin restore requests', async () => {
  const fixture = await createTestDatabase();
  const store = new NetworkStore(fixture.db);
  await populate(store);
  await fixture.db.query(
    `INSERT INTO app_sessions(hash,did,expires_at) VALUES ($1,$2,now()+interval '1 hour')`,
    [createHash('sha256').update('alice-token').digest('hex'), alice],
  );
  const app = createNetworkApp({ origin: 'http://localhost', store, oauth: {} as any });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/private-data`;
  const headers = { cookie: 'brownbag_session=alice-token', 'Content-Type': 'application/json' };
  try {
    assert.equal((await fetch(base + '/export')).status, 401);
    assert.equal(
      (
        await fetch(base + '/restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
      401,
    );
    const response = await fetch(base + '/export', { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('content-disposition')!, /attachment/);
    const body = JSON.stringify(await response.json());
    assert.equal(
      (
        await fetch(base + '/restore', {
          method: 'POST',
          headers: { ...headers, origin: 'https://foreign.example' },
          body,
        })
      ).status,
      403,
    );
    assert.equal((await fetch(base + '/restore', { method: 'POST', headers, body })).status, 200);
    assert.equal(
      (await fetch(base + '/restore', { method: 'POST', headers, body: '{}' })).status,
      400,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fixture.close();
  }
});
