import { load } from 'cheerio';
import { safeFetchWrap } from '@atproto-labs/fetch-node';
import { recipeInputSchema, type RecipeInput } from '../shared/atproto.js';
import { HttpError } from './network-store.js';

const fetchPage = safeFetchWrap({ responseMaxSize: 3_000_000, timeout: 15_000, allowHttp: true });

export function recipeImportUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new HttpError(400, 'Paste a complete recipe link starting with https://.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.href.length > 2000
  )
    throw new HttpError(
      400,
      'Choose a public HTTP or HTTPS recipe link without a username or password.',
    );
  url.hash = '';
  return url;
}

type Node = Record<string, unknown>;
const object = (value: unknown): value is Node =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const list = (value: unknown): unknown[] =>
  value == null ? [] : Array.isArray(value) ? value : [value];
const plain = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return load(value.replace(/<br\s*\/?\s*>/gi, '\n'))
    .text()
    .trim();
};
const minutes = (value: unknown): number | undefined => {
  if (typeof value !== 'string') return;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(value);
  if (!match || !match.slice(1).some(Boolean)) return;
  const result = Math.ceil(
    Number(match[1] || 0) * 1440 +
      Number(match[2] || 0) * 60 +
      Number(match[3] || 0) +
      Number(match[4] || 0) / 60,
  );
  return result <= 100000 ? result : undefined;
};

function instructions(value: unknown, group?: string): RecipeInput['instructions'] {
  return list(value).flatMap((step) => {
    if (typeof step === 'string')
      return step
        .split(/\n+/)
        .map(plain)
        .filter(Boolean)
        .map((text) => ({ text, ...(group ? { group } : {}) }));
    if (!object(step)) return [];
    if (step.itemListElement) return instructions(step.itemListElement, plain(step.name) || group);
    const text = plain(step.text) || plain(step.name);
    return text ? [{ text, ...(group ? { group } : {}) }] : [];
  });
}

// Read structured recipe data only; scripts from the source page are never executed.
export function parseRecipePage(html: string, sourceUrl: string): RecipeInput {
  const $ = load(html);
  const recipes: Node[] = [];
  const walk = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!object(value)) return;
    if (
      list(value['@type']).some(
        (type) => typeof type === 'string' && /(?:^|[/#])Recipe$/.test(type),
      )
    )
      recipes.push(value);
    Object.values(value).forEach(walk);
  };
  $('script[type="application/ld+json"]').each((_index, script) => {
    try {
      walk(JSON.parse($(script).text()));
    } catch {
      /* Other metadata may be malformed. */
    }
  });
  for (const recipe of recipes) {
    const author = list(recipe.author)
      .map((entry) => plain(object(entry) ? entry.name : entry))
      .filter(Boolean)
      .join(', ');
    const result = recipeInputSchema.safeParse({
      title: plain(recipe.name),
      ...(Buffer.byteLength(plain(recipe.description)) <= 1000
        ? { summary: plain(recipe.description) || undefined }
        : { description: plain(recipe.description) }),
      ingredients: list(recipe.recipeIngredient)
        .map(plain)
        .filter(Boolean)
        .map((name) => ({ name })),
      instructions: instructions(recipe.recipeInstructions),
      prepMinutes: minutes(recipe.prepTime),
      cookMinutes: minutes(recipe.cookTime),
      yield: recipe.recipeYield
        ? {
            display: list(recipe.recipeYield)
              .map((item) => (typeof item === 'number' ? String(item) : plain(item)))
              .filter(Boolean)
              .join(' · '),
          }
        : undefined,
      source: { url: sourceUrl, name: author || new URL(sourceUrl).hostname },
    });
    if (result.success) return result.data;
  }
  throw new HttpError(
    422,
    recipes.length
      ? 'This recipe is incomplete or too large to import. You can enter it manually and keep the source link.'
      : 'No supported recipe was found on this page. Try a direct recipe link, or enter it manually.',
  );
}

export async function importRecipe(value: string, fetcher = fetchPage): Promise<RecipeInput> {
  const url = recipeImportUrl(value);
  let html: string;
  let sourceUrl: string;
  try {
    const response = await fetcher(url, {
      redirect: 'follow',
      headers: { Accept: 'text/html,application/xhtml+xml' },
    });
    if (!response.ok) throw new Error('Unavailable');
    const type = response.headers.get('content-type')?.split(';')[0].trim();
    if (type !== 'text/html' && type !== 'application/xhtml+xml') throw new Error('Not HTML');
    sourceUrl = recipeImportUrl(response.url || url.href).href;
    html = await response.text();
  } catch {
    throw new HttpError(
      422,
      'This page could not be read. The site may block imports. Try another recipe link, or enter it manually.',
    );
  }
  return parseRecipePage(html, sourceUrl);
}
