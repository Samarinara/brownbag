import { PGlite } from '@electric-sql/pglite';
import postgres from 'postgres';
import type { Database } from '../../server/db.js';
import { discoverMigrations, runMigrations } from '../../server/migrations.js';

/** Mirror postgres.js JSON parameter serialization instead of PGlite's more permissive defaults. */
export function pgliteDatabase(pg: PGlite): Database {
  const driver = postgres({ prepare: false });
  const serializers = {
    114: (value: unknown) => String(driver.options.serializers[114](value)),
    3802: (value: unknown) => String(driver.options.serializers[3802](value)),
  };
  let savepoint = 0;
  const adapt = (p: Pick<PGlite, 'query' | 'exec'>, insideTransaction = false): Database => ({
    query: async (text, params = []) => {
      // Migration scripts contain multiple statements; prepared queries only accept one.
      if (!params.length) {
        const results = await p.exec(text);
        return (results.at(-1)?.rows || []) as any;
      }
      return (await p.query(text, params, { serializers })).rows as any;
    },
    transaction: async (fn) => {
      if (!insideTransaction) return pg.transaction((tx) => fn(adapt(tx, true)));
      const name = `test_transaction_${++savepoint}`;
      await p.exec(`SAVEPOINT ${name}`);
      try {
        const result = await fn(adapt(p, true));
        await p.exec(`RELEASE SAVEPOINT ${name}`);
        return result;
      } catch (error) {
        await p.exec(`ROLLBACK TO SAVEPOINT ${name}`);
        await p.exec(`RELEASE SAVEPOINT ${name}`);
        throw error;
      }
    },
  });
  return adapt(pg);
}

/** Explicit versions let backfill tests stage older schemas without duplicating SQL loading. */
export async function applyTestMigrations(db: Database, versions?: number[]) {
  const migrations = await discoverMigrations();
  if (versions?.some((version) => !migrations.some((migration) => migration.version === version)))
    throw new Error('Unknown test migration version.');
  return runMigrations(
    db,
    versions ? migrations.filter((migration) => versions.includes(migration.version)) : migrations,
  );
}

export async function createTestDatabase(options: { versions?: number[] } = {}) {
  const pg = new PGlite();
  const db = pgliteDatabase(pg);
  try {
    await applyTestMigrations(db, options.versions);
  } catch (error) {
    await pg.close();
    throw error;
  }
  return { pg, db, close: () => pg.close() };
}
