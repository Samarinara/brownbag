import test from 'node:test';
import assert from 'node:assert/strict';
import type { Database } from '../server/db.js';
import { maintainDatabase, maintenanceOptions } from '../server/maintenance.js';
import { createTestDatabase } from './support/database.js';

const did = 'did:plc:maintenance';
const tables = ['app_sessions', 'oauth_state', 'oauth_locks', 'rate_limits'] as const;

async function seed(db: Database, expiredRows = 3) {
  await db.query('INSERT INTO actors(did) VALUES ($1)', [did]);
  for (const table of tables) {
    for (let row = 0; row <= expiredRows; row++) {
      const key = row === expiredRows ? 'active' : `expired-${row}`;
      const offset = row === expiredRows ? 1 : -(row + 1);
      if (table === 'app_sessions')
        await db.query(
          `INSERT INTO app_sessions(hash,did,expires_at)
           VALUES ($1,$2,now()+$3*interval '1 day')`,
          [key, did, offset],
        );
      if (table === 'oauth_state')
        await db.query(
          `INSERT INTO oauth_state(key,value,expires_at)
           VALUES ($1,'{}',now()+$2*interval '1 day')`,
          [key, offset],
        );
      if (table === 'oauth_locks')
        await db.query(
          `INSERT INTO oauth_locks(key,owner,expires_at)
           VALUES ($1,'owner',now()+$2*interval '1 day')`,
          [key, offset],
        );
      if (table === 'rate_limits')
        await db.query(
          `INSERT INTO rate_limits(key,count,expires_at)
           VALUES ($1,1,now()+$2*interval '1 day')`,
          [key, offset],
        );
    }
  }
  await db.query("INSERT INTO oauth_sessions(key,value) VALUES ('refresh-token','{}')");
  await db.query(
    "INSERT INTO audit_events(did,event,created_at) VALUES ($1,'account.created',now()-interval '5 years')",
    [did],
  );
  await db.query(
    "INSERT INTO indexing_failures(reason,created_at) VALUES ('requires recovery',now()-interval '5 years')",
  );
}

async function count(db: Database, table: string) {
  const [row] = await db.query<{ count: number }>(
    `SELECT count(*)::integer AS count FROM ${table}`,
  );
  return row.count;
}

test('maintenance bounds each table, resumes oldest-first and preserves live state and history', async () => {
  const { db, close } = await createTestDatabase();
  try {
    await seed(db);
    const result = await maintainDatabase(db, { batchSize: 1, maxBatches: 2 });
    assert.equal(result.dryRun, false);
    assert.deepEqual(
      result.tables,
      tables.map((table) => ({ table, rows: 2, limitReached: true })),
    );
    for (const table of tables) {
      assert.equal(await count(db, table), 2);
      const key = table === 'app_sessions' ? 'hash' : 'key';
      assert.deepEqual(await db.query(`SELECT ${key} AS key FROM ${table} ORDER BY ${key}`), [
        { key: 'active' },
        { key: 'expired-0' },
      ]);
    }
    const resumed = await maintainDatabase(db, { batchSize: 1, maxBatches: 2 });
    assert.ok(resumed.tables.every(({ rows, limitReached }) => rows === 1 && !limitReached));
    const repeated = await maintainDatabase(db);
    assert.ok(repeated.tables.every(({ rows }) => rows === 0));
    for (const table of [...tables, 'oauth_sessions', 'audit_events', 'indexing_failures'])
      assert.equal(await count(db, table), 1);
  } finally {
    await close();
  }
});

test('dry-run reports a bounded count without deleting rows', async () => {
  const { db, close } = await createTestDatabase();
  try {
    await seed(db);
    const result = await maintainDatabase(db, { dryRun: true, batchSize: 1, maxBatches: 2 });
    assert.equal(result.dryRun, true);
    assert.ok(result.tables.every(({ rows, limitReached }) => rows === 2 && limitReached));
    for (const table of tables) assert.equal(await count(db, table), 4);
  } finally {
    await close();
  }
});

test('a failed batch rolls back its deletes; earlier committed batches can be retried safely', async () => {
  const { db, close } = await createTestDatabase();
  try {
    await seed(db, 1);
    const failing: Database = {
      query: (text, params) => db.query(text, params),
      transaction: (fn) =>
        db.transaction(async (tx) =>
          fn({
            ...tx,
            query: async (text, params) => {
              const rows = await tx.query(text, params);
              if (text.includes('DELETE FROM oauth_state')) throw new Error('Lost connection');
              return rows as any;
            },
          }),
        ),
    };
    await assert.rejects(() => maintainDatabase(failing), /Lost connection/);
    assert.equal(await count(db, 'app_sessions'), 1, 'previous table committed');
    assert.equal(await count(db, 'oauth_state'), 2, 'failed batch rolled back');
    const resumed = await maintainDatabase(db);
    assert.equal(resumed.tables[0].rows, 0);
    assert.ok(resumed.tables.slice(1).every(({ rows }) => rows === 1));
  } finally {
    await close();
  }
});

test('CLI defaults to dry-run and rejects ambiguous or unbounded configuration before connecting', async () => {
  assert.deepEqual(maintenanceOptions({}), { batchSize: 500, maxBatches: 10, dryRun: true });
  assert.equal(maintenanceOptions({ MAINTENANCE_DRY_RUN: 'false' }).dryRun, false);
  for (const value of ['0', '-1', '1.5', 'NaN', '', '10001'])
    assert.throws(() => maintenanceOptions({ MAINTENANCE_BATCH_SIZE: value }), /batchSize/);
  assert.throws(() => maintenanceOptions({ MAINTENANCE_MAX_BATCHES: '101' }), /maxBatches/);
  assert.throws(() => maintenanceOptions({ MAINTENANCE_DRY_RUN: 'no' }), /DRY_RUN/);
  const failIfAccessed: Database = {
    query: async () => assert.fail('invalid options must not reach the database'),
    transaction: async () => assert.fail('invalid options must not reach the database'),
  };
  await assert.rejects(() => maintainDatabase(failIfAccessed, { batchSize: 0 }), /batchSize/);
  await assert.rejects(
    () => maintainDatabase(failIfAccessed, { maxBatches: Infinity }),
    /maxBatches/,
  );
});
