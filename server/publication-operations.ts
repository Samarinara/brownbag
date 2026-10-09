import { createHash, randomUUID } from 'node:crypto';
import { TID } from '@atproto/common-web';
import type { Agent } from '@atproto/api';
import { RECIPE_COLLECTION, type RecipeView } from '../shared/atproto.js';
import { createRecipeRecord, validateRecipeRecord } from './atproto/records.js';
import { HttpError, type NetworkStore } from './network-store.js';

// Records contain nested objects; key order from JSONB/SDK is not significant.
function canonical(value: unknown): string {
  return ordered(JSON.parse(JSON.stringify(value)));
}
function ordered(value: any): string {
  if (Array.isArray(value)) return `[${value.map(ordered).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${ordered(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
function absent(error: any) {
  return error?.error === 'RecordNotFound';
}
type Operation = {
  did: string;
  operation_key: string;
  action: 'create' | 'update' | 'delete';
  payload: any;
  payload_hash: string;
  rkey: string;
  expected_cid: string | null;
  record: any;
  attempted: boolean;
  status: string;
  result: any;
  projection_pending: boolean;
  repo_rev: string;
};
export class PublicationOperations {
  constructor(
    private store: NetworkStore,
    private getAgent: (did: string) => Promise<Agent>,
  ) {}

  async run(
    did: string,
    key: string,
    action: Operation['action'],
    payload: unknown,
    existing?: { rkey: string; cid: string },
  ): Promise<RecipeView | undefined> {
    if (!/^[A-Za-z0-9._:-]{1,200}$/.test(key))
      throw new HttpError(400, 'Invalid publication operation key.');
    const fingerprint = createHash('sha256')
      .update(canonical({ action, payload, existing: existing || null }))
      .digest('hex');
    await this.store.db.query(
      `INSERT INTO publication_operations(did,operation_key,action,payload_hash,payload,rkey,expected_cid)
       VALUES($1,$2,$3,$4,$5::text::jsonb,$6,$7) ON CONFLICT DO NOTHING`,
      [
        did,
        key,
        action,
        fingerprint,
        JSON.stringify(payload),
        existing?.rkey || TID.nextStr(),
        existing?.cid || null,
      ],
    );
    const [op] = await this.store.db.query<Operation>(
      'SELECT * FROM publication_operations WHERE did=$1 AND operation_key=$2',
      [did, key],
    );
    if (op.payload_hash !== fingerprint)
      throw new HttpError(409, 'This operation key was already used for different content.');
    return this.execute(op);
  }

  async recover(did: string, key: string): Promise<RecipeView | undefined> {
    const [op] = await this.store.db.query<Operation>(
      'SELECT * FROM publication_operations WHERE did=$1 AND operation_key=$2',
      [did, key],
    );
    if (!op) throw new HttpError(404, 'Publication operation not found.');
    return this.execute(op);
  }

  private async execute(op: Operation): Promise<RecipeView | undefined> {
    if (op.status === 'conflict')
      throw new HttpError(
        409,
        'Recipe changed during publication. Review the current recipe before trying a new operation.',
      );
    if (op.status === 'succeeded') {
      if (op.projection_pending) await this.project(op);
      return op.action === 'delete' ? undefined : op.result;
    }
    const token = randomUUID();
    const rows = await this.store.db.query(
      `UPDATE publication_operations SET lease_token=$3,lease_until=now()+interval '90 seconds',updated_at=now()
       WHERE did=$1 AND operation_key=$2 AND status IN ('pending','uncertain')
       AND (lease_until IS NULL OR lease_until<now()) RETURNING *`,
      [op.did, op.operation_key, token],
    );
    if (!rows.length)
      throw new HttpError(
        409,
        'This publication is already being processed. Retry with the same operation key.',
      );
    op = rows[0] as Operation;
    const update = async (sql: string, params: unknown[] = []) => {
      const changed = await this.store.db.query(
        `UPDATE publication_operations SET ${sql},updated_at=now()
        WHERE did=$1 AND operation_key=$2 AND lease_token=$3 RETURNING operation_key`,
        [op.did, op.operation_key, token, ...params],
      );
      if (!changed.length)
        throw new HttpError(409, 'Publication lease expired. Retry with the same operation key.');
    };
    let heartbeatError: unknown;
    const heartbeat = setInterval(() => {
      void update("lease_until=now()+interval '90 seconds'").catch((error) => {
        heartbeatError = error;
      });
    }, 30_000);
    heartbeat.unref();
    try {
      const agent = await this.getAgent(op.did);
      const repo = agent.com.atproto.repo;
      let rev = op.repo_rev;
      if (op.attempted) {
        // Read a conservative checkpoint before fetching the record; never give
        // an older snapshot a revision newer than its authoritative read.
        rev = (await agent.com.atproto.sync.getLatestCommit({ did: op.did })).data.rev;
      }
      let remote: { cid: string; uri: string; value: unknown } | undefined;
      // An exact authoritative read is mandatory after a response loss or restart.
      // Only RecordNotFound means absence; auth and transport failures stay retryable.
      if (op.action !== 'create' || op.attempted) {
        try {
          const value = (
            await repo.getRecord({ repo: op.did, collection: RECIPE_COLLECTION, rkey: op.rkey })
          ).data;
          if (!value.cid) throw new Error('PDS record response omitted its CID');
          remote = { ...value, cid: value.cid };
        } catch (error) {
          if (!absent(error)) throw error;
        }
      }
      let result: RecipeView | { deleted: true } | undefined;
      if (op.attempted && op.action === 'delete' && !remote) result = { deleted: true };
      else if (
        op.attempted &&
        op.record &&
        remote &&
        canonical(remote.value) === canonical(op.record)
      )
        result = { uri: remote.uri, cid: remote.cid, authorDid: op.did, record: op.record };
      else {
        if (
          (op.action === 'create' && remote) ||
          (op.action !== 'create' && remote?.cid !== op.expected_cid)
        ) {
          await update(
            "status='conflict',last_error='Remote record no longer matches the approved version'",
          );
          throw new HttpError(409, 'This recipe has changed. Reload it before saving.');
        }
        if (op.action !== 'delete' && !op.record) {
          op.record = createRecipeRecord(
            op.payload,
            remote ? validateRecipeRecord(remote.value) : undefined,
          );
          await update('record=$4::text::jsonb', [JSON.stringify(op.record)]);
        }
        if (heartbeatError) throw heartbeatError;
        // This marker commits before the network call. All later failures are uncertain.
        await update("attempted=true,status='uncertain',lease_until=now()+interval '90 seconds'");
        if (op.action === 'delete') {
          const deleted = await repo.deleteRecord({
            repo: op.did,
            collection: RECIPE_COLLECTION,
            rkey: op.rkey,
            swapRecord: op.expected_cid!,
          });
          rev = deleted.data.commit?.rev || rev;
          result = { deleted: true };
        } else {
          const written = await repo.putRecord({
            repo: op.did,
            collection: RECIPE_COLLECTION,
            rkey: op.rkey,
            record: op.record,
            swapRecord: op.expected_cid,
          });
          rev = written.data.commit?.rev || rev;
          result = {
            uri: written.data.uri,
            cid: written.data.cid,
            authorDid: op.did,
            record: op.record,
          };
        }
      }
      await update(
        "status='succeeded',result=$4::text::jsonb,projection_pending=true,last_error=NULL,repo_rev=$5",
        [JSON.stringify(result), rev],
      );
      op.repo_rev = rev;
      op.result = result;
      op.projection_pending = true;
      await this.project(op);
      return op.action === 'delete' ? undefined : (result as RecipeView);
    } catch (error) {
      await update('last_error=$4', [
        error instanceof Error ? error.message.slice(0, 1000) : 'Publication failed',
      ]).catch(() => {});
      throw error;
    } finally {
      clearInterval(heartbeat);
      await this.store.db.query(
        'UPDATE publication_operations SET lease_token=NULL,lease_until=NULL WHERE did=$1 AND operation_key=$2 AND lease_token=$3',
        [op.did, op.operation_key, token],
      );
    }
  }

  private async project(op: Operation) {
    try {
      await this.store.index({
        did: op.did,
        collection: RECIPE_COLLECTION,
        rkey: op.rkey,
        rev: op.repo_rev,
        ...(op.action === 'delete' ? { deleted: true } : { cid: op.result.cid, record: op.record }),
      });
      await this.store.db.query(
        'UPDATE publication_operations SET projection_pending=false WHERE did=$1 AND operation_key=$2',
        [op.did, op.operation_key],
      );
    } catch (error) {
      console.error(
        'Publication succeeded; durable projection repair is pending',
        error instanceof Error ? error.message : 'unknown error',
      );
    }
  }
}
