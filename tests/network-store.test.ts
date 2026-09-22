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
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pg.close();
  }
});

test('photo uploads enforce sessions, origins, formats and size and serialize SDK blob references', async () => {
  const { BlobRef } = await import('@atproto/lexicon');
  const { jsonToIpld } = await import('@atproto/common-web');
  const pg = new PGlite();
  await pg.exec(await readFile(new URL('../migrations/001_network.sql', import.meta.url), 'utf8'));
  const store = new NetworkStore(adapt(pg));
  await store.actor(alice);
  await store.db.query(
    "INSERT INTO app_sessions(hash,did,expires_at) VALUES ($1,$2,now()+interval '1 day')",
    [createHash('sha256').update('photo-session').digest('hex'), alice],
  );
  let uploads = 0;
  const blob = {
    $type: 'blob',
    ref: { $link: 'bafkrei' + 'a'.repeat(52) },
    mimeType: 'image/png',
    size: 8,
  };
  const app = createNetworkApp({
    origin: 'http://127.0.0.1',
    store,
    oauth: {
      agent: async (did: string) => {
        assert.equal(did, alice);
        return {
          uploadBlob: async (bytes: Buffer, options: { encoding: string }) => {
            uploads++;
            assert.equal(options.encoding, 'image/png');
            assert.equal(bytes.length, 8);
            return { data: { blob: BlobRef.fromJsonRef(jsonToIpld(blob) as any) } };
          },
        };
      },
    } as any,
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const headers = { 'Content-Type': 'image/png', cookie: 'brownbag_session=photo-session' };
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  try {
    assert.equal(
      (
        await fetch(`${base}/api/images`, {
          method: 'POST',
          headers: { 'Content-Type': 'image/png' },
          body: bytes,
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await fetch(`${base}/api/images`, {
          method: 'POST',
          headers: { ...headers, Origin: 'https://elsewhere.example' },
          body: bytes,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${base}/api/images`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'image/svg+xml' },
          body: '<svg/>',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(`${base}/api/images`, {
          method: 'POST',
          headers,
          body: new Uint8Array(5_000_001),
        })
      ).status,
      413,
    );
    const response = await fetch(`${base}/api/images`, { method: 'POST', headers, body: bytes });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { image: blob });
    assert.equal(uploads, 1);
    const largeRecipe = {
      ...input,
      instructions: Array.from({ length: 64 }, () => ({ text: 'a'.repeat(10000) })),
    };
    const draft = await fetch(`${base}/api/drafts`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: largeRecipe }),
    });
    assert.equal(draft.status, 201, 'A lexicon-valid long recipe can be saved');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pg.close();
  }
});
