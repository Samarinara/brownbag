import {
  RECIPE_COLLECTION,
  MAX_RECIPE_RECORD_BYTES,
  recipeInputSchema,
  type RecipeInput,
  type RecipeRecord,
} from '../shared/atproto';

export const blankRecipe = (): RecipeInput => ({
  title: '',
  ingredients: [{ name: '' }],
  instructions: [{ text: '' }],
});

export function editableRecipe(record: RecipeInput | RecipeRecord): RecipeInput {
  const {
    $type: _type,
    createdAt: _created,
    updatedAt: _updated,
    ...data
  } = record as RecipeRecord;
  return structuredClone(data);
}

export function adaptRecipe(record: RecipeRecord, uri: string, cid: string): RecipeInput {
  // Blobs belong to the original cook's repository; an adaptation must attach its own photos.
  const { images: _images, ...data } = editableRecipe(record);
  return {
    ...data,
    title: `${record.title} — my take`,
    derivedFrom: { uri, cid },
    adaptationNote: undefined,
  };
}

export function recipeIssueLabel(path: PropertyKey[]): string {
  const [field, index, child] = path;
  if (field === 'ingredients')
    return `Ingredient ${typeof index === 'number' ? index + 1 : ''}${child ? ` ${String(child)}` : ''}`;
  if (field === 'instructions')
    return `Step ${typeof index === 'number' ? index + 1 : ''}${child === 'group' ? ' group' : ''}`;
  if (field === 'images')
    return `Photo ${typeof index === 'number' ? index + 1 : ''}${child === 'alt' ? ' description' : ''}`;
  const labels: Record<string, string> = {
    title: 'Recipe title',
    summary: 'Introduction',
    description: 'Story and notes',
    prepMinutes: 'Prep time',
    cookMinutes: 'Cook time',
    yield: 'Makes',
    language: 'Language',
    source: 'Source',
    derivedFrom: 'Original recipe',
    adaptationNote: 'Adaptation note',
    tags: 'Tags',
  };
  return labels[String(field)] || 'Recipe';
}

export const photoSchema = recipeInputSchema.shape.images.unwrap().element;

export function fitsPublishedRecord(input: RecipeInput, original?: RecipeRecord): boolean {
  const now = new Date().toISOString();
  const record = {
    ...input,
    $type: RECIPE_COLLECTION,
    createdAt: original?.createdAt || now,
    ...(original ? { updatedAt: now } : {}),
  };
  return new TextEncoder().encode(JSON.stringify(record)).length <= MAX_RECIPE_RECORD_BYTES;
}
