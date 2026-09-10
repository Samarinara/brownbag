import { z } from 'zod';

export const recipeSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    shortDescription: z.string().trim().max(300).default(''),
    longDescription: z.string().trim().max(20000).default(''),
    ingredients: z
      .array(
        z
          .object({
            quantity: z.number().min(0).max(1000000).nullable().default(null),
            unit: z.string().trim().max(50).default(''),
            ingredient: z.string().trim().min(1).max(200),
            note: z.string().trim().max(300).default(''),
          })
          .strict(),
      )
      .min(1)
      .max(200),
    steps: z
      .array(z.object({ text: z.string().trim().min(1).max(10000) }).strict())
      .min(1)
      .max(200),
    tags: z.array(z.string().trim().min(1).max(50)).max(30).default([]),
    servings: z.number().positive().max(10000).nullable().default(null),
    prepMinutes: z.number().int().min(0).max(100000).nullable().default(null),
    cookMinutes: z.number().int().min(0).max(100000).nullable().default(null),
    sourceUrl: z
      .union([
        z.literal(''),
        z
          .string()
          .url()
          .max(2000)
          .refine((v) => /^https?:\/\//.test(v), 'Use an HTTP or HTTPS URL'),
      ])
      .default(''),
    notes: z.string().max(20000).default(''),
    metadata: z.record(z.unknown()).default({}),
  })
  .strict();
export type RecipeInput = z.infer<typeof recipeSchema>;
export type Recipe = RecipeInput & {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};
export type User = { id: string; email: string; yolo: boolean };
export type Change = {
  id: string;
  action: 'create' | 'update' | 'delete' | 'merge';
  recipeId: string | null;
  baseVersion: number | null;
  data: RecipeInput | null;
  sourceId?: string;
  sourceVersion?: number;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  keyName: string;
};
export type Revision = {
  id: string;
  recipeId: string;
  version: number;
  snapshot: Recipe;
  action: string;
  actor: string;
  createdAt: string;
};
export const changeSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), data: recipeSchema }).strict(),
  z
    .object({
      action: z.literal('update'),
      recipeId: z.string(),
      baseVersion: z.number().int().positive(),
      data: recipeSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('delete'),
      recipeId: z.string(),
      baseVersion: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      action: z.literal('merge'),
      recipeId: z.string(),
      baseVersion: z.number().int().positive(),
      sourceId: z.string(),
      sourceVersion: z.number().int().positive(),
      data: recipeSchema,
    })
    .strict(),
]);
export type ChangeInput = z.infer<typeof changeSchema>;
