import { createPlatformClient } from '@polli/platform-client';
export interface SQLConnection {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  release(): void;
}
export interface SQLPool { connect(): Promise<SQLConnection> }
/** The bearer token must come from the request, never a client-supplied account ID. */
export async function withAccountTransaction<T>(options: {
  pool: SQLPool; platformUrl: string; accessToken: string;
}, fn: (tx: SQLConnection, accountId: string) => Promise<T>): Promise<T> {
  const profile = await createPlatformClient(options.platformUrl, async () => options.accessToken).profile.query();
  if (profile.status !== 'active') throw new Error('Account is pending deletion.');
  const tx = await options.pool.connect();
  try {
    await tx.query('BEGIN');
    await tx.query("select set_config('polli.account_id', $1, true)", [profile.id]);
    await tx.query('select platform.lock_account()');
    const result = await fn(tx, profile.id); await tx.query('COMMIT'); return result;
  } catch (error) { await tx.query('ROLLBACK'); throw error; }
  finally { tx.release(); }
}
export async function expectRevision(tx: SQLConnection, revision: number) {
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('Invalid revision.');
  await tx.query("select set_config('polli.expected_revision', $1, true)", [String(revision)]);
}

