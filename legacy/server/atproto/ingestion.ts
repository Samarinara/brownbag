import { z } from 'zod';
import type { Database } from '../db.js';
import { NetworkStore } from '../network-store.js';
import {
  didSchema,
  RECIPE_COLLECTION,
  PROFILE_COLLECTION,
  FOLLOW_COLLECTION,
  profileRecordSchema,
  followRecordSchema,
} from '../../shared/atproto.js';
import { validateRecipeRecord } from './records.js';

export const INDEXED_COLLECTIONS = [RECIPE_COLLECTION, PROFILE_COLLECTION, FOLLOW_COLLECTION];
const envelopeSchema = z
  .object({
    did: didSchema,
    time_us: z.number().int().nonnegative().safe(),
    kind: z.enum(['commit', 'identity', 'account']),
  })
  .passthrough();
const commitSchema = z.object({
  rev: z.string().regex(/^[234567abcdefghijklmnopqrstuvwxyz]{13}$/),
  operation: z.enum(['create', 'update', 'delete']),
  collection: z.string(),
  rkey: z
    .string()
    .regex(/^[A-Za-z0-9._~:-]{1,512}$/)
    .refine((v) => v !== '.' && v !== '..'),
  cid: z
    .string()
    .regex(/^bafyre[a-z2-7]{53}$/)
    .optional(),
  record: z.unknown().optional(),
});

// Jetstream is a trusted JSON projection, not a cryptographically verified repository stream.
// Database failures deliberately escape: the worker reconnects without advancing its cursor.
export async function ingestEvent(
  db: Database,
  value: unknown,
  source: string,
  knownActors: Set<string>,
): Promise<{ cursor?: number; applied: boolean }> {
  const envelope = envelopeSchema.safeParse(value);
  if (!envelope.success) {
    await deadLetter(db, source, value, 'Invalid Jetstream envelope');
    return { applied: false };
  }
  const event = envelope.data;
  if (event.kind === 'commit') {
    let commit: z.infer<typeof commitSchema>;
    try {
      commit = commitSchema.parse(event.commit);
      if (!INDEXED_COLLECTIONS.includes(commit.collection as typeof RECIPE_COLLECTION))
        return { cursor: event.time_us, applied: false };
      if (commit.collection === PROFILE_COLLECTION && commit.rkey !== 'self')
        throw new Error('Profile record key must be self');
      if (commit.operation !== 'delete') {
        if (!commit.cid) throw new Error('Missing record CID');
        if (commit.collection === RECIPE_COLLECTION) validateRecipeRecord(commit.record);
        else if (commit.collection === PROFILE_COLLECTION) profileRecordSchema.parse(commit.record);
        else followRecordSchema.parse(commit.record);
      }
    } catch (error) {
      await deadLetter(
        db,
        source,
        value,
        error instanceof Error ? error.message : 'Invalid commit',
      );
      return { cursor: event.time_us, applied: true };
    }
    await new NetworkStore(db).index({
      did: event.did,
      ...commit,
      deleted: commit.operation === 'delete',
    });
    knownActors.add(event.did);
    return { cursor: event.time_us, applied: true };
  }
  // Identity/account messages are sent for the whole network. Ignore strangers without waking Postgres.
  if (!knownActors.has(event.did)) return { cursor: event.time_us, applied: false };
  if (event.kind === 'identity') {
    await db.query(
      'UPDATE actors SET handle=NULL,identity_time=$2,updated_at=now() WHERE did=$1 AND identity_time<$2',
      [event.did, event.time_us],
    );
  } else {
    const account = z.object({ active: z.boolean() }).safeParse(event.account);
    if (!account.success) {
      await deadLetter(db, source, value, 'Invalid account status');
      return { cursor: event.time_us, applied: true };
    }
    await db.query(
      'UPDATE actors SET active=$2,status_time=$3,updated_at=now() WHERE did=$1 AND status_time<$3',
      [event.did, account.data.active, event.time_us],
    );
  }
  return { cursor: event.time_us, applied: true };
}

async function deadLetter(db: Database, source: string, event: unknown, reason: string) {
  const parsed = envelopeSchema.safeParse(event);
  await db.query(
    'INSERT INTO indexing_failures(source,time_us,event,reason) VALUES ($1,$2,$3::text::jsonb,$4)',
    [
      source,
      parsed.success ? parsed.data.time_us : null,
      JSON.stringify(event),
      reason.slice(0, 4000),
    ],
  );
}

export async function persistCursor(db: Database, source: string, cursor: number) {
  await db.query(
    'INSERT INTO sync_cursors(source,cursor) VALUES ($1,$2) ON CONFLICT(source) DO UPDATE SET cursor=greatest(sync_cursors.cursor,excluded.cursor),updated_at=now()',
    [source, cursor],
  );
}

export function jetstreamUrl(source: string, cursor?: number, overlapUs = 5_000_000) {
  const url = new URL(source);
  if (
    url.protocol !== 'wss:' &&
    !(url.protocol === 'ws:' && ['localhost', '127.0.0.1'].includes(url.hostname))
  )
    throw new Error('JETSTREAM_URL must use WSS');
  url.searchParams.delete('wantedCollections');
  for (const collection of INDEXED_COLLECTIONS)
    url.searchParams.append('wantedCollections', collection);
  if (cursor !== undefined) url.searchParams.set('cursor', String(Math.max(0, cursor - overlapUs)));
  return url.toString();
}
