import 'dotenv/config';
import postgres from 'postgres';
import { database, type Database } from './db.js';

// Identifiers are fixed here; neither configuration nor callers supply SQL names.
const expiryTables = [
  { table: 'app_sessions', key: 'hash' },
  { table: 'oauth_state', key: 'key' },
  { table: 'oauth_locks', key: 'key' },
  { table: 'rate_limits', key: 'key' },
] as const;

export interface MaintenanceOptions {
  batchSize?: number;
  maxBatches?: number;
  dryRun?: boolean;
}

export interface MaintenanceResult {
  dryRun: boolean;
  tables: {
    table: (typeof expiryTables)[number]['table'];
    rows: number;
    limitReached: boolean;
  }[];
}

function boundedInteger(value: number, name: string, maximum: number) {
  if (!Number.isInteger(value) || value < 1 || value > maximum)
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  return value;
}

/** Remove only expired transient state. Audit and failed-indexing records are retained. */
export async function maintainDatabase(
  db: Database,
  options: MaintenanceOptions = {},
): Promise<MaintenanceResult> {
  const batchSize = boundedInteger(options.batchSize ?? 500, 'batchSize', 10_000);
  const maxBatches = boundedInteger(options.maxBatches ?? 10, 'maxBatches', 100);
  const dryRun = options.dryRun ?? false;
  const result: MaintenanceResult = { dryRun, tables: [] };
  for (const { table, key } of expiryTables) {
    let rows = 0;
    if (dryRun) {
      const [count] = await db.query<{ count: number }>(
        `SELECT count(*)::integer AS count FROM (
          SELECT ${key} FROM ${table} WHERE expires_at < CURRENT_TIMESTAMP
          ORDER BY expires_at, ${key} LIMIT $1
        ) AS expired`,
        [batchSize * maxBatches],
      );
      rows = count.count;
    } else {
      for (let batch = 0; batch < maxBatches; batch++) {
        const count = await db.transaction(async (tx) => {
          // Locks prevent deleting a session/lease that another transaction just renewed.
          // Skip busy rows so cleanup never waits for an in-flight OAuth refresh.
          const [deleted] = await tx.query<{ count: number }>(
            `WITH expired AS (
              SELECT ${key} FROM ${table} WHERE expires_at < CURRENT_TIMESTAMP
              ORDER BY expires_at, ${key} LIMIT $1 FOR UPDATE SKIP LOCKED
            ), removed AS (
              DELETE FROM ${table} AS target USING expired
              WHERE target.${key} = expired.${key}
                AND target.expires_at < CURRENT_TIMESTAMP
              RETURNING target.${key}
            ) SELECT count(*)::integer AS count FROM removed`,
            [batchSize],
          );
          return deleted.count;
        });
        rows += count;
        if (count < batchSize) break;
      }
    }
    // A full budget means there may be more work; skipped locked rows can also remain.
    result.tables.push({ table, rows, limitReached: rows === batchSize * maxBatches });
  }
  return result;
}

export function maintenanceOptions(env: NodeJS.ProcessEnv): MaintenanceOptions {
  const dryRun = env.MAINTENANCE_DRY_RUN ?? 'true';
  if (dryRun !== 'true' && dryRun !== 'false')
    throw new Error('MAINTENANCE_DRY_RUN must be true or false');
  return {
    batchSize: boundedInteger(Number(env.MAINTENANCE_BATCH_SIZE ?? 500), 'batchSize', 10_000),
    maxBatches: boundedInteger(Number(env.MAINTENANCE_MAX_BATCHES ?? 10), 'maxBatches', 100),
    dryRun: dryRun === 'true',
  };
}

export async function runMaintenance() {
  const options = maintenanceOptions(process.env);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required for database maintenance');
  const sql = postgres(url, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    connection: {
      application_name: 'brownbag-maintenance',
      statement_timeout: 30_000,
      lock_timeout: 5_000,
    },
  });
  try {
    // Only aggregate counts are logged; credentials, sessions and OAuth data stay private.
    console.info(JSON.stringify(await maintainDatabase(database(sql), options)));
  } finally {
    await sql.end();
  }
}
