import { createHash } from 'node:crypto';
import { TID } from '@atproto/common-web';
import { Agent } from '@atproto/api';
import { RECIPE_COLLECTION, FOLLOW_COLLECTION, type RecipeView } from '../shared/atproto.js';
import { createRecipeRecord, parseRecipeUri, validateRecipeRecord } from './atproto/records.js';
import { HttpError, NetworkStore } from './network-store.js';

export type AgentFactory = (did: string) => Promise<Agent>;

export class Publisher {
  constructor(
    private store: NetworkStore,
    private getAgent: AgentFactory,
  ) {}

  private async project(input: Parameters<NetworkStore['index']>[0]) {
    try {
      await this.store.index(input);
    } catch (error) {
      // The PDS write already succeeded: do not turn indexing failure into a retry
      // that might publish twice. The stream/reconciliation repairs the projection.
      console.error(
        'Publication succeeded; local indexing requires reconciliation',
        error instanceof Error ? error.message : 'unknown error',
      );
    }
  }
  async publish(
    did: string,
    raw: unknown,
    existing?: { uri: string; cid: string },
  ): Promise<RecipeView> {
    const rkey = existing ? this.ownedUri(existing.uri, did).rkey : TID.nextStr();
    const agent = await this.getAgent(did);
    const previous = existing
      ? await agent.com.atproto.repo.getRecord({ repo: did, collection: RECIPE_COLLECTION, rkey })
      : undefined;
    if (existing && previous?.data.cid !== existing.cid)
      throw new HttpError(409, 'This recipe has changed. Reload it before saving.');
    const record = createRecipeRecord(
      raw,
      previous ? validateRecipeRecord(previous.data.value) : undefined,
    );
    const result = await agent.com.atproto.repo.putRecord({
      repo: did,
      collection: RECIPE_COLLECTION,
      rkey,
      record,
      swapRecord: existing?.cid ?? null,
    });
    await this.project({
      did,
      collection: RECIPE_COLLECTION,
      rkey,
      cid: result.data.cid,
      record,
      rev: result.data.commit?.rev || '',
    });
    return { uri: result.data.uri, cid: result.data.cid, authorDid: did, record };
  }
  private ownedUri(uri: string, did: string) {
    try {
      return parseRecipeUri(uri, did);
    } catch {
      throw new HttpError(403, 'You can only change your own recipes.');
    }
  }
  async delete(did: string, uri: string, cid: string) {
    const { rkey } = this.ownedUri(uri, did);
    const agent = await this.getAgent(did);
    const result = await agent.com.atproto.repo.deleteRecord({
      repo: did,
      collection: RECIPE_COLLECTION,
      rkey,
      swapRecord: cid,
    });
    await this.project({
      did,
      collection: RECIPE_COLLECTION,
      rkey,
      rev: result.data.commit?.rev || '',
      deleted: true,
    });
  }
  async follow(did: string, subject: string, remove = false) {
    if (did === subject) throw new HttpError(400, 'You cannot follow yourself.');
    const agent = await this.getAgent(did);
    // Stable keys make retries and repeated clicks idempotent across clients of this app.
    const rkey = createHash('sha256').update(subject).digest('hex');
    if (remove) {
      // Include follows created by other conforming clients with different rkeys.
      const rows = await this.store.db.query(
        'SELECT uri FROM follows WHERE did=$1 AND subject=$2',
        [did, subject],
      );
      const keys = new Set([rkey, ...rows.map((row) => row.uri.split('/').at(-1) as string)]);
      for (const key of keys) {
        const result = await agent.com.atproto.repo.deleteRecord({
          repo: did,
          collection: FOLLOW_COLLECTION,
          rkey: key,
        });
        await this.project({
          did,
          collection: FOLLOW_COLLECTION,
          rkey: key,
          rev: result.data.commit?.rev || '',
          deleted: true,
        });
      }
    } else {
      const record = { $type: FOLLOW_COLLECTION, subject, createdAt: new Date().toISOString() };
      const result = await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: FOLLOW_COLLECTION,
        rkey,
        record,
      });
      await this.project({
        did,
        collection: FOLLOW_COLLECTION,
        rkey,
        cid: result.data.cid,
        record,
        rev: result.data.commit?.rev || '',
      });
    }
  }
}
