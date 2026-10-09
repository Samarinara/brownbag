import { z } from 'zod';
import { addDays, calendarDateSchema, localDate } from './planner.js';

export const shoppingRangeSchema = z
  .object({
    from: calendarDateSchema,
    days: z.coerce.number().int().min(1).max(93).default(7),
  })
  .strict();
export const shoppingCheckSchema = shoppingRangeSchema.extend({
  key: z.string().regex(/^[a-f0-9]{64}$/),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  checked: z.boolean(),
});
export type ShoppingItem = {
  key: string;
  groupKey: string;
  fingerprint: string;
  ingredient: string;
  unit: string;
  quantity: string | null;
  unspecified: string[];
  checked: boolean;
};
export type ShoppingList = {
  from: string;
  to: string;
  days: number;
  mealCount: number;
  items: ShoppingItem[];
};
export function shoppingUrl(from = localDate(), days = 7) {
  return `/meal-planner/shopping-list?${new URLSearchParams({ from, days: String(days) })}`;
}
export function shoppingEnd(from: string, days: number) {
  return addDays(from, days - 1);
}
