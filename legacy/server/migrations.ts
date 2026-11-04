import { readdir, readFile } from 'node:fs/promises';
import type { Database } from './db.js';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

const migrationDirectory = new URL('../migrations/', import.meta.url);

/** Discover append-only numbered SQL files; malformed or duplicate versions fail before any writes. */
export async function discoverMigrations(
  directory: URL = migrationDirectory,
): Promise<Migration[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const migrations: Migration[] = [];
  const versions = new Set<number>();
  for (const entry of entries) {
    if (!entry.name.endsWith('.sql')) continue;
    const match = /^([0-9]{3,})_[a-z0-9][a-z0-9_]*\.sql$/.exec(entry.name);
    const version = match ? Number(match[1]) : 0;
    if (!entry.isFile() || !match || version < 1 || version > 2147483647)
      throw new Error(`Invalid migration filename: ${entry.name}`);
    if (versions.has(version)) throw new Error(`Duplicate migration version: ${version}`);
    versions.add(version);
    migrations.push({
      version,
      name: entry.name,
      sql: await readFile(new URL(entry.name, directory), 'utf8'),
    });
  }
  if (!migrations.length) throw new Error('No SQL migrations found.');
  return migrations.sort((left, right) => left.version - right.version);
}

/** All pending migrations and their ledger entries commit together under the existing lock. */
export async function runMigrations(db: Database, migrations?: Migration[]): Promise<Migration[]> {
  const ordered = (migrations || (await discoverMigrations())).toSorted(
    (left, right) => left.version - right.version,
  );
  return db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(73825384)');
    await tx.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const applied = new Set(
      (await tx.query<{ version: number }>('SELECT version FROM schema_migrations')).map(
        (row) => row.version,
      ),
    );
    const pending = ordered.filter((migration) => !applied.has(migration.version));
    for (const migration of pending) {
      await tx.query(migration.sql);
      // Older SQL files insert their own version; new files only need to contain their changes.
      await tx.query('INSERT INTO schema_migrations(version) VALUES ($1) ON CONFLICT DO NOTHING', [
        migration.version,
      ]);
    }
    return pending;
  });
}
