import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import type { Database } from '../server/db.js';
import { NetworkStore } from '../server/network-store.js';
import { createNetworkApp } from '../server/network-app.js';
import { createRecipeRecord } from '../server/atproto/records.js';
import { RECIPE_COLLECTION, FOLLOW_COLLECTION } from '../shared/atproto.js';
import { createHash } from 'node:crypto';

const alice = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const bob = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
const cid = 'bafyre' + 'a'.repeat(53);
const input = {
  title: 'Lemon pasta',
  ingredients: [{ name: 'spaghetti', quantity: '1/2' }],
  instructions: [{ text: 'Cook and enjoy.' }],
};
const record = createRecipeRecord(input, undefined, '2026-01-01T00:00:00.000Z');
const uri = `at://${alice}/${RECIPE_COLLECTION}/3mabc234567ab`;
const adapt = (pg: any): Database => ({
  query: async (text, params = []) => (await pg.query(text, params)).rows,
  transaction: (fn) => pg.transaction((tx: any) => fn(adapt(tx))),
});

test('PostgreSQL projections preserve newest revision, deletions, privacy and feed ownership', async () => {
  const pg = new PGlite();
  try {
    await pg.exec(
      await readFile(new URL('../migrations/001_network.sql', import.meta.url), 'utf8'),
    );
    await pg.exec(
      await readFile(new URL('../migrations/003_cookbook.sql', import.meta.url), 'utf8'),
    );
    const store = new NetworkStore(adapt(pg));
    await store.actor(alice, 'alice.example');
    await store.actor(bob, 'bob.example');
    const event = {
      did: alice,
      collection: RECIPE_COLLECTION,
      rkey: '3mabc234567ab',
      cid,
      record,
      rev: '3mabc234567ac',
    };
    await store.index(event);
    await store.index(event);
    assert.equal((await store.recipes()).recipes.length, 1);
    await store.index({ ...event, rev: '3mabc234567ab', record: { ...record, title: 'Stale' } });
    assert.equal((await store.recipe(uri)).record.title, 'Lemon pasta');
    assert.equal((await store.recipes({ q: 'spaghetti' })).recipes.length, 1);
    assert.equal((await store.recipes({ feed: 'mine', did: bob })).recipes.length, 0);
    await store.index({
      did: bob,
      collection: FOLLOW_COLLECTION,
      rkey: 'edge',
      cid,
      record: { $type: FOLLOW_COLLECTION, subject: alice, createdAt: record.createdAt },
      rev: '3mabc234567ac',
    });
    assert.equal((await store.recipes({ feed: 'following', did: bob })).recipes.length, 1);
    const draft = await store.saveDraft(alice, {
      title: '',
      ingredients: [{ name: '' }],
      instructions: [{ text: '' }],
    });
    assert.equal((await store.drafts(bob)).length, 0);
    await assert.rejects(() => store.saveDraft(bob, input, draft.id), /Draft not found/);
    await store.db.query('UPDATE actors SET active=false WHERE did=$1', [alice]);
    assert.equal((await store.recipes()).recipes.length, 0);
    await store.db.query('UPDATE actors SET active=true WHERE did=$1', [alice]);
    await store.index({ ...event, rev: '3mabc234567ad', deleted: true });
    await store.index(event);
    assert.equal(
      (await store.recipes()).recipes.length,
      0,
      'stale create cannot resurrect deletion',
    );
    await store.rateLimit('test', 1);
    await assert.rejects(() => store.rateLimit('test', 1), /Too many/);
  } finally {
    await pg.close();
  }
});

test('HTTP routes allow public reads but reject foreign origins, private reads and cross-owner writes', async () => {
  const pg = new PGlite();
  await pg.exec(await readFile(new URL('../migrations/001_network.sql', import.meta.url), 'utf8'));
  await pg.exec(await readFile(new URL('../migrations/003_cookbook.sql', import.meta.url), 'utf8'));
  const store = new NetworkStore(adapt(pg));
  await store.actor(alice);
  await store.actor(bob);
  await store.index({
    did: alice,
    collection: RECIPE_COLLECTION,
    rkey: '3mabc234567ab',
    cid,
    record,
    rev: '3mabc234567ac',
  });
  await store.db.query(
    "INSERT INTO app_sessions(hash,did,expires_at) VALUES ($1,$2,now()+interval '1 day')",
    [createHash('sha256').update('bob-session').digest('hex'), bob],
  );
  const app = createNetworkApp({
    origin: 'http://127.0.0.1',
    store,
    oauth: {
      agent: async () => {
        throw new Error('Must never access PDS for foreign recipe');
      },
    } as any,
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}`;
  try {
    assert.equal((await fetch(`${base}/api/recipes`)).status, 200);
    assert.equal((await fetch(`${base}/api/drafts`)).status, 401);
    assert.equal((await fetch(`${base}/api/recipes?feed=saved`)).status, 401);
    const headers = { 'Content-Type': 'application/json', cookie: 'brownbag_session=bob-session' };
    assert.equal(
      (
        await fetch(`${base}/api/bookmarks`, {
          method: 'POST',
          headers: { ...headers, Origin: 'https://evil.example' },
          body: JSON.stringify({ uri }),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${base}/api/recipe`, {
          method: 'DELETE',
          headers,
          body: JSON.stringify({ uri, cid }),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${base}/api/bookmarks`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ uri }),
        })
      ).status,
      200,
    );
    const saved = await (await fetch(`${base}/api/recipes?feed=saved`, { headers })).json();
    assert.equal(saved.recipes.length, 1);
    const tagsResponse = await fetch(`${base}/api/cookbook/tags`, { headers });
    assert.deepEqual((await tagsResponse.json()).tags, ['Breakfast', 'Lunch', 'Dinner', 'Snack']);
    assert.equal((await fetch(`${base}/api/cookbook/tags`)).status, 401);
    assert.equal(
      (await fetch(`${base}/api/cookbook/entry?uri=${encodeURIComponent(uri)}`)).status,
      401,
    );
    for (const tags of [['x'.repeat(26)], ['   ']]) {
      assert.equal(
        (
          await fetch(`${base}/api/bookmarks`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ uri, tags }),
          })
        ).status,
        400,
      );
    }
    assert.equal(
      (
        await fetch(`${base}/api/bookmarks`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ uri, tags: ['x'.repeat(25)] }),
        })
      ).status,
      200,
    );
    const entryResponse = await fetch(`${base}/api/cookbook/entry?uri=${encodeURIComponent(uri)}`, {
      headers,
    });
    assert.equal(entryResponse.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(await entryResponse.json(), { saved: true, tags: ['x'.repeat(25)] });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pg.close();
  }
});

test('cookbook combines posts and saves, persists private tags, paginates and respects removals', async () => {
  const pg = new PGlite();
  try {
    for (const file of ['001_network.sql', '003_cookbook.sql'])
      await pg.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
    const store = new NetworkStore(adapt(pg));
    await store.actor(alice);
    await store.actor(bob);
    await store.index({
      did: alice,
      collection: RECIPE_COLLECTION,
      rkey: '3mabc234567ab',
      cid,
      record,
      rev: '3mabc234567ac',
    });
    const bobUri = `at://${bob}/${RECIPE_COLLECTION}/3mabc234567ab`;
    await store.index({
      did: bob,
      collection: RECIPE_COLLECTION,
      rkey: '3mabc234567ab',
      cid,
      record: { ...record, title: 'Breakfast toast' },
      rev: '3mabc234567ac',
    });
    assert.deepEqual(await store.cookbookEntry(alice, uri), { saved: true, tags: [] });
    assert.equal((await store.recipes({ feed: 'cookbook', did: alice })).recipes.length, 1);
    await store.saveCookbook(alice, bobUri, ['Breakfast', 'Quick']);
    const first = await store.recipes({ feed: 'cookbook', did: alice, limit: 1 });
    assert.equal(first.recipes[0].uri, bobUri);
    assert.deepEqual(first.recipes[0].cookbookTags, ['Breakfast', 'Quick']);
    assert.ok(first.nextCursor);
    assert.equal(
      (await store.recipes({ feed: 'cookbook', did: alice, limit: 1, cursor: first.nextCursor }))
        .recipes[0].uri,
      uri,
    );
    assert.equal(
      (await store.recipes({ feed: 'cookbook', did: alice, tag: 'Quick', q: 'toast' })).recipes
        .length,
      1,
    );
    assert.equal(
      (await store.recipes({ feed: 'cookbook', did: bob, tag: 'Quick' })).recipes.length,
      0,
    );
    await store.saveCookbook(alice, bobUri, ['Lunch']);
    assert.equal(
      (await store.recipes({ feed: 'cookbook', did: alice, tag: 'Quick' })).recipes.length,
      0,
    );
    assert.equal(
      (await store.recipes({ feed: 'cookbook', did: alice })).recipes[0].cookbookAddedAt,
      first.recipes[0].cookbookAddedAt,
    );
    await store.saveCookbook(alice, uri, ['Dinner']);
    assert.equal(
      (await store.recipes({ feed: 'cookbook', did: alice })).recipes.length,
      2,
      'own posts are not duplicated',
    );
    await store.removeCookbook(alice, uri);
    assert.equal((await store.cookbookEntry(alice, uri)).saved, false);
    assert.equal((await store.recipes({ feed: 'cookbook', did: alice })).recipes.length, 1);
    assert.equal(
      (await store.recipe(uri)).record.title,
      input.title,
      'removing own post does not unpublish it',
    );
    await store.removeCookbook(alice, bobUri);
    assert.equal((await store.recipes({ feed: 'cookbook', did: alice })).recipes.length, 0);
    await store.saveCookbook(alice, uri, []);
    assert.equal((await store.cookbookEntry(alice, uri)).saved, true);
    assert.deepEqual(await store.cookbookEntry(bob, bobUri), { saved: true, tags: [] });
  } finally {
    await pg.close();
  }
});
