import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createNetworkApp } from '../server/network-app.js';
import type { OAuthService } from '../server/atproto/oauth.js';
import { createTestDatabase } from './support/database.js';
import { NetworkStore } from '../server/network-store.js';
import { createRecipeRecord } from '../server/atproto/records.js';
import { RECIPE_COLLECTION } from '../shared/atproto.js';
import { INDEXED_COLLECTIONS, ingestEvent, persistCursor } from '../server/atproto/ingestion.js';
import type { ReconciliationAgent } from '../server/atproto/reconcile.js';
import {
  enqueueSync,
  enqueueKnownActorRepairs,
  processSyncBatch,
  syncJobStatus,
  workerHeartbeat,
  indexerStatus,
} from '../server/sync-jobs.js';

const did = 'did:plc:abcdefghijklmnopqrstuvwx';
const other = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
const rev = '3mabcdefg2345';
const cid = 'bafyre' + 'a'.repeat(53);
const record = createRecipeRecord({
  title: 'Bread',
  ingredients: [{ name: 'Flour' }],
  instructions: [{ text: 'Bake' }],
});
function listed(rkey: string) {
  return { uri: `at://${did}/${RECIPE_COLLECTION}/${rkey}`, cid, value: record };
}
function agent(
  options: {
    pages?: (
      collection: string,
      cursor?: string,
    ) => { records: ReturnType<typeof listed>[]; cursor?: string };
    changed?: boolean;
    fail?: boolean;
    onList?: () => Promise<void>;
  } = {},
): ReconciliationAgent {
  let reads = 0;
  return {
    com: {
      atproto: {
        sync: {
          async getLatestCommit() {
            return { data: { cid: options.changed && ++reads > 1 ? 'changed' : 'same', rev } };
          },
        },
        repo: {
          async listRecords(params) {
            if (options.fail) throw new Error('PDS offline');
            await options.onList?.();
            return { data: options.pages?.(params.collection, params.cursor) || { records: [] } };
          },
        },
      },
    },
  };
}
async function finish(db: Parameters<typeof processSyncBatch>[0], client: ReconciliationAgent) {
  for (let i = 0; i < 20; i++) {
    const worked = await processSyncBatch(db, { agent: async () => client });
    if (!worked) return;
  }
  throw new Error('Job did not finish within bounded test steps');
}

test('resumes persisted pages after worker restarts; only a stable completed listing changes projections', async () => {
  const fixture = await createTestDatabase();
  try {
    const { db } = fixture;
    const store = new NetworkStore(db);
    await store.index({ did, collection: RECIPE_COLLECTION, rkey: 'old', cid, record, rev });
    await enqueueSync(db, did);
    const requested: (string | undefined)[] = [];
    const client = agent({
      pages(collection, cursor) {
        if (collection !== RECIPE_COLLECTION) return { records: [] };
        requested.push(cursor);
        return cursor
          ? { records: [listed('two')] }
          : { records: [listed('one')], cursor: 'second-page' };
      },
    });
    await processSyncBatch(db, { agent: async () => client });
    assert.equal((await store.recipes()).recipes.length, 1);
    assert.equal(
      (await db.query('SELECT page_cursor FROM sync_jobs'))[0].page_cursor,
      'second-page',
    );
    // New invocation models a restarted process; it has no in-memory checkpoint.
    await finish(db, client);
    assert.deepEqual(requested, [undefined, 'second-page']);
    assert.equal((await syncJobStatus(db, did)).status, 'complete');
    assert.equal((await store.recipes()).recipes.length, 2);
    assert.equal(
      (await db.query("SELECT deleted FROM network_records WHERE rkey='old'"))[0].deleted,
      true,
    );
  } finally {
    await fixture.close();
  }
});

test('changed repository discards staging without tombstones and restarts with backoff', async () => {
  const fixture = await createTestDatabase();
  try {
    const { db } = fixture;
    const store = new NetworkStore(db);
    await store.index({ did, collection: RECIPE_COLLECTION, rkey: 'old', cid, record, rev });
    await enqueueSync(db, did);
    const client = agent({
      changed: true,
      pages: (collection) => ({ records: collection === RECIPE_COLLECTION ? [listed('new')] : [] }),
    });
    await finish(db, client);
    const [job] = await db.query('SELECT * FROM sync_jobs');
    assert.equal(job.status, 'queued');
    assert.equal(job.snapshot_rev, null);
    assert.equal(job.collection_index, 0);
    assert.match(job.last_error, /changed/);
    assert.equal((await db.query('SELECT * FROM sync_job_records')).length, 0);
    assert.deepEqual(
      (await store.recipes()).recipes.map((r) => r.uri),
      [`at://${did}/${RECIPE_COLLECTION}/old`],
    );
  } finally {
    await fixture.close();
  }
});

test('failed PDS pages preserve checkpoint and never delete; retry backoff prevents tight loops', async () => {
  const fixture = await createTestDatabase();
  try {
    const { db } = fixture;
    await enqueueSync(db, did);
    await processSyncBatch(db, { agent: async () => agent({ fail: true }) });
    const job = await syncJobStatus(db, did);
    assert.equal(job.attempts, 1);
    assert.match(job.last_error, /offline/);
    assert.equal(await processSyncBatch(db, { agent: async () => agent() }), false);
    await db.query('UPDATE sync_jobs SET available_at=now()');
    await finish(db, agent());
    assert.equal((await syncJobStatus(db, did)).status, 'complete');
  } finally {
    await fixture.close();
  }
});

test('a live lease cannot be stolen, an expired lease recovers, and stale owner cannot stage writes', async () => {
  const fixture = await createTestDatabase();
  try {
    const { db } = fixture;
    await enqueueSync(db, did);
    await db.query(
      "UPDATE sync_jobs SET status='running',lease_owner=$1,lease_until=now()+interval '1 minute'",
      [randomUUID()],
    );
    assert.equal(await processSyncBatch(db, { agent: async () => agent() }), false);
    await db.query("UPDATE sync_jobs SET lease_until=now()-interval '1 second'");
    const takeover = randomUUID();
    await processSyncBatch(db, {
      agent: async () =>
        agent({
          pages: () => ({ records: [listed('late')] }),
          onList: async () => {
            await db.query(
              "UPDATE sync_jobs SET lease_owner=$1,lease_until=now()+interval '1 minute'",
              [takeover],
            );
          },
        }),
    });
    assert.equal((await db.query('SELECT * FROM sync_job_records')).length, 0);
    assert.equal((await db.query('SELECT lease_owner FROM sync_jobs'))[0].lease_owner, takeover);
    await db.query("UPDATE sync_jobs SET lease_until=now()-interval '1 second'");
    await finish(db, agent());
    assert.equal((await syncJobStatus(db, did)).status, 'complete');
  } finally {
    await fixture.close();
  }
});

test('snapshot projection and tombstones cannot overwrite newer stream revisions', async () => {
  const fixture = await createTestDatabase();
  try {
    const { db } = fixture;
    const store = new NetworkStore(db);
    await store.index({
      did,
      collection: RECIPE_COLLECTION,
      rkey: 'absent',
      cid,
      record,
      rev: '3mabcdefg2346',
    });
    await store.index({
      did,
      collection: RECIPE_COLLECTION,
      rkey: 'present',
      cid,
      record: { ...record, title: 'Newest' },
      rev: '3mabcdefg2346',
    });
    await enqueueSync(db, did);
    await finish(
      db,
      agent({
        pages: (collection) => ({
          records: collection === RECIPE_COLLECTION ? [listed('present')] : [],
        }),
      }),
    );
    const recipes = (await store.recipes()).recipes;
    assert.equal(recipes.length, 2);
    assert.equal(recipes.find((r) => r.uri.endsWith('/present'))?.record.title, 'Newest');
  } finally {
    await fixture.close();
  }
});

test('repeated cursors restart bounded listing rather than applying a partial snapshot', async () => {
  const fixture = await createTestDatabase();
  try {
    const { db } = fixture;
    await enqueueSync(db, did);
    const client = agent({ pages: () => ({ records: [], cursor: 'same' }) });
    await processSyncBatch(db, { agent: async () => client });
    await processSyncBatch(db, { agent: async () => client });
    const [job] = await db.query('SELECT * FROM sync_jobs');
    assert.equal(job.snapshot_rev, null);
    assert.equal(job.page_cursor, null);
    assert.equal(job.attempts, 1);
  } finally {
    await fixture.close();
  }
});

test('startup repairs known actors, daily recovery reschedules completed jobs, and new onboarded actors join', async () => {
  const fixture = await createTestDatabase();
  try {
    const { db } = fixture;
    await new NetworkStore(db).actor(did);
    await enqueueKnownActorRepairs(db);
    assert.equal((await syncJobStatus(db, did)).status, 'queued');
    assert.equal(await syncJobStatus(db, other), null);
    await finish(db, agent());
    await enqueueKnownActorRepairs(db);
    assert.equal((await syncJobStatus(db, did)).status, 'complete');
    await db.query("UPDATE sync_jobs SET completed_at=now()-interval '2 days'");
    await enqueueKnownActorRepairs(db);
    assert.equal((await syncJobStatus(db, did)).status, 'queued');
    await enqueueSync(db, other, 'onboarding');
    assert.equal((await syncJobStatus(db, other)).status, 'queued');
  } finally {
    await fixture.close();
  }
});

test('own-account requeue during a running snapshot triggers another completed pass', async () => {
  const fixture = await createTestDatabase();
  try {
    const { db } = fixture;
    await enqueueSync(db, did);
    let requested = false;
    await processSyncBatch(db, {
      agent: async () =>
        agent({
          onList: async () => {
            if (!requested) {
              requested = true;
              await enqueueSync(db, did, 'manual');
            }
          },
        }),
    });
    for (let i = 0; i < INDEXED_COLLECTIONS.length + 1; i++)
      await processSyncBatch(db, { agent: async () => agent() });
    assert.equal((await syncJobStatus(db, did)).status, 'queued');
    await finish(db, agent());
    assert.equal((await syncJobStatus(db, did)).status, 'complete');
  } finally {
    await fixture.close();
  }
});

test('heartbeat exposes disconnected/stale workers, lag, queued repairs and dead letters', async () => {
  const fixture = await createTestDatabase();
  try {
    const { db } = fixture;
    await enqueueSync(db, did);
    await workerHeartbeat(db, 'worker', 'test', false);
    await persistCursor(db, 'test', Date.now() * 1000 - 120_000_000);
    await ingestEvent(db, { bad: true }, 'test', new Set());
    const status = await indexerStatus(db);
    assert.equal(Number(status.jobs.pending), 1);
    assert.equal(status.workers[0].connected, false);
    assert.equal(status.workers[0].stale, false);
    assert.ok(Number(status.cursors[0].lag_seconds) >= 119);
    assert.equal(Number(status.failures.total), 1);
    await db.query("UPDATE worker_heartbeats SET updated_at=now()-interval '2 minutes'");
    assert.equal((await indexerStatus(db)).workers[0].stale, true);
  } finally {
    await fixture.close();
  }
});

test('background reconciliation exceeds the immediate 1000-record limit with bounded apply batches', async () => {
  const fixture = await createTestDatabase();
  try {
    const { db } = fixture;
    await enqueueSync(db, did);
    const client = agent({
      pages(collection, cursor) {
        if (collection !== RECIPE_COLLECTION) return { records: [] };
        const start = cursor ? Number(cursor) : 0;
        const count = Math.min(100, 1001 - start);
        return {
          records: Array.from({ length: count }, (_, i) => listed(`recipe-${start + i}`)),
          ...(start + count < 1001 ? { cursor: String(start + count) } : {}),
        };
      },
    });
    let previous = 0;
    for (let i = 0; i < 40; i++) {
      if (!(await processSyncBatch(db, { agent: async () => client }))) break;
      const indexed = Number(
        (await db.query('SELECT count(*) AS total FROM public_recipes'))[0].total,
      );
      assert.ok(indexed - previous <= 100, 'at most 100 projections per leased batch');
      previous = indexed;
    }
    assert.equal(previous, 1001);
    assert.equal((await syncJobStatus(db, did)).status, 'complete');
  } finally {
    await fixture.close();
  }
});

test('onboarding schedules repair and own async status coexists with synchronous refresh counts', async () => {
  const fixture = await createTestDatabase();
  const nonce = 'a'.repeat(43);
  const client = agent();
  const oauth = {
    callback: async () => ({ state: nonce, session: { did } }),
    identity: async () => ({ handle: 'alice.example' }),
    agent: async () => client,
  } as unknown as OAuthService;
  const server = createNetworkApp({
    origin: 'http://127.0.0.1',
    store: new NetworkStore(fixture.db),
    oauth,
  }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(`${base}/api/sync/jobs`)).status, 401);
    const login = await fetch(`${base}/api/auth/callback`, {
      headers: { cookie: `brownbag_oauth=${nonce}` },
      redirect: 'manual',
    });
    assert.equal(login.status, 302);
    const cookie = login.headers.get('set-cookie')!.match(/brownbag_session=[^;]+/)![0];
    assert.equal((await syncJobStatus(fixture.db, did)).status, 'queued');
    const immediate = await fetch(`${base}/api/sync`, { method: 'POST', headers: { cookie } });
    assert.equal(immediate.status, 200);
    assert.deepEqual(await immediate.json(), { indexed: 0, deleted: 0, rev });
    const queued = await fetch(`${base}/api/sync/jobs`, { method: 'POST', headers: { cookie } });
    assert.equal(queued.status, 202);
    assert.equal((await queued.json()).job.status, 'queued');
    await finish(fixture.db, client);
    const status = await fetch(`${base}/api/sync/jobs`, { headers: { cookie } });
    assert.equal(status.status, 200);
    assert.equal((await status.json()).job.status, 'complete');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fixture.close();
  }
});
