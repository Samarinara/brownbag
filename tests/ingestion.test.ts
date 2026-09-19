import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ingestEvent, jetstreamUrl, persistCursor } from '../server/atproto/ingestion.js';
import { createRecipeRecord } from '../server/atproto/records.js';
import { RECIPE_COLLECTION } from '../shared/atproto.js';
import type { Database } from '../server/db.js';
import { reconcileRepository, type ReconciliationAgent } from '../server/atproto/reconcile.js';

const did = 'did:plc:abcdefghijklmnopqrstuvwx';
function fakeDb(fail = false) {
  const calls: { sql: string; params: any[] }[] = [];
  const db: Database = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (fail) throw new Error('Database unavailable');
      return [] as any;
    },
    async transaction(fn) {
      return fn(db);
    },
  };
  return { db, calls };
}
test('unknown account and identity traffic does not wake the database', async () => {
  const { db, calls } = fakeDb();
  for (const kind of ['identity', 'account']) {
    const result = await ingestEvent(
      db,
      { did, kind, time_us: 100, account: { active: false } },
      'test',
      new Set(),
    );
    assert.equal(result.applied, false);
    assert.equal(result.cursor, 100);
  }
  assert.equal(calls.length, 0);
});
test('known lifecycle events are time guarded and handles are invalidated', async () => {
  const { db, calls } = fakeDb();
  const known = new Set([did]);
  await ingestEvent(
    db,
    { did, kind: 'account', time_us: 100, account: { active: false } },
    'test',
    known,
  );
  assert.match(calls[0].sql, /status_time<\$3/);
  assert.deepEqual(calls[0].params, [did, false, 100]);
  await ingestEvent(
    db,
    { did, kind: 'identity', time_us: 200, identity: { handle: 'unverified.example' } },
    'test',
    known,
  );
  assert.match(calls[1].sql, /handle=NULL/);
  assert.match(calls[1].sql, /identity_time<\$2/);
  assert.equal(calls[1].params.includes('unverified.example'), false);
});
test('invalid records become replayable dead letters before cursor acknowledgement', async () => {
  const { db, calls } = fakeDb();
  const value = {
    did,
    kind: 'commit',
    time_us: 100,
    commit: {
      operation: 'create',
      collection: RECIPE_COLLECTION,
      rkey: '3mabcdefg2345',
      rev: '3mabcdefg2345',
      cid: 'bafyre' + 'a'.repeat(53),
      record: { privateNotes: 'do not index' },
    },
  };
  const result = await ingestEvent(db, value, 'test', new Set());
  assert.equal(result.applied, true);
  assert.equal(result.cursor, 100);
  assert.match(calls[0].sql, /INSERT INTO indexing_failures/);
  assert.deepEqual(JSON.parse(calls[0].params[2]), value);
});
test('database failures escape without acknowledgement', async () => {
  const { db } = fakeDb(true);
  const record = createRecipeRecord({
    title: 'Bread',
    ingredients: [{ name: 'Flour' }],
    instructions: [{ text: 'Bake' }],
  });
  const value = {
    did,
    kind: 'commit',
    time_us: 100,
    commit: {
      operation: 'create',
      collection: RECIPE_COLLECTION,
      rkey: '3mabcdefg2345',
      rev: '3mabcdefg2345',
      cid: 'bafyre' + 'a'.repeat(53),
      record,
    },
  };
  await assert.rejects(() => ingestEvent(db, value, 'test', new Set()), /Database unavailable/);
});
test('reconnect URLs filter collections and replay an overlapping cursor', () => {
  const url = new URL(jetstreamUrl('wss://example.com/subscribe', 10000000));
  assert.equal(url.searchParams.get('cursor'), '5000000');
  assert.equal(url.searchParams.getAll('wantedCollections').length, 3);
  assert.throws(() => jetstreamUrl('ws://untrusted.example/subscribe'));
});
test('durable checkpoints cannot move backwards during replay', async () => {
  const { db, calls } = fakeDb();
  await persistCursor(db, 'test', 123);
  assert.match(calls[0].sql, /greatest\(sync_cursors.cursor,excluded.cursor\)/);
});

function reconciliationAgent(
  options: { changed?: boolean; failPage?: boolean; foreign?: boolean; repeat?: boolean } = {},
): ReconciliationAgent {
  let reads = 0;
  return {
    com: {
      atproto: {
        sync: {
          async getLatestCommit() {
            reads++;
            return {
              data: {
                cid: options.changed && reads > 1 ? 'changed' : 'stable',
                rev: '3mabcdefg2345',
              },
            };
          },
        },
        repo: {
          async listRecords() {
            if (options.failPage) throw new Error('PDS unavailable');
            if (options.foreign)
              return {
                data: {
                  records: [
                    {
                      uri: 'at://did:plc:other/' + RECIPE_COLLECTION + '/3mabcdefg2345',
                      cid: 'bafyre' + 'a'.repeat(53),
                      value: {},
                    },
                  ],
                },
              };
            return { data: { records: [], ...(options.repeat ? { cursor: 'same' } : {}) } };
          },
        },
      },
    },
  };
}
test('reconciliation never deletes records on a failed or changing snapshot', async () => {
  for (const options of [
    { changed: true },
    { failPage: true },
    { foreign: true },
    { repeat: true },
  ]) {
    const { db, calls } = fakeDb();
    await assert.rejects(() => reconcileRepository(db, reconciliationAgent(options), did));
    assert.equal(calls.length, 0);
  }
});
test('a complete stable empty snapshot permits looking up stale records', async () => {
  const { db, calls } = fakeDb();
  const result = await reconcileRepository(db, reconciliationAgent(), did);
  assert.deepEqual(result, { indexed: 0, deleted: 0, rev: '3mabcdefg2345' });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /repo_rev<=\$2/);
});
