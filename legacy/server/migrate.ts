import 'dotenv/config';
import { connectDatabase } from './db.js';
import { runMigrations } from './migrations.js';

const { db, sql } = connectDatabase(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);
try {
  const applied = await runMigrations(db);
  for (const migration of applied)
    console.info(`Applied migration ${migration.name.replace('.sql', '')}.`);
  if (!applied.length) console.info('Database is up to date.');
} finally {
  await sql.end();
}
