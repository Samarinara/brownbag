import assert from 'node:assert/strict';
import test from 'node:test';
import { importRecipe, parseRecipePage, recipeImportUrl } from '../server/recipe-import.js';

const recipe = {
  '@type': ['Recipe'],
  name: 'Lemon &amp; butter pasta',
  description: '<p>A quick dinner.</p>',
  author: [{ '@type': 'Person', name: 'A Cook' }],
  recipeIngredient: ['250 g pasta', '1 lemon'],
  recipeInstructions: [
    {
      '@type': 'HowToSection',
      name: 'Pasta',
      itemListElement: [
        { '@type': 'HowToStep', text: 'Boil the pasta.' },
        { '@type': 'HowToStep', text: '<p>Toss &amp; serve.</p>' },
      ],
    },
  ],
  prepTime: 'PT10M',
  cookTime: 'PT1H5M',
  recipeYield: ['2 servings'],
};
const page = (value: unknown) =>
  `<html><script type="application/ld+json">${JSON.stringify(value)}</script></html>`;
const url = 'https://example.com/pasta';

test('imports a recipe in a JSON-LD graph with credit, sections, timing and servings', () => {
  const result = parseRecipePage(
    '<script type="application/ld+json">invalid</script>' +
      page({ '@graph': [{ '@type': 'WebPage' }, recipe] }),
    url,
  );
  assert.equal(result.title, 'Lemon & butter pasta');
  assert.equal(result.summary, 'A quick dinner.');
  assert.deepEqual(result.ingredients, [{ name: '250 g pasta' }, { name: '1 lemon' }]);
  assert.deepEqual(result.instructions, [
    { text: 'Boil the pasta.', group: 'Pasta' },
    { text: 'Toss & serve.', group: 'Pasta' },
  ]);
  assert.equal(result.prepMinutes, 10);
  assert.equal(result.cookMinutes, 65);
  assert.equal(result.yield?.display, '2 servings');
  assert.deepEqual(result.source, { url, name: 'A Cook' });
});

test('handles arrays, string steps, numeric yields and long descriptions', () => {
  const result = parseRecipePage(
    page([
      {
        ...recipe,
        '@type': 'https://schema.org/Recipe',
        recipeInstructions: 'Boil.\nServe.',
        recipeYield: 4,
        description: 'A'.repeat(1100),
      },
    ]),
    url,
  );
  assert.deepEqual(result.instructions, [{ text: 'Boil.' }, { text: 'Serve.' }]);
  assert.equal(result.yield?.display, '4');
  assert.equal(result.description?.length, 1100);
});

test('rejects missing, incomplete and oversized recipes instead of silently truncating', () => {
  for (const value of [
    { '@type': 'WebPage' },
    { ...recipe, recipeIngredient: [] },
    { ...recipe, recipeInstructions: [] },
    { ...recipe, name: 'x'.repeat(201) },
  ])
    assert.throws(() => parseRecipePage(page(value), url), { status: 422 });
});

test('validates links and strips fragments', () => {
  assert.equal(recipeImportUrl(` ${url}#recipe `).href, url);
  for (const value of [
    'invalid',
    'file:///etc/passwd',
    'ftp://example.com/recipe',
    'https://user:pass@example.com',
  ])
    assert.throws(() => recipeImportUrl(value), { status: 400 });
});

test('fetches HTML with explicit redirect policy and handles blocked/non-HTML pages', async () => {
  const result = await importRecipe(url, async (input, init) => {
    assert.equal(String(input), url);
    assert.equal(init?.redirect, 'follow');
    return new Response(page(recipe), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  });
  assert.equal(result.source?.url, url);
  for (const response of [
    new Response('', { status: 403 }),
    new Response('{}', { headers: { 'content-type': 'application/json' } }),
  ])
    await assert.rejects(
      importRecipe(url, async () => response),
      { status: 422 },
    );
});

test('blocks loopback and private network destinations', async () => {
  for (const url of [
    'http://127.0.0.1/',
    'http://[::1]/',
    'http://169.254.169.254/',
    'http://10.0.0.1/',
  ])
    await assert.rejects(importRecipe(url), { status: 422 });
});
