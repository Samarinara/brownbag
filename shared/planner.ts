import { z } from 'zod';
import type { RecipeView } from './atproto.js';

export const mealSlots = ['breakfast', 'lunch', 'dinner', 'other'] as const;
export const mealLabels = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  other: 'Other',
};
export const mealSlotSchema = z.enum(mealSlots);
export type MealSlot = z.infer<typeof mealSlotSchema>;
export const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T12:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Choose a valid date.');
export const mealTargetSchema = z
  .object({ date: calendarDateSchema, slot: mealSlotSchema })
  .strict();
export type MealTarget = z.infer<typeof mealTargetSchema>;
export const mealInputSchema = mealTargetSchema
  .extend({
    id: z.string().uuid(),
    uri: z.string().min(1).max(3000),
    note: z.string().max(2000).default(''),
  })
  .strict();
export const mealPatchSchema = mealTargetSchema
  .extend({ note: z.string().max(2000) })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide a change.');
export type MealEntry = MealTarget & { id: string; note: string; recipe: RecipeView };
export type PlannerSettings = { defaultSlot: MealSlot };
export function localDate(date = new Date()): string {
  return `${date.getFullYear().toString().padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function dateObject(date: string): Date {
  return new Date(`${date}T12:00:00`);
}
export function addDays(date: string, count: number): string {
  const value = dateObject(date);
  value.setDate(value.getDate() + count);
  return localDate(value);
}
export function weekStart(date: string): string {
  return addDays(date, -dateObject(date).getDay());
}
export function retentionStart(now = new Date()): string {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 1, Math.min(now.getUTCDate(), lastDay)))
    .toISOString()
    .slice(0, 10);
}
export function plannerUrl(date = localDate(), day = false): string {
  return `/meal-planner${day ? '/day' : ''}?date=${date}`;
}
export function targetFromRoute(route: string): MealTarget | undefined {
  const params = new URL(route, 'http://localhost').searchParams;
  const result = mealTargetSchema.safeParse({
    date: params.get('planDate'),
    slot: params.get('planSlot'),
  });
  return result.success ? result.data : undefined;
}
