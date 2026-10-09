import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { database, type Database } from '../server/db.js';
import { discoverMigrations, runMigrations } from '../server/migrations.js';
import { NetworkStore } from '../server/network-store.js';
import { createRecipeRecord } from '../server/atproto/records.js';
import { RECIPE_COLLECTION } from '../shared/atproto.js';
import { createTestDatabase } from './support/database.js';

// No fallback to DATABASE_URL: CI must never migrate a developer or production database.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const did = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';

async function withPostgres(fn: (db: Database) => Promise<void>) {
  const schema = `brownbag_test_${randomUUID().replaceAll('-', '')}`;
  const admin = postgres(testDatabaseUrl!, { max: 1, prepare: false });
  const sql = postgres(testDatabaseUrl!, {
    max: 2,
    prepare: false,
    connection: { search_path: schema },
  });
  try {
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    await fn(database(sql));
  } finally {
    await sql.end();
    try {
      await admin.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await admin.end();
    }
  }
}

test('migration discovery rejects ambiguous files and sorts versions numerically', async () => {
  const directory = await mkdtemp(resolve('tests/.migration-fixture-'));
  const url = pathToFileURL(`${directory}/`);
  try {
    await writeFile(new URL('009_later.sql', url), 'SELECT 9;');
    await writeFile(new URL('001_first.sql', url), 'SELECT 1;');
    assert.deepEqual(
      (await discoverMigrations(url)).map((migration) => migration.version),
      [1, 9],
    );
    await writeFile(new URL('001_duplicate.sql', url), 'SELECT 1;');
    await assert.rejects(discoverMigrations(url), /Duplicate migration version: 1/);
    await rm(new URL('001_duplicate.sql', url));
    await writeFile(new URL('unversioned.sql', url), 'SELECT 1;');
    await assert.rejects(discoverMigrations(url), /Invalid migration filename/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('migration runner records new SQL versions and rolls back a failed batch', async () => {
  const fixture = await createTestDatabase();
  try {
    assert.deepEqual(await runMigrations(fixture.db), []);
    const next =
      Math.max(...(await discoverMigrations()).map((migration) => migration.version)) + 1;
    await assert.rejects(
      runMigrations(fixture.db, [
        {
          version: next,
          name: 'test_create.sql',
          sql: 'CREATE TABLE migration_rollback(id integer);',
        },
        { version: next + 1, name: 'test_fail.sql', sql: 'SELECT * FROM missing_test_table;' },
      ]),
    );
    assert.equal(
      (await fixture.db.query("SELECT to_regclass('migration_rollback') AS table"))[0].table,
      null,
    );
    assert.deepEqual(
      await fixture.db.query('SELECT version FROM schema_migrations WHERE version >= $1', [next]),
      [],
    );
    assert.equal(
      (
        await runMigrations(fixture.db, [
          {
            version: next,
            name: 'test_success.sql',
            sql: 'CREATE TABLE migration_success(id integer);',
          },
        ])
      ).length,
      1,
    );
    assert.deepEqual(
      await fixture.db.query('SELECT version FROM schema_migrations WHERE version=$1', [next]),
      [{ version: next }],
    );
  } finally {
    await fixture.close();
  }
});

test(
  'real PostgreSQL migrations and production-driver behavior',
  { skip: !testDatabaseUrl },
  async (t) => {
    await t.test(
      'fresh install, second-run no-op, serialization and transaction rollback',
      async () => {
        await withPostgres(async (db) => {
          const migrations = await discoverMigrations();
          const installs = await Promise.all([runMigrations(db), runMigrations(db)]);
          assert.deepEqual(
            installs.map((applied) => applied.length).sort((a, b) => a - b),
            [0, migrations.length],
          );
          const ledger = await db.query(
            'SELECT version, applied_at FROM schema_migrations ORDER BY version',
          );
          assert.deepEqual(
            ledger.map((row) => row.version),
            migrations.map((migration) => migration.version),
          );
          assert.deepEqual(await runMigrations(db), []);
          assert.deepEqual(
            await db.query('SELECT version, applied_at FROM schema_migrations ORDER BY version'),
            ledger,
          );
          const store = new NetworkStore(db);
          const record = createRecipeRecord({
            title: 'Soup',
            ingredients: [{ name: 'carrots', quantity: '1/2', unit: 'cups' }],
            instructions: [{ text: 'Cook.' }],
          });
          await store.index({
            did,
            collection: RECIPE_COLLECTION,
            rkey: 'soup',
            cid: 'bafyre' + 'a'.repeat(53),
            record,
            rev: '001',
          });
          const uri = `at://${did}/${RECIPE_COLLECTION}/soup`;
          assert.deepEqual((await store.recipe(uri)).record, record);
          const [projection] = await db.query(
            'SELECT name_key, quantity_value::text AS quantity FROM recipe_ingredients WHERE recipe_uri=$1',
            [uri],
          );
          assert.equal(projection.name_key, 'carrots');
          assert.equal(Number(projection.quantity), 0.5);
          const input = {
            title: 'Draft soup',
            ingredients: [{ name: 'carrots' }],
            instructions: [{ text: 'Cook.' }],
          };
          assert.deepEqual((await store.saveDraft(did, input)).data, input);
          await store.audit(did, 'test', { nested: { values: ['carrots', 1, true] } });
          assert.deepEqual(
            (await db.query('SELECT detail FROM audit_events WHERE did=$1', [did]))[0].detail,
            { nested: { values: ['carrots', 1, true] } },
          );
          const purchase = [{ quantity: 'to taste', occurrences: 1 }];
          await db.query(
            'INSERT INTO shopping_purchases(did,planned_date,item_key,unspecified) VALUES ($1,$2,$3,$4::text::jsonb)',
            [did, '2026-01-01', 'a'.repeat(64), JSON.stringify(purchase)],
          );
          assert.deepEqual(
            (await db.query('SELECT unspecified FROM shopping_purchases WHERE did=$1', [did]))[0]
              .unspecified,
            purchase,
          );
          await assert.rejects(
            db.transaction(async (tx) => {
              await tx.query('INSERT INTO actors(did) VALUES ($1)', ['did:plc:rollback']);
              throw new Error('rollback test');
            }),
            /rollback test/,
          );
          assert.deepEqual(
            await db.query('SELECT did FROM actors WHERE did=$1', ['did:plc:rollback']),
            [],
          );
          const next = migrations.at(-1)!.version + 1;
          await assert.rejects(
            runMigrations(db, [
              {
                version: next,
                name: 'test_create.sql',
                sql: 'CREATE TABLE failed_migration(id integer);',
              },
              {
                version: next + 1,
                name: 'test_fail.sql',
                sql: 'SELECT * FROM missing_test_table;',
              },
            ]),
          );
          assert.equal(
            (await db.query("SELECT to_regclass('failed_migration') AS table"))[0].table,
            null,
          );
          assert.deepEqual(
            await db.query('SELECT version FROM schema_migrations WHERE version >= $1', [next]),
            [],
          );
        });
      },
    );
    await t.test(
      'upgrades the original ledger and repairs legacy double-serialized JSON',
      async () => {
        await withPostgres(async (db) => {
          const migrations = await discoverMigrations();
          // Execute the original file directly to simulate databases created before this runner.
          await db.query(migrations.find((migration) => migration.version === 1)!.sql);
          const profile = { displayName: 'Original cook' };
          await db.query('INSERT INTO actors(did,profile) VALUES ($1,$2::jsonb)', [
            did,
            JSON.stringify(profile),
          ]);
          assert.equal(
            (await db.query('SELECT jsonb_typeof(profile) AS type FROM actors'))[0].type,
            'string',
          );
          assert.equal((await runMigrations(db)).length, migrations.length - 1);
          assert.deepEqual(
            (await db.query('SELECT profile FROM actors WHERE did=$1', [did]))[0].profile,
            profile,
          );
          assert.deepEqual(await runMigrations(db), []);
        });
      },
    );
  },
);
