import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import {
  cookbookTagsSchema,
  didSchema,
  draftInputSchema,
  strongRefSchema,
} from '../shared/atproto.js';
import { calendarDateSchema, mealSlotSchema } from '../shared/planner.js';
import { HttpError, type NetworkStore } from './network-store.js';

const timestamp = z.string().datetime({ offset: true });
const uri = strongRefSchema.shape.uri;
const tag = cookbookTagsSchema.element;
const decimal = z
  .string()
  .max(1000)
  .regex(/^\d+(?:\.\d+)?$/);
const array = <T extends z.ZodTypeAny>(schema: T) => z.array(schema).max(10000);
// The format deliberately contains no sessions, OAuth data, agent keys, proposals,
// audit logs, publication operations, or copies of other people's public records.
export const privateDataSchema = z
  .object({
    format: z.literal('brownbag-private-data'),
    version: z.literal(1),
    sourceDid: didSchema,
    exportedAt: timestamp,
    drafts: array(
      z.object({ id: z.string().uuid(), data: draftInputSchema, updatedAt: timestamp }).strict(),
    ),
    bookmarks: array(
      z
        .object({ uri, removed: z.boolean(), tags: cookbookTagsSchema, createdAt: timestamp })
        .strict(),
    ),
    tags: array(tag),
    plannerSettings: z.object({ defaultSlot: mealSlotSchema }).strict().nullable(),
    meals: array(
      z
        .object({
          id: z.string().uuid(),
          uri,
          date: calendarDateSchema,
          slot: mealSlotSchema,
          note: z.string().max(2000),
          createdAt: timestamp,
        })
        .strict(),
    ),
    purchases: array(
      z
        .object({
          date: calendarDateSchema,
          key: z.string().regex(/^[a-f0-9]{64}$/),
          quantity: decimal,
          unspecified: array(z.string().max(1000)),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((data, context) => {
    for (const [name, values] of [
      ['drafts', data.drafts.map((row) => row.id)],
      ['bookmarks', data.bookmarks.map((row) => row.uri)],
      ['tags', data.tags],
      ['meals', data.meals.map((row) => row.id)],
      ['purchases', data.purchases.map((row) => `${row.date}:${row.key}`)],
    ] as const) {
      if (new Set(values).size !== values.length)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [name],
          message: 'Duplicate entries are not allowed.',
        });
    }
  });
export type PrivateData = z.infer<typeof privateDataSchema>;
const json = (value: any) => (typeof value === 'string' ? JSON.parse(value) : value);
const iso = (value: Date | string) => new Date(value).toISOString();
const conflict = () =>
  new HttpError(
    409,
    'Restore conflicts with existing data or an unavailable recipe. No data was imported.',
  );

export class PrivateDataStore {
  constructor(private store: NetworkStore) {}

  async export(did: string): Promise<PrivateData> {
    return this.store.db.transaction(async (db) => {
      // A consistent snapshot across every table, including concurrent planner edits.
      await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const drafts = await db.query(
        'SELECT id,data,updated_at AS "updatedAt" FROM drafts WHERE did=$1 ORDER BY id',
        [did],
      );
      const bookmarks = await db.query(
        'SELECT uri,removed,tags,created_at AS "createdAt" FROM bookmarks WHERE did=$1 ORDER BY uri',
        [did],
      );
      const tags = await db.query('SELECT name FROM cookbook_tags WHERE did=$1 ORDER BY name', [
        did,
      ]);
      const [plannerSettings] = await db.query(
        'SELECT default_slot AS "defaultSlot" FROM planner_settings WHERE did=$1',
        [did],
      );
      const meals = await db.query(
        'SELECT id,uri,planned_date::text AS date,slot,note,created_at AS "createdAt" FROM meal_entries WHERE did=$1 ORDER BY planned_date,position',
        [did],
      );
      const purchases = await db.query(
        'SELECT planned_date::text AS date,item_key AS key,quantity::text AS quantity,unspecified FROM shopping_purchases WHERE did=$1 ORDER BY planned_date,item_key',
        [did],
      );
      return privateDataSchema.parse({
        format: 'brownbag-private-data',
        version: 1,
        sourceDid: did,
        exportedAt: new Date().toISOString(),
        drafts: drafts.map((row) => ({
          ...row,
          data: json(row.data),
          updatedAt: iso(row.updatedAt),
        })),
        bookmarks: bookmarks.map((row) => ({
          ...row,
          tags: json(row.tags),
          createdAt: iso(row.createdAt),
        })),
        tags: tags.map((row) => row.name),
        plannerSettings: plannerSettings || null,
        meals: meals.map((row) => ({ ...row, createdAt: iso(row.createdAt) })),
        purchases: purchases.map((row) => ({ ...row, unspecified: json(row.unspecified) })),
      });
    });
  }

  // Merge missing rows only: identical rows are harmless retries; different rows
  // conflict and roll back the entire file. No public records or authority are imported.
  // Existing planner/purchase pruning policies continue to apply after restoration.
  async restore(did: string, raw: unknown) {
    const input = privateDataSchema.parse(raw);
    await this.store.db.transaction(async (db) => {
      // The authenticated DID owns all writes. sourceDid is informational only.
      const actor = await db.query('SELECT did FROM actors WHERE did=$1 AND active FOR UPDATE', [
        did,
      ]);
      if (!actor.length) throw new HttpError(403, 'The signed-in account is unavailable.');
      const insert = async (sql: string, params: unknown[]) => {
        if (!(await db.query(sql, params)).length) throw conflict();
      };
      for (const row of input.drafts)
        await insert(
          `INSERT INTO drafts(id,did,data,updated_at) VALUES ($1,$2,$3::text::jsonb,$4)
          ON CONFLICT(id) DO UPDATE SET id=drafts.id WHERE drafts.did=excluded.did AND drafts.data=excluded.data RETURNING id`,
          [row.id, did, JSON.stringify(row.data), row.updatedAt],
        );
      for (const row of input.bookmarks)
        await insert(
          `INSERT INTO bookmarks(did,uri,removed,tags,created_at) VALUES ($1,$2,$3,$4::text::jsonb,$5)
          ON CONFLICT(did,uri) DO UPDATE SET uri=bookmarks.uri WHERE bookmarks.removed=excluded.removed AND bookmarks.tags=excluded.tags RETURNING uri`,
          [did, row.uri, row.removed, JSON.stringify(row.tags), row.createdAt],
        );
      for (const name of new Set([...input.tags, ...input.bookmarks.flatMap((row) => row.tags)]))
        await db.query(
          'INSERT INTO cookbook_tags(did,name) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [did, name],
        );
      if (input.plannerSettings)
        await insert(
          `INSERT INTO planner_settings(did,default_slot) VALUES ($1,$2)
          ON CONFLICT(did) DO UPDATE SET did=planner_settings.did WHERE planner_settings.default_slot=excluded.default_slot RETURNING did`,
          [did, input.plannerSettings.defaultSlot],
        );
      for (const row of input.meals) {
        // Lock the durable record so a concurrent accepted tombstone cannot race
        // the restore and leave a plan attached to an already-deleted recipe.
        const recipes = await db.query(
          `SELECT n.cid,n.record FROM network_records n JOIN actors a ON a.did=n.did
          LEFT JOIN public_recipes r ON r.uri=n.uri WHERE n.uri=$1 AND NOT n.deleted
          AND NOT n.recipe_hidden AND NOT coalesce(r.hidden,false) AND a.active AND n.cid IS NOT NULL AND n.record IS NOT NULL FOR UPDATE OF n`,
          [row.uri],
        );
        if (!recipes.length) throw conflict();
        const recipe = recipes[0];
        await insert(
          `INSERT INTO meal_entries(id,did,uri,planned_date,slot,note,created_at,recipe_cid,recipe_record)
          VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9::text::jsonb)
          ON CONFLICT(id) DO UPDATE SET id=meal_entries.id WHERE meal_entries.did=excluded.did AND meal_entries.uri=excluded.uri
          AND meal_entries.planned_date=excluded.planned_date AND meal_entries.slot=excluded.slot AND meal_entries.note=excluded.note RETURNING id`,
          [
            row.id,
            did,
            row.uri,
            row.date,
            row.slot,
            row.note,
            row.createdAt,
            recipe.cid,
            JSON.stringify(json(recipe.record)),
          ],
        );
      }
      for (const row of input.purchases)
        await insert(
          `INSERT INTO shopping_purchases(did,planned_date,item_key,quantity,unspecified) VALUES ($1,$2::date,$3,$4::numeric,$5::text::jsonb)
          ON CONFLICT(did,planned_date,item_key) DO UPDATE SET did=shopping_purchases.did
          WHERE shopping_purchases.quantity=excluded.quantity AND shopping_purchases.unspecified=excluded.unspecified RETURNING did`,
          [did, row.date, row.key, row.quantity, JSON.stringify(row.unspecified)],
        );
    });
    return { ok: true };
  }
}

export function mountPrivateData(app: Express, store: NetworkStore, requireUser: RequestHandler) {
  const data = new PrivateDataStore(store);
  app.get('/api/private-data/export', requireUser, async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', 'attachment; filename="brownbag-private-data.json"');
    res.json(await data.export(res.locals.user.did));
  });
  app.post('/api/private-data/restore', requireUser, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await data.restore(res.locals.user.did, req.body));
  });
}
