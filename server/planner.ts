import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import {
  calendarDateSchema,
  mealInputSchema,
  mealPatchSchema,
  mealSlotSchema,
  type MealEntry,
  type PlannerSettings,
} from '../shared/planner.js';
import { HttpError, type NetworkStore } from './network-store.js';
import type { Database } from './db.js';

// Calendar dates are retained for one calendar month, with a stable UTC cutoff.
export async function pruneMealPlans(db: Database) {
  await db.query(
    "DELETE FROM meal_entries WHERE planned_date < ((now() AT TIME ZONE 'UTC')::date - interval '1 month')::date",
  );
}
export class PlannerStore {
  constructor(private store: NetworkStore) {}
  async settings(did: string): Promise<PlannerSettings> {
    const [row] = await this.store.db.query(
      'SELECT default_slot AS "defaultSlot" FROM planner_settings WHERE did=$1',
      [did],
    );
    return (row as PlannerSettings) || { defaultSlot: 'dinner' };
  }
  async setSettings(did: string, defaultSlot: string) {
    await this.store.db.query(
      'INSERT INTO planner_settings(did,default_slot) VALUES ($1,$2) ON CONFLICT(did) DO UPDATE SET default_slot=excluded.default_slot',
      [did, mealSlotSchema.parse(defaultSlot)],
    );
    return this.settings(did);
  }
  async list(did: string, from: string, to: string): Promise<MealEntry[]> {
    await pruneMealPlans(this.store.db);
    const rows = await this.store.db.query(
      `SELECT m.id,m.planned_date::text AS date,m.slot,m.note,r.uri,r.cid,r.did,r.record,a.handle
      FROM meal_entries m JOIN public_recipes r ON r.uri=m.uri JOIN actors a ON a.did=r.did
      WHERE m.did=$1 AND m.planned_date BETWEEN $2::date AND $3::date AND a.active AND NOT r.hidden
      ORDER BY m.planned_date,m.position`,
      [did, from, to],
    );
    return rows.map((row) => ({
      id: row.id,
      date: row.date,
      slot: row.slot,
      note: row.note,
      recipe: {
        uri: row.uri,
        cid: row.cid,
        authorDid: row.did,
        authorHandle: row.handle || undefined,
        record: typeof row.record === 'string' ? JSON.parse(row.record) : row.record,
      },
    }));
  }
  async validateDate(date: string) {
    const [row] = await this.store.db.query(
      "SELECT $1::date >= ((now() AT TIME ZONE 'UTC')::date - interval '1 month')::date AS valid",
      [date],
    );
    if (!row.valid)
      throw new HttpError(400, 'Choose a date within the last month or in the future.');
  }
  async add(did: string, raw: unknown) {
    const input = mealInputSchema.parse(raw);
    await this.validateDate(input.date);
    await this.store.recipe(input.uri);
    const rows = await this.store.db.query(
      `INSERT INTO meal_entries(id,did,uri,planned_date,slot,note) VALUES ($1,$2,$3,$4::date,$5,$6)
      ON CONFLICT(id) DO NOTHING RETURNING id`,
      [input.id, did, input.uri, input.date, input.slot, input.note],
    );
    if (!rows.length) {
      const [existing] = await this.store.db.query(
        'SELECT id FROM meal_entries WHERE id=$1 AND did=$2 AND uri=$3 AND planned_date=$4::date AND slot=$5 AND note=$6',
        [input.id, did, input.uri, input.date, input.slot, input.note],
      );
      if (!existing)
        throw new HttpError(409, 'This meal changed. Refresh the planner and try again.');
    }
    return { id: input.id };
  }
  async update(did: string, id: string, raw: unknown) {
    const patch = mealPatchSchema.parse(raw);
    if (patch.date) await this.validateDate(patch.date);
    const rows = await this.store.db.query(
      `UPDATE meal_entries SET planned_date=coalesce($3::date,planned_date),slot=coalesce($4,slot),note=coalesce($5,note)
      WHERE id=$1 AND did=$2 RETURNING id`,
      [id, did, patch.date ?? null, patch.slot ?? null, patch.note ?? null],
    );
    if (!rows.length) throw new HttpError(404, 'Planned recipe not found.');
  }
  async remove(did: string, id: string) {
    const rows = await this.store.db.query(
      'DELETE FROM meal_entries WHERE id=$1 AND did=$2 RETURNING id',
      [id, did],
    );
    if (!rows.length) throw new HttpError(404, 'Planned recipe not found.');
  }
}
export function mountPlanner(app: Express, store: NetworkStore, requireUser: RequestHandler) {
  const planner = new PlannerStore(store);
  app.get('/api/planner/settings', requireUser, async (_req, res) =>
    res.json(await planner.settings(res.locals.user.did)),
  );
  app.put('/api/planner/settings', requireUser, async (req, res) => {
    const { defaultSlot } = z.object({ defaultSlot: mealSlotSchema }).strict().parse(req.body);
    res.json(await planner.setSettings(res.locals.user.did, defaultSlot));
  });
  app.get('/api/planner', requireUser, async (req, res) => {
    const { from, to } = z
      .object({ from: calendarDateSchema, to: calendarDateSchema })
      .refine(
        ({ from, to }) => from <= to && Date.parse(to) - Date.parse(from) <= 93 * 86400000,
        'Choose a range of up to 93 days.',
      )
      .parse(req.query);
    res.json({ entries: await planner.list(res.locals.user.did, from, to) });
  });
  app.post('/api/planner', requireUser, async (req, res) =>
    res.status(201).json(await planner.add(res.locals.user.did, req.body)),
  );
  app.patch('/api/planner/:id', requireUser, async (req, res) => {
    await planner.update(res.locals.user.did, z.string().uuid().parse(req.params.id), req.body);
    res.json({ ok: true });
  });
  app.delete('/api/planner/:id', requireUser, async (req, res) => {
    await planner.remove(res.locals.user.did, z.string().uuid().parse(req.params.id));
    res.json({ ok: true });
  });
}
