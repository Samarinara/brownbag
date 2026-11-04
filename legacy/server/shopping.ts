import { createHash } from 'node:crypto';
import type { Express, RequestHandler } from 'express';
import type { Database } from './db.js';
import { HttpError, type NetworkStore } from './network-store.js';
import { pruneMealPlans } from './planner.js';
import {
  shoppingCheckSchema,
  shoppingEnd,
  shoppingRangeSchema,
  type ShoppingItem,
  type ShoppingList,
} from '../shared/shopping.js';

// Exact decimal factors; PostgreSQL performs the arithmetic without JS float rounding.
// Unqualified customary volume measures use US measures. Unknown units stay separate.
const units: { alias: string; unit: string; factor: string }[] = [];
function measure(unit: string, factor: string, aliases: string[]) {
  for (const alias of aliases) units.push({ alias, unit, factor });
}
measure('', '1', ['', 'count', 'counts', 'each', 'ea', 'piece', 'pieces']);
measure('g', '1', ['g', 'gram', 'grams']);
measure('g', '1000', ['kg', 'kilogram', 'kilograms']);
measure('g', '0.001', ['mg', 'milligram', 'milligrams']);
measure('g', '28.349523125', ['oz', 'ounce', 'ounces']);
measure('g', '453.59237', ['lb', 'lbs', 'pound', 'pounds']);
measure('ml', '1', ['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres']);
measure('ml', '1000', ['l', 'liter', 'liters', 'litre', 'litres']);
measure('ml', '4.92892159375', ['tsp', 'tsp.', 'teaspoon', 'teaspoons']);
measure('ml', '14.78676478125', ['tbsp', 'tbsp.', 'tablespoon', 'tablespoons']);
measure('ml', '236.5882365', ['cup', 'cups']);
measure('ml', '29.5735295625', ['fl oz', 'fl. oz.', 'fluid ounce', 'fluid ounces']);
measure('ml', '473.176473', ['pt', 'pint', 'pints']);
measure('ml', '946.352946', ['qt', 'quart', 'quarts']);
measure('ml', '3785.411784', ['gal', 'gallon', 'gallons']);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const decimal = (value: string | null): string | null =>
  value === null ? null : value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;

type DailyIngredient = {
  date: string;
  ingredient: string;
  unit: string;
  quantity: string | null;
  unspecified: string[];
};
// Align decimal scales before arithmetic so both large counts and fractions stay exact.
function arithmetic(a: string, b: string, subtract = false): string {
  const [aw, af = ''] = a.split('.');
  const [bw, bf = ''] = b.split('.');
  const scale = Math.max(af.length, bf.length);
  const av = BigInt(aw + af.padEnd(scale, '0'));
  const bv = BigInt(bw + bf.padEnd(scale, '0'));
  const result = subtract ? av - bv : av + bv;
  if (result <= 0n) return '0';
  const digits = result.toString().padStart(scale + 1, '0');
  return decimal(scale ? digits.slice(0, -scale) + '.' + digits.slice(-scale) : digits)!;
}
const subtract = (a: string, b: string) => arithmetic(a, b, true);
const minimum = (a: string, b: string) => (subtract(a, b) === '0' ? a : b);
function counts(values: string[]) {
  const result = new Map<string, number>();
  for (const value of values) result.set(value, (result.get(value) || 0) + 1);
  return result;
}
function take(values: string[], available: Map<string, number>) {
  const covered: string[] = [];
  const remaining: string[] = [];
  for (const value of values) {
    const count = available.get(value) || 0;
    if (count) {
      covered.push(value);
      available.set(value, count - 1);
    } else remaining.push(value);
  }
  return { covered, remaining };
}

export class ShoppingStore {
  constructor(private store: NetworkStore) {}

  private async build(db: Database, did: string, from: string, days: number) {
    const to = shoppingEnd(from, days);
    const [count] = await db.query(
      `SELECT count(*)::integer AS count FROM meal_entries m
       JOIN public_recipes r ON r.uri=m.uri JOIN actors a ON a.did=r.did
       WHERE m.did=$1 AND m.planned_date BETWEEN $2::date AND $3::date
       AND a.active AND NOT r.hidden`,
      [did, from, to],
    );
    // Serialized JSON must bind as text so Postgres.js doesn't JSON-encode it again.
    const rows = await db.query<DailyIngredient>(
      `WITH units AS (
         SELECT * FROM jsonb_to_recordset($4::text::jsonb) AS u(alias text,unit text,factor numeric)
       ), ingredients AS (
         SELECT m.planned_date::text AS date,i.name_key AS ingredient,coalesce(u.unit,i.unit_key) AS unit,
           i.quantity_value * coalesce(u.factor,1) AS quantity,
           CASE WHEN i.quantity_value IS NULL THEN
             btrim(concat_ws(' ',nullif(i.quantity_text,''),nullif(i.unit_key,''))) END AS unspecified
         FROM meal_entries m JOIN recipe_ingredients i ON i.recipe_uri=m.uri
         JOIN public_recipes r ON r.uri=m.uri JOIN actors a ON a.did=r.did
         LEFT JOIN units u ON u.alias=i.unit_key
         WHERE m.did=$1 AND m.planned_date BETWEEN $2::date AND $3::date
           AND a.active AND NOT r.hidden
       ) SELECT date,ingredient,unit,sum(quantity)::text AS quantity,
         coalesce(jsonb_agg(unspecified ORDER BY unspecified) FILTER (WHERE unspecified IS NOT NULL),'[]'::jsonb) AS unspecified
       FROM ingredients GROUP BY date,ingredient,unit ORDER BY ingredient,unit,date`,
      [did, from, to, JSON.stringify(units)],
    );
    await db.query(
      "DELETE FROM shopping_purchases WHERE did=$1 AND planned_date < ((now() AT TIME ZONE 'UTC')::date - interval '1 month')::date",
      [did],
    );
    const purchases = await db.query<{
      date: string;
      key: string;
      quantity: string;
      unspecified: string[];
    }>(
      'SELECT planned_date::text AS date,item_key AS key,quantity::text,unspecified FROM shopping_purchases WHERE did=$1 AND planned_date BETWEEN $2::date AND $3::date ORDER BY planned_date',
      [did, from, to],
    );
    const groups = new Map<string, DailyIngredient[]>();
    for (const row of rows) {
      row.quantity = decimal(row.quantity);
      row.unspecified = row.unspecified.map((value) => value || 'Amount not specified');
      const key = hash([row.ingredient, row.unit]);
      const group = groups.get(key) || [];
      group.push(row);
      groups.set(key, group);
    }
    const items: ShoppingItem[] = [];
    for (const [groupKey, group] of groups) {
      const credits = purchases.filter((purchase) => purchase.key === groupKey);
      const required = group.reduce((sum, row) => arithmetic(sum, row.quantity || '0'), '0');
      const purchased = credits.reduce((sum, row) => arithmetic(sum, row.quantity), '0');
      const covered = minimum(required, purchased);
      const remaining = subtract(required, purchased);
      const unknown = group.flatMap((row) => row.unspecified);
      const unspecified = take(unknown, counts(credits.flatMap((row) => row.unspecified)));
      const hasNumeric = group.some((row) => row.quantity !== null);
      const zeroBought = hasNumeric && required === '0' && credits.length > 0;
      const fingerprint = hash([group, credits]);
      const base = { groupKey, fingerprint, ingredient: group[0].ingredient, unit: group[0].unit };
      const hasBought = covered !== '0' || unspecified.covered.length > 0 || zeroBought;
      if (hasBought)
        items.push({
          ...base,
          key: hash([groupKey, 'bought']),
          quantity: hasNumeric ? covered : null,
          unspecified: unspecified.covered,
          checked: true,
        });
      if (remaining !== '0' || unspecified.remaining.length || !hasBought)
        items.push({
          ...base,
          key: hash([groupKey, 'needed']),
          quantity: hasNumeric ? remaining : null,
          unspecified: unspecified.remaining,
          checked: false,
        });
    }
    const list: ShoppingList = { from, to, days, mealCount: count.count, items };
    return { list, groups, purchases };
  }

  async list(did: string, from: string, days: number) {
    await pruneMealPlans(this.store.db);
    return this.store.db.transaction(async (db) => (await this.build(db, did, from, days)).list);
  }

  async setChecked(did: string, raw: unknown) {
    const input = shoppingCheckSchema.parse(raw);
    return this.store.db.transaction(async (db) => {
      // Serialize purchases for this account so simultaneous taps cannot double-count credits.
      await db.query('SELECT did FROM actors WHERE did=$1 FOR UPDATE', [did]);
      const { list, groups, purchases } = await this.build(db, did, input.from, input.days);
      const item = list.items.find((item) => item.key === input.key);
      if (!item || item.fingerprint !== input.fingerprint)
        throw new HttpError(409, 'Your shopping list changed. Refresh it and try again.');
      if (input.checked) {
        const credits = purchases.filter((purchase) => purchase.key === item.groupKey);
        const daily = groups.get(item.groupKey)!;
        const requirements = new Map(daily.map((row) => [row.date, row]));
        const dailyCredits = new Map(credits.map((row) => [row.date, row]));
        let available = credits.reduce(
          (sum, row) =>
            arithmetic(sum, subtract(row.quantity, requirements.get(row.date)?.quantity || '0')),
          '0',
        );
        const unknown = counts(
          credits.flatMap(
            (row) =>
              take(row.unspecified, counts(requirements.get(row.date)?.unspecified || []))
                .remaining,
          ),
        );
        for (const row of daily) {
          const required = row.quantity || '0';
          const credit = dailyCredits.get(row.date);
          const deficit = subtract(required, credit?.quantity || '0');
          const quantity = subtract(deficit, available);
          available = subtract(available, deficit);
          const unspecified = take(
            take(row.unspecified, counts(credit?.unspecified || [])).remaining,
            unknown,
          ).remaining;
          if (quantity === '0' && !unspecified.length && required !== '0') continue;
          await db.query(
            `INSERT INTO shopping_purchases(did,planned_date,item_key,quantity,unspecified) VALUES ($1,$2::date,$3,$4::numeric,$5::text::jsonb)
             ON CONFLICT(did,planned_date,item_key) DO UPDATE SET quantity=shopping_purchases.quantity+excluded.quantity,unspecified=shopping_purchases.unspecified || excluded.unspecified`,
            [did, row.date, item.groupKey, quantity, JSON.stringify(unspecified)],
          );
        }
      } else {
        await db.query(
          'DELETE FROM shopping_purchases WHERE did=$1 AND planned_date BETWEEN $2::date AND $3::date AND item_key=$4',
          [did, input.from, list.to, item.groupKey],
        );
      }
      return (await this.build(db, did, input.from, input.days)).list;
    });
  }
}
export function mountShopping(app: Express, store: NetworkStore, requireUser: RequestHandler) {
  const shopping = new ShoppingStore(store);
  app.get('/api/planner/shopping-list', requireUser, async (req, res) => {
    // Hosting rewrites can add routing metadata such as `path` to the query.
    const { from, days } = shoppingRangeSchema.parse({
      from: req.query.from,
      days: req.query.days,
    });
    res.json(await shopping.list(res.locals.user.did, from, days));
  });
  app.put('/api/planner/shopping-list/check', requireUser, async (req, res) => {
    res.json(await shopping.setChecked(res.locals.user.did, req.body));
  });
}
