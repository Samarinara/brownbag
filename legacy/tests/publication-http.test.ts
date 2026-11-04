import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createTestDatabase } from './support/database.js';
import { createNetworkApp } from '../server/network-app.js';
import { NetworkStore } from '../server/network-store.js';
import type { OAuthService } from '../server/atproto/oauth.js';

test('operation status is account-scoped, excludes private intent, and distinguishes conflicts from busy operations', async () => {
  const { pg, db } = await createTestDatabase();
  const store = new NetworkStore(db);
  const alice = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
  const bob = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
  await store.actor(alice);
  await store.actor(bob);
  for (const [did, token] of [
    [alice, 'alice-session'],
    [bob, 'bob-session'],
  ])
    await db.query(
      "INSERT INTO app_sessions(hash,did,expires_at) VALUES ($1,$2,now()+interval '1 hour')",
      [createHash('sha256').update(token).digest('hex'), did],
    );
  const key = '00000000-0000-4000-8000-000000000008';
  await db.query(
    `INSERT INTO publication_operations(did,operation_key,action,payload_hash,payload,rkey,status,last_error)
    VALUES ($1,$2,'create','fingerprint',$3::text::jsonb,'target','conflict','private failure detail')`,
    [alice, key, JSON.stringify({ title: 'Private intention' })],
  );
  const server = createNetworkApp({
    origin: 'http://127.0.0.1',
    store,
    oauth: {} as OAuthService,
  }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/publication-operations/${key}`;
  try {
    assert.equal((await fetch(url)).status, 401);
    assert.equal(
      (await fetch(url, { headers: { cookie: 'brownbag_session=bob-session' } })).status,
      404,
    );
    const response = await fetch(url, { headers: { cookie: 'brownbag_session=alice-session' } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'conflict' });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    await db.query(
      "UPDATE publication_operations SET status='pending',lease_until=now()+interval '1 minute' WHERE did=$1 AND operation_key=$2",
      [alice, key],
    );
    assert.deepEqual(
      await (await fetch(url, { headers: { cookie: 'brownbag_session=alice-session' } })).json(),
      { status: 'pending' },
    );
    await db.query(
      "UPDATE publication_operations SET status='uncertain',attempted=true WHERE did=$1 AND operation_key=$2",
      [alice, key],
    );
    assert.deepEqual(
      await (await fetch(url, { headers: { cookie: 'brownbag_session=alice-session' } })).json(),
      { status: 'uncertain' },
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await pg.close();
  }
});
