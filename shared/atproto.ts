import { z } from 'zod';

export const RECIPE_COLLECTION = 'page.polli.brownbag.recipe' as const;
export const PROFILE_COLLECTION = 'page.polli.brownbag.profile' as const;
export const FOLLOW_COLLECTION = 'page.polli.brownbag.follow' as const;

// Match Lexicon limits in UTF-8 bytes, including for non-English recipes.
const text = (max: number, min = 0) =>
  z
    .string()
    .refine(
      (value) =>
        new TextEncoder().encode(value).length >= min &&
        new TextEncoder().encode(value).length <= max,
      `Must contain ${min}–${max} UTF-8 bytes`,
    );
export const didSchema = z
  .string()
  .max(2048)
  .regex(/^did:[a-z]+:[A-Za-z0-9._:%-]+$/);
const rkeyPattern = '[A-Za-z0-9._~:-]{1,512}';
const recipeUriSchema = z
  .string()
  .regex(
    new RegExp(
      `^at://did:[a-z]+:[A-Za-z0-9._:%-]+/${RECIPE_COLLECTION.replaceAll('.', '\\.')}/${rkeyPattern}$`,
    ),
  )
  .refine(
    (value) => !['.', '..'].includes(value.slice(value.lastIndexOf('/') + 1)),
    'Invalid record key',
  );
// Repository records use CIDv1, DAG-CBOR and SHA-256 in base32 representation.
export const strongRefSchema = z
  .object({ uri: recipeUriSchema, cid: z.string().regex(/^bafyre[a-z2-7]{53}$/) })
  .strict();
const imageSchema = z
  .object({
    image: z
      .object({
        $type: z.literal('blob'),
        ref: z.object({ $link: z.string().regex(/^bafkrei[a-z2-7]{52}$/) }).strict(),
        mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/avif']),
        size: z.number().int().positive().max(5_000_000),
      })
      .strict(),
    alt: text(2000),
    width: z.number().int().positive().max(100000).optional(),
    height: z.number().int().positive().max(100000).optional(),
  })
  .strict();
const sourceSchema = z
  .object({
    name: text(300).optional(),
    url: z
      .string()
      .url()
      .max(2000)
      .regex(/^https?:\/\//)
      .optional(),
  })
  .strict();
export const recipeInputSchema = z
  .object({
    title: text(200, 1).refine((value) => value.trim().length > 0, 'A title is required'),
    summary: text(1000).optional(),
    description: text(20000).optional(),
    ingredients: z
      .array(
        z
          .object({
            quantity: text(100).optional(),
            unit: text(50).optional(),
            name: text(300, 1),
            preparation: text(500).optional(),
            group: text(200).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(64),
    instructions: z
      .array(z.object({ text: text(10000, 1), group: text(200).optional() }).strict())
      .min(1)
      .max(64),
    yield: z
      .object({
        quantity: text(100).optional(),
        unit: text(100).optional(),
        display: text(300).optional(),
      })
      .strict()
      .optional(),
    prepMinutes: z.number().int().min(0).max(100000).optional(),
    cookMinutes: z.number().int().min(0).max(100000).optional(),
    tags: z.array(text(50, 1)).max(30).optional(),
    language: z
      .string()
      .max(100)
      .regex(/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/)
      .optional(),
    source: sourceSchema.optional(),
    derivedFrom: strongRefSchema.optional(),
    adaptationNote: text(2000).optional(),
    images: z.array(imageSchema).max(8).optional(),
  })
  .strict();
const timestamp = z.string().datetime({ offset: true });
export const recipeRecordSchema = recipeInputSchema
  .extend({
    $type: z.literal(RECIPE_COLLECTION),
    createdAt: timestamp,
    updatedAt: timestamp.optional(),
  })
  .strict();
export const profileRecordSchema = z
  .object({
    $type: z.literal(PROFILE_COLLECTION),
    displayName: text(200).optional(),
    description: text(2000).optional(),
    avatar: imageSchema.shape.image.optional(),
    banner: imageSchema.shape.image.optional(),
    cuisines: z.array(text(100, 1)).max(30).optional(),
    dietaryInterests: z.array(text(100, 1)).max(30).optional(),
    website: z
      .string()
      .url()
      .max(2000)
      .regex(/^https?:\/\//)
      .optional(),
    createdAt: timestamp,
    updatedAt: timestamp.optional(),
  })
  .strict();
export const followRecordSchema = z
  .object({ $type: z.literal(FOLLOW_COLLECTION), subject: didSchema, createdAt: timestamp })
  .strict();
export type RecipeInput = z.infer<typeof recipeInputSchema>;
// Drafts may be incomplete. They never enter a public repository until the
// stricter recipeInputSchema succeeds at publication.
export const draftInputSchema = recipeInputSchema.extend({
  title: z.string().max(200),
  ingredients: z
    .array(recipeInputSchema.shape.ingredients.element.extend({ name: z.string().max(300) }))
    .max(64),
  instructions: z
    .array(recipeInputSchema.shape.instructions.element.extend({ text: z.string().max(10000) }))
    .max(64),
});
export type RecipeRecord = z.infer<typeof recipeRecordSchema>;
export type RecipeView = {
  uri: string;
  cid: string;
  authorDid: string;
  authorHandle?: string;
  record: RecipeRecord;
  cookbookTags?: string[];
  cookbookAddedAt?: string;
};
export type Actor = { did: string; handle?: string; displayName?: string };
export type SessionUser = { did: string; handle?: string };

export const defaultCookbookTags = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
export const cookbookTagsSchema = z.array(z.string().trim().min(1).max(25)).max(100);
