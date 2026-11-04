import { z } from "zod";
export const ingredientSchema = z
  .object({
    name: z.string().trim().min(1).max(300),
    quantity: z.string().max(100).optional(),
    unit: z.string().max(50).optional(),
    preparation: z.string().max(500).optional(),
    group: z.string().max(200).optional(),
  })
  .strict();
export const recipeInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    summary: z.string().max(1000).optional(),
    description: z.string().max(20000).optional(),
    ingredients: z.array(ingredientSchema).min(1).max(64),
    instructions: z
      .array(
        z
          .object({
            text: z.string().trim().min(1).max(10000),
            group: z.string().max(200).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(64),
    yield: z
      .object({
        quantity: z.string().max(100).optional(),
        unit: z.string().max(100).optional(),
        display: z.string().max(300).optional(),
      })
      .strict()
      .optional(),
    prepMinutes: z.number().int().min(0).max(100000).optional(),
    cookMinutes: z.number().int().min(0).max(100000).optional(),
    tags: z.array(z.string().min(1).max(50)).max(30).optional(),
    language: z.string().max(35).optional(),
    source: z
      .object({
        url: z
          .url()
          .max(2000)
          .regex(/^https?:\/\//)
          .optional(),
        name: z.string().max(300).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type RecipeInput = z.infer<typeof recipeInputSchema>;
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(s + "T12:00:00Z");
    return !Number.isNaN(+d) && d.toISOString().slice(0, 10) === s;
  }, "Choose a valid date.");
export const mealSchema = z
  .object({
    recipeId: z.uuid(),
    date: dateSchema,
    slot: z.enum(["Breakfast", "Lunch", "Dinner"]),
    title: z.string().min(1).max(200),
  })
  .strict();
export const shoppingSchema = z
  .object({ name: z.string().trim().min(1).max(500), checked: z.boolean() })
  .strict();
export const payloadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("recipe"), data: recipeInputSchema }).strict(),
  z.object({ kind: z.literal("meal"), data: mealSchema }).strict(),
  z.object({ kind: z.literal("shopping"), data: shoppingSchema }).strict(),
]);
export type Payload = z.infer<typeof payloadSchema>;
export type Item = {
  id: string;
  revision: number;
  updatedAt: string;
  payload: Payload;
};
export const itemSchema = z.object({
  id: z.uuid(),
  revision: z.number().int().positive(),
  updatedAt: z.string(),
  payload: payloadSchema,
});
export const saveSchema = z
  .object({
    id: z.uuid(),
    revision: z.number().int().nonnegative(),
    payload: payloadSchema,
  })
  .strict();
export function titleOf(payload: Payload) {
  return payload.kind === "recipe"
    ? payload.data.title
    : payload.kind === "meal"
      ? payload.data.title
      : payload.data.name;
}
export function dayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function ingredientText(i: RecipeInput["ingredients"][number]) {
  return [i.quantity, i.unit, i.name, i.preparation].filter(Boolean).join(" ");
}
