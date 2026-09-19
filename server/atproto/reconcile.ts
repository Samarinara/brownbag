import { z } from 'zod';
import type { Database } from '../db.js';
import { NetworkStore } from '../network-store.js';
import {
  didSchema,
  RECIPE_COLLECTION,
  PROFILE_COLLECTION,
  profileRecordSchema,
  followRecordSchema,
} from '../../shared/atproto.js';
import { INDEXED_COLLECTIONS } from './ingestion.js';
import { validateRecipeRecord } from './records.js';

// Narrow interface permits the caller to supply an OAuth Agent already bound to the user's PDS.
export interface ReconciliationAgent {
  com: {
    atproto: {
      sync: {
        getLatestCommit(
          params: { did: string },
          options?: { signal?: AbortSignal },
        ): Promise<{ data: { cid: string; rev: string } }>;
      };
      repo: {
        listRecords(
          params: { repo: string; collection: string; limit: number; cursor?: string },
          options?: { signal?: AbortSignal },
        ): Promise<{
          data: { cursor?: string; records: { uri: string; cid: string; value: unknown }[] };
        }>;
      };
    };
  };
}

export async function reconcileRepository(
  db: Database,
  agent: ReconciliationAgent,
  did: string,
  options: { signal?: AbortSignal; maxRecords?: number } = {},
) {
  didSchema.parse(did);
  const signal = options.signal || AbortSignal.timeout(25_000);
  const maxRecords = options.maxRecords ?? 1000;
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > 10000)
    throw new Error('Invalid reconciliation record limit');
  const before = (await agent.com.atproto.sync.getLatestCommit({ did }, { signal })).data;
  z.string()
    .regex(/^[234567abcdefghijklmnopqrstuvwxyz]{13}$/)
    .parse(before.rev);
  const records: { uri: string; cid: string; record: unknown; collection: string; rkey: string }[] =
    [];
  const seen = new Set<string>();
  for (const collection of INDEXED_COLLECTIONS) {
    let cursor: string | undefined;
    const cursors = new Set<string>();
    do {
      signal.throwIfAborted();
      const page = (
        await agent.com.atproto.repo.listRecords(
          { repo: did, collection, limit: 100, ...(cursor ? { cursor } : {}) },
          { signal },
        )
      ).data;
      for (const record of page.records) {
        const prefix = `at://${did}/${collection}/`;
        if (!record.uri.startsWith(prefix)) throw new Error('PDS returned a foreign record URI');
        const rkey = record.uri.slice(prefix.length);
        if (!/^[A-Za-z0-9._~:-]{1,512}$/.test(rkey) || rkey === '.' || rkey === '..')
          throw new Error('Invalid record key');
        if (collection === PROFILE_COLLECTION && rkey !== 'self')
          throw new Error('Invalid profile key');
        z.string()
          .regex(/^bafyre[a-z2-7]{53}$/)
          .parse(record.cid);
        if (collection === RECIPE_COLLECTION) validateRecipeRecord(record.value);
        else if (collection === PROFILE_COLLECTION) profileRecordSchema.parse(record.value);
        else followRecordSchema.parse(record.value);
        if (seen.has(record.uri)) throw new Error('Duplicate record in PDS listing');
        seen.add(record.uri);
        records.push({ uri: record.uri, cid: record.cid, record: record.value, collection, rkey });
        if (records.length > maxRecords)
          throw new Error(
            'Repository exceeds bounded reconciliation limit; use a background backfill',
          );
      }
      cursor = page.cursor;
      if (cursor && cursors.has(cursor)) throw new Error('PDS pagination cursor repeated');
      if (cursor) cursors.add(cursor);
    } while (cursor);
  }
  const after = (await agent.com.atproto.sync.getLatestCommit({ did }, { signal })).data;
  if (before.cid !== after.cid || before.rev !== after.rev)
    throw new Error('Repository changed during reconciliation; retry');
  // Only apply after all pages validate and the repository snapshot is stable.
  // A failure during application is safe to retry: revision guards make upserts and tombstones idempotent.
  const store = new NetworkStore(db);
  for (const record of records) {
    signal.throwIfAborted();
    await store.index({ did, ...record, rev: before.rev });
  }
  const existing = await db.query(
    'SELECT uri,collection,rkey FROM network_records WHERE did=$1 AND NOT deleted AND repo_rev<=$2',
    [did, before.rev],
  );
  let deleted = 0;
  for (const record of existing) {
    if (!seen.has(record.uri) && INDEXED_COLLECTIONS.includes(record.collection)) {
      signal.throwIfAborted();
      await store.index({
        did,
        collection: record.collection,
        rkey: record.rkey,
        rev: before.rev,
        deleted: true,
      });
      deleted++;
    }
  }
  return { indexed: records.length, deleted, rev: before.rev };
}
