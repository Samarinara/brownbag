import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Database } from './db.js';
import { NetworkStore } from './network-store.js';
import { didSchema } from '../shared/atproto.js';
import { INDEXED_COLLECTIONS } from './atproto/ingestion.js';
import { validateListedRecord, type ReconciliationAgent } from './atproto/reconcile.js';
import { publicRepositoryAgent } from './atproto/public-repository.js';

const snapshotSchema = z.object({
  cid: z.string().min(1).max(200),
  rev: z.string().regex(/^[234567abcdefghijklmnopqrstuvwxyz]{13}$/),
});
const pageSchema = z.object({
  cursor: z.string().min(1).max(2048).optional(),
  records: z.array(z.object({ uri: z.string(), cid: z.string(), value: z.unknown() })).max(100),
});

export async function enqueueSync(db: Database, did: string, reason = 'manual') {
  didSchema.parse(did);
  await db.transaction(async (tx) => {
    // Serialize requeue with batch commits, including a finishing worker.
    await tx.query('INSERT INTO actors(did) VALUES ($1) ON CONFLICT DO NOTHING', [did]);
    const [existing] = await tx.query('SELECT status FROM sync_jobs WHERE did=$1 FOR UPDATE', [
      did,
    ]);
    if (existing?.status === 'complete') {
      await tx.query('DELETE FROM sync_job_records WHERE did=$1', [did]);
      await tx.query('DELETE FROM sync_job_cursors WHERE did=$1', [did]);
    }
    await tx.query(
      `INSERT INTO sync_jobs(did,reason) VALUES ($1,$2)
       ON CONFLICT(did) DO UPDATE SET reason=excluded.reason,
       rerun=CASE WHEN sync_jobs.status='complete' THEN false ELSE
         sync_jobs.rerun OR sync_jobs.snapshot_rev IS NOT NULL OR sync_jobs.status='running' END,
       status=CASE WHEN sync_jobs.status='complete' THEN 'queued' ELSE sync_jobs.status END,
       phase=CASE WHEN sync_jobs.status='complete' THEN 'listing' ELSE sync_jobs.phase END,
       snapshot_cid=CASE WHEN sync_jobs.status='complete' THEN NULL ELSE sync_jobs.snapshot_cid END,
       snapshot_rev=CASE WHEN sync_jobs.status='complete' THEN NULL ELSE sync_jobs.snapshot_rev END,
       collection_index=CASE WHEN sync_jobs.status='complete' THEN 0 ELSE sync_jobs.collection_index END,
       page_cursor=CASE WHEN sync_jobs.status='complete' THEN NULL ELSE sync_jobs.page_cursor END,
       available_at=CASE WHEN sync_jobs.status='complete' THEN now() ELSE sync_jobs.available_at END,
       updated_at=now()`,
      [did, reason.slice(0, 100)],
    );
  });
  return syncJobStatus(db, did);
}

export async function syncJobStatus(db: Database, did: string) {
  const [row] = await db.query(
    `SELECT status,phase,attempts,last_error,updated_at,completed_at FROM sync_jobs WHERE did=$1`,
    [did],
  );
  return row || null;
}

export async function enqueueKnownActorRepairs(db: Database) {
  // Discovery is deliberately limited to actors already onboarded or observed in
  // indexed-collection traffic. This is not a historical crawl of the network.
  await db.query(`INSERT INTO sync_jobs(did,reason)
    SELECT did,'periodic' FROM actors WHERE active
    ON CONFLICT(did) DO UPDATE SET status='queued',phase='listing',snapshot_cid=NULL,
    snapshot_rev=NULL,collection_index=0,page_cursor=NULL,available_at=now(),attempts=0,last_error=NULL,updated_at=now()
    WHERE sync_jobs.status='complete' AND sync_jobs.completed_at < now()-interval '1 day'`);
}

export class SnapshotChanged extends Error {}

// A batch is at most one 100-record remote page, 100 projection writes, or 100
// tombstones. A process crash loses no checkpoint; a lease takeover fences old
// workers before they can commit anything to the live index.
export async function processSyncBatch(
  db: Database,
  options: {
    signal?: AbortSignal;
    agent?: (did: string, signal: AbortSignal) => Promise<ReconciliationAgent>;
  } = {},
): Promise<boolean> {
  const owner = randomUUID();
  const [job] = await db.query(
    `UPDATE sync_jobs SET status='running',lease_owner=$1,lease_until=now()+interval '60 seconds'
     WHERE did=(SELECT did FROM sync_jobs WHERE available_at<=now()
       AND (status='queued' OR (status='running' AND lease_until<now()))
       ORDER BY available_at,did FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,
    [owner],
  );
  if (!job) return false;
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(25_000)])
    : AbortSignal.timeout(25_000);
  try {
    if (job.phase === 'listing') {
      const agent = await (options.agent || publicRepositoryAgent)(job.did, signal);
      const current = snapshotSchema.parse(
        (await agent.com.atproto.sync.getLatestCommit({ did: job.did }, { signal })).data,
      );
      const snapshot = job.snapshot_rev
        ? { cid: job.snapshot_cid, rev: job.snapshot_rev }
        : current;
      // Also revalidate after downtime/PDS moves, before spending another page
      // on stale staging. This lets a repository recover after shrinking below
      // the staging cap or changing pagination while a repair is paused.
      if (current.cid !== snapshot.cid || current.rev !== snapshot.rev)
        throw new SnapshotChanged('Repository changed during listing; restarting snapshot');
      const collection = INDEXED_COLLECTIONS[job.collection_index];
      if (!collection) throw new Error('Invalid reconciliation collection checkpoint');
      const page = pageSchema.parse(
        (
          await agent.com.atproto.repo.listRecords(
            {
              repo: job.did,
              collection,
              limit: 100,
              ...(job.page_cursor ? { cursor: job.page_cursor } : {}),
            },
            { signal },
          )
        ).data,
      );
      const records = page.records.map((record) =>
        validateListedRecord(job.did, collection, { ...record, value: record.value }),
      );
      const finished = !page.cursor && job.collection_index === INDEXED_COLLECTIONS.length - 1;
      if (finished) {
        const after = snapshotSchema.parse(
          (await agent.com.atproto.sync.getLatestCommit({ did: job.did }, { signal })).data,
        );
        if (after.cid !== snapshot.cid || after.rev !== snapshot.rev)
          throw new SnapshotChanged('Repository changed during listing; restarting snapshot');
      }
      await ownedTransaction(db, job.did, owner, async (tx) => {
        if (page.cursor)
          await tx.query('INSERT INTO sync_job_cursors(did,collection,cursor) VALUES ($1,$2,$3)', [
            job.did,
            collection,
            page.cursor,
          ]);
        for (const record of records)
          await tx.query(
            `INSERT INTO sync_job_records(did,uri,collection,rkey,cid,record) VALUES ($1,$2,$3,$4,$5,$6::text::jsonb)`,
            [
              job.did,
              record.uri,
              collection,
              record.rkey,
              record.cid,
              JSON.stringify(record.record),
            ],
          );
        const [count] = await tx.query(
          'SELECT count(*) AS total FROM sync_job_records WHERE did=$1',
          [job.did],
        );
        if (Number(count.total) > 250_000)
          throw new Error('Repository exceeds repair staging limit');
        await tx.query(
          `UPDATE sync_jobs SET snapshot_cid=$2,snapshot_rev=$3,page_cursor=$4,collection_index=$5,
            phase=$6,status='queued',available_at=now(),lease_owner=NULL,lease_until=NULL,last_error=NULL,updated_at=now()
           WHERE did=$1`,
          [
            job.did,
            snapshot.cid,
            snapshot.rev,
            page.cursor || null,
            page.cursor ? job.collection_index : job.collection_index + 1,
            finished ? 'applying' : 'listing',
          ],
        );
      });
    } else {
      await ownedTransaction(db, job.did, owner, async (tx) => {
        // NetworkStore owns a transaction normally. Here every projection and its
        // checkpoint share this outer lease-fenced transaction.
        const store = new NetworkStore({ query: tx.query.bind(tx), transaction: (fn) => fn(tx) });
        if (job.phase === 'applying') {
          const records = await tx.query(
            'SELECT * FROM sync_job_records WHERE did=$1 AND NOT applied ORDER BY uri LIMIT 100',
            [job.did],
          );
          for (const record of records) {
            signal.throwIfAborted();
            await store.index({
              did: job.did,
              collection: record.collection,
              rkey: record.rkey,
              cid: record.cid,
              record: record.record,
              rev: job.snapshot_rev,
            });
            await tx.query('UPDATE sync_job_records SET applied=true WHERE did=$1 AND uri=$2', [
              job.did,
              record.uri,
            ]);
          }
          if (records.length < 100)
            await tx.query("UPDATE sync_jobs SET phase='deleting' WHERE did=$1", [job.did]);
        } else {
          const missing = await tx.query(
            `SELECT collection,rkey FROM network_records n WHERE did=$1 AND NOT deleted AND repo_rev<=$2
              AND collection=ANY($3::text[]) AND NOT EXISTS(SELECT 1 FROM sync_job_records s WHERE s.did=n.did AND s.uri=n.uri)
              ORDER BY uri LIMIT 100`,
            [job.did, job.snapshot_rev, INDEXED_COLLECTIONS],
          );
          for (const record of missing) {
            signal.throwIfAborted();
            await store.index({
              did: job.did,
              collection: record.collection,
              rkey: record.rkey,
              rev: job.snapshot_rev,
              deleted: true,
            });
          }
          if (missing.length < 100) {
            await tx.query('DELETE FROM sync_job_records WHERE did=$1', [job.did]);
            await tx.query('DELETE FROM sync_job_cursors WHERE did=$1', [job.did]);
            await tx.query(
              `UPDATE sync_jobs SET status=CASE WHEN rerun THEN 'queued' ELSE 'complete' END,
                phase='listing',snapshot_cid=NULL,snapshot_rev=NULL,collection_index=0,page_cursor=NULL,
                rerun=false,completed_at=now(),attempts=0,last_error=NULL,available_at=now(),lease_owner=NULL,lease_until=NULL,updated_at=now() WHERE did=$1`,
              [job.did],
            );
            return;
          }
        }
        await tx.query(
          "UPDATE sync_jobs SET status='queued',available_at=now(),last_error=NULL,lease_owner=NULL,lease_until=NULL,updated_at=now() WHERE did=$1",
          [job.did],
        );
      });
    }
  } catch (error) {
    // Late errors must not reset another worker's successfully recovered batch.
    await ownedTransaction(
      db,
      job.did,
      owner,
      async (tx) => {
        const restart = Boolean(
          error instanceof SnapshotChanged ||
          (error && typeof error === 'object' && 'code' in error && error.code === '23505'),
        );
        if (restart) {
          await tx.query('DELETE FROM sync_job_records WHERE did=$1', [job.did]);
          await tx.query('DELETE FROM sync_job_cursors WHERE did=$1', [job.did]);
        }
        await tx.query(
          `UPDATE sync_jobs SET status='queued',lease_owner=NULL,lease_until=NULL,attempts=attempts+1,
          available_at=now()+($2::integer*interval '1 second'),last_error=$3,
          phase=CASE WHEN $4 THEN 'listing' ELSE phase END,
          snapshot_cid=CASE WHEN $4 THEN NULL ELSE snapshot_cid END,
          snapshot_rev=CASE WHEN $4 THEN NULL ELSE snapshot_rev END,
          collection_index=CASE WHEN $4 THEN 0 ELSE collection_index END,
          page_cursor=CASE WHEN $4 THEN NULL ELSE page_cursor END,updated_at=now() WHERE did=$1`,
          [
            job.did,
            Math.min(3600, 5 * 2 ** Math.min(10, Number(job.attempts))),
            (error instanceof Error ? error.message : 'Repair failed').slice(0, 1000),
            restart,
          ],
        );
      },
      false,
    );
  }
  return true;
}

async function ownedTransaction(
  db: Database,
  did: string,
  owner: string,
  fn: (tx: Database) => Promise<void>,
  fail = true,
) {
  await db.transaction(async (tx) => {
    const rows = await tx.query(
      'SELECT did FROM sync_jobs WHERE did=$1 AND lease_owner=$2 AND lease_until>now() FOR UPDATE',
      [did, owner],
    );
    if (!rows.length) {
      if (fail) throw new Error('Reconciliation lease expired');
      return;
    }
    await fn(tx);
  });
}

export async function workerHeartbeat(
  db: Database,
  worker: string,
  source: string,
  connected: boolean,
) {
  await db.query(
    `INSERT INTO worker_heartbeats(worker,source,connected) VALUES($1,$2,$3)
    ON CONFLICT(worker) DO UPDATE SET source=excluded.source,connected=excluded.connected,updated_at=now()`,
    [worker, source, connected],
  );
}

export async function indexerStatus(db: Database) {
  const [jobs] = await db.query(`SELECT count(*) FILTER(WHERE status<>'complete') AS pending,
    count(*) FILTER(WHERE last_error IS NOT NULL) AS retrying,
    min(available_at) FILTER(WHERE status<>'complete') AS oldest_due FROM sync_jobs`);
  return {
    jobs,
    workers: await db.query(
      `SELECT worker,source,connected,updated_at,updated_at<now()-interval '90 seconds' AS stale FROM worker_heartbeats`,
    ),
    cursors: await db.query(
      `SELECT source,cursor,updated_at,greatest(0,extract(epoch FROM now())-cursor/1000000.0) AS lag_seconds FROM sync_cursors`,
    ),
    failures: (
      await db.query('SELECT count(*) AS total,max(created_at) AS latest FROM indexing_failures')
    )[0],
  };
}
