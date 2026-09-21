import { randomUUID } from 'node:crypto';
import type { Database } from './db.js';
import {
  RECIPE_COLLECTION,
  FOLLOW_COLLECTION,
  PROFILE_COLLECTION,
  draftInputSchema,
  recipeRecordSchema,
  followRecordSchema,
  profileRecordSchema,
  type RecipeView,
} from '../shared/atproto.js';
import { validateRecipeRecord } from './atproto/records.js';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export class NetworkStore {
  constructor(public db: Database) {}

  async actor(did: string, handle?: string) {
    await this.db.query(
      `INSERT INTO actors(did,handle) VALUES ($1,$2) ON CONFLICT(did) DO UPDATE SET handle=coalesce(excluded.handle,actors.handle)`,
      [did, handle || null],
    );
  }

  async index(input: {
    did: string;
    collection: string;
    rkey: string;
    cid?: string;
    record?: unknown;
    rev: string;
    deleted?: boolean;
  }) {
    const { did, collection, rkey, cid, rev, deleted = false } = input;
    if (
      !([RECIPE_COLLECTION, FOLLOW_COLLECTION, PROFILE_COLLECTION] as string[]).includes(collection)
    )
      return;
    const uri = `at://${did}/${collection}/${rkey}`;
    let record: any = null;
    if (!deleted) {
      if (!cid) throw new Error('Missing CID');
      record =
        collection === RECIPE_COLLECTION
          ? validateRecipeRecord(input.record)
          : (collection === FOLLOW_COLLECTION ? followRecordSchema : profileRecordSchema).parse(
              input.record,
            );
    }
    await this.db.transaction(async (tx) => {
      await tx.query('INSERT INTO actors(did) VALUES ($1) ON CONFLICT DO NOTHING', [did]);
      const changed = await tx.query(
        `INSERT INTO network_records(uri,did,collection,rkey,cid,record,repo_rev,deleted)
        VALUES ($1,$2,$3,$4,$5,$6::text::jsonb,$7,$8)
        ON CONFLICT(uri) DO UPDATE SET cid=excluded.cid,record=excluded.record,repo_rev=excluded.repo_rev,deleted=excluded.deleted,indexed_at=now()
        WHERE network_records.repo_rev <= excluded.repo_rev RETURNING uri`,
        [
          uri,
          did,
          collection,
          rkey,
          cid || null,
          record ? JSON.stringify(record) : null,
          rev,
          deleted,
        ],
      );
      if (!changed.length) return;
      if (collection === RECIPE_COLLECTION) {
        if (deleted) await tx.query('DELETE FROM public_recipes WHERE uri=$1', [uri]);
        else {
          const ingredients = record.ingredients.map((i: any) => i.name).join(' ');
          await tx.query(
            `INSERT INTO public_recipes(uri,did,cid,record,title,ingredient_text,search_document,created_at)
            VALUES ($1,$2,$3,$4::text::jsonb,$5,$6,setweight(to_tsvector('simple',$5),'A') || setweight(to_tsvector('simple',$6),'B'),$7)
            ON CONFLICT(uri) DO UPDATE SET cid=excluded.cid,record=excluded.record,title=excluded.title,ingredient_text=excluded.ingredient_text,search_document=excluded.search_document`,
            [uri, did, cid, JSON.stringify(record), record.title, ingredients, record.createdAt],
          );
        }
      } else if (collection === FOLLOW_COLLECTION) {
        if (deleted) await tx.query('DELETE FROM follows WHERE uri=$1', [uri]);
        else
          await tx.query(
            'INSERT INTO follows(uri,did,subject) VALUES ($1,$2,$3) ON CONFLICT(uri) DO UPDATE SET subject=excluded.subject',
            [uri, did, record.subject],
          );
      } else if (rkey === 'self') {
        await tx.query(
          'UPDATE actors SET profile=$2::text::jsonb,profile_rev=$3,updated_at=now() WHERE did=$1 AND profile_rev <= $3',
          [did, record ? JSON.stringify(record) : null, rev],
        );
      }
    });
  }

  private view(row: any): RecipeView {
    // postgres.js serializes parameters according to their inferred database type. Older
    // deployments passed an already-stringified value directly to jsonb, which stored a JSON
    // string scalar. Keep reads compatible until migration 002 has normalized every row.
    const record = typeof row.record === 'string' ? JSON.parse(row.record) : row.record;
    return {
      uri: row.uri,
      cid: row.cid,
      authorDid: row.did,
      ...(row.handle ? { authorHandle: row.handle } : {}),
      record,
      ...(row.cookbook_tags !== undefined
        ? {
            cookbookAddedAt: new Date(row.cookbook_date).toISOString(),
            cookbookTags: row.cookbook_tags || [],
          }
        : {}),
    };
  }

  async recipes(
    options: {
      q?: string;
      feed?: string;
      did?: string;
      limit?: number;
      cursor?: string;
      tag?: string;
    } = {},
  ) {
    const { q = '', feed = 'discover', did, limit = 24, cursor, tag } = options;
    const params: any[] = [];
    const bind = (v: any) => {
      params.push(v);
      return `$${params.length}`;
    };
    const where = ['a.active', 'NOT r.hidden'];
    if (q) {
      const p = bind(q);
      where.push(
        `(r.search_document @@ plainto_tsquery('simple',${p}) OR r.title ILIKE '%' || ${p} || '%')`,
      );
    }
    if (feed !== 'discover' && !did) throw new HttpError(401, 'Sign in to see your cookbook.');
    const cookbook = feed === 'cookbook';
    const join = cookbook ? `LEFT JOIN bookmarks b ON b.uri=r.uri AND b.did=${bind(did)}` : '';
    const date = cookbook ? 'COALESCE(b.created_at,r.created_at)' : 'r.created_at';
    if (cookbook) {
      where.push(`(r.did=${bind(did)} OR b.uri IS NOT NULL) AND NOT COALESCE(b.removed,false)`);
      if (tag) where.push(`COALESCE(b.tags,'[]'::jsonb) ? ${bind(tag)}`);
    }
    if (feed === 'mine') where.push(`r.did=${bind(did)}`);
    if (feed === 'saved')
      where.push(
        `EXISTS(SELECT 1 FROM bookmarks b WHERE b.uri=r.uri AND b.did=${bind(did)} AND NOT b.removed)`,
      );
    if (feed === 'following')
      where.push(`EXISTS(SELECT 1 FROM follows f WHERE f.subject=r.did AND f.did=${bind(did)})`);
    if (cursor) {
      try {
        const value = JSON.parse(Buffer.from(cursor, 'base64url').toString());
        if (typeof value.uri !== 'string' || !Number.isFinite(Date.parse(value.date)))
          throw new Error();
        where.push(`(${date},r.uri)<(${bind(value.date)}::timestamptz,${bind(value.uri)})`);
      } catch {
        throw new HttpError(400, 'Invalid page cursor.');
      }
    }
    const rows = await this.db.query(
      `SELECT r.*,a.handle,${date} AS cookbook_date${cookbook ? ',b.tags AS cookbook_tags' : ''} FROM public_recipes r JOIN actors a ON a.did=r.did ${join} WHERE ${where.join(' AND ')} ORDER BY ${date} DESC,r.uri DESC LIMIT ${bind(limit + 1)}`,
      params,
    );
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      recipes: page.map((row) => this.view(row)),
      ...(rows.length > limit && last
        ? {
            nextCursor: Buffer.from(
              JSON.stringify({ date: new Date(last.cookbook_date).toISOString(), uri: last.uri }),
            ).toString('base64url'),
          }
        : {}),
    };
  }
  async recipe(uri: string) {
    const [row] = await this.db.query(
      'SELECT r.*,a.handle FROM public_recipes r JOIN actors a ON a.did=r.did WHERE r.uri=$1 AND a.active AND NOT r.hidden',
      [uri],
    );
    if (!row) throw new HttpError(404, 'Recipe not found.');
    return this.view(row);
  }
  async cookbookEntry(did: string, uri: string) {
    const recipe = await this.recipe(uri);
    const [entry] = await this.db.query(
      'SELECT removed,tags FROM bookmarks WHERE did=$1 AND uri=$2',
      [did, uri],
    );
    return { saved: entry ? !entry.removed : recipe.authorDid === did, tags: entry?.tags || [] };
  }
  async saveCookbook(did: string, uri: string, tags?: string[]) {
    const recipe = await this.recipe(uri);
    await this.db.transaction(async (db) => {
      await db.query(
        `INSERT INTO bookmarks(did,uri,tags,created_at) VALUES ($1,$2,$3::text::jsonb,$4)
        ON CONFLICT(did,uri) DO UPDATE SET removed=false,
        created_at=CASE WHEN bookmarks.removed THEN now() ELSE bookmarks.created_at END,
        tags=CASE WHEN $5 THEN EXCLUDED.tags ELSE bookmarks.tags END`,
        [
          did,
          uri,
          JSON.stringify(tags || []),
          recipe.authorDid === did ? recipe.record.createdAt : new Date().toISOString(),
          tags !== undefined,
        ],
      );
      for (const tag of tags || [])
        await db.query(
          'INSERT INTO cookbook_tags(did,name) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [did, tag],
        );
    });
  }
  async removeCookbook(did: string, uri: string) {
    await this.db.query(
      `INSERT INTO bookmarks(did,uri,removed) VALUES ($1,$2,true)
      ON CONFLICT(did,uri) DO UPDATE SET removed=true,tags='[]'::jsonb`,
      [did, uri],
    );
  }
  async drafts(did: string) {
    return this.db.query(
      'SELECT id,data,updated_at AS "updatedAt" FROM drafts WHERE did=$1 ORDER BY updated_at DESC',
      [did],
    );
  }
  async saveDraft(did: string, raw: unknown, id?: string) {
    const data = draftInputSchema.parse(raw);
    if (id) {
      const [draft] = await this.db.query(
        'UPDATE drafts SET data=$3::text::jsonb,updated_at=now() WHERE id=$1 AND did=$2 RETURNING id,data,updated_at AS "updatedAt"',
        [id, did, JSON.stringify(data)],
      );
      if (!draft) throw new HttpError(404, 'Draft not found.');
      return draft;
    }
    const [draft] = await this.db.query(
      'INSERT INTO drafts(id,did,data) VALUES ($1,$2,$3::text::jsonb) RETURNING id,data,updated_at AS "updatedAt"',
      [randomUUID(), did, JSON.stringify(data)],
    );
    return draft;
  }
  async rateLimit(key: string, limit = 60, seconds = 60) {
    const [row] = await this.db.query(
      `INSERT INTO rate_limits(key,count,expires_at) VALUES ($1,1,now()+$2*interval '1 second')
      ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.expires_at<now() THEN 1 ELSE rate_limits.count+1 END,
      expires_at=CASE WHEN rate_limits.expires_at<now() THEN excluded.expires_at ELSE rate_limits.expires_at END RETURNING count`,
      [key, seconds],
    );
    if (row.count > limit) throw new HttpError(429, 'Too many requests. Please try again shortly.');
  }
  async audit(did: string, event: string, detail: unknown) {
    await this.db.query(
      'INSERT INTO audit_events(did,event,detail) VALUES ($1,$2,$3::text::jsonb)',
      [did, event, JSON.stringify(detail)],
    );
  }
}
