import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { connectDatabase } from './db.js';

const { db, sql } = connectDatabase(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);
try {
  await db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(73825384)');
    await tx.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    let applied = false;
    for (const migration of [
      '001_network.sql',
      '002_normalize_jsonb.sql',
      '003_cookbook.sql',
      '004_meal_planner.sql',
    ]) {
      const version = Number(migration.slice(0, 3));
      const done = await tx.query('SELECT version FROM schema_migrations WHERE version=$1', [
        version,
      ]);
      if (done.length) continue;
      await tx.query(
        await readFile(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'),
      );
      console.info(`Applied migration ${migration.replace('.sql', '')}.`);
      applied = true;
    }
    if (!applied) console.info('Database is up to date.');
  });
} finally {
  await sql.end();
}
