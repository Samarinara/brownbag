import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const screenshots = 'test-results/screenshots';

test('essentials, row options, validation, draft and publication', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/recipe/new');
  await expect(page.getByRole('heading', { name: 'New recipe' })).toBeVisible();
  await expect(page.locator('details[open]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Publish recipe', exact: true })).toBeDisabled();
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: `${screenshots}/recipe-editor-desktop.png`, fullPage: true });

  await page.getByLabel('Recipe title', { exact: true }).fill('Lemon pasta');
  await page.getByLabel('Ingredient 1 name', { exact: true }).fill('spaghetti');
  await page.getByLabel('Ingredient 1 quantity', { exact: true }).fill('250');
  await page.getByLabel('Ingredient 1 unit', { exact: true }).fill('g');
  await page.getByRole('button', { name: 'Add ingredient', exact: true }).click();
  await expect(page.getByLabel('Ingredient 2 name', { exact: true })).toBeFocused();
  await page.getByLabel('Ingredient 2 name', { exact: true }).fill('lemon');
  await page.getByLabel('Ingredient 2 options', { exact: true }).click();
  await page.getByRole('button', { name: 'Move ingredient 2 up', exact: true }).click();
  await expect(page.getByLabel('Ingredient 1 name', { exact: true })).toHaveValue('lemon');
  await page.getByRole('button', { name: 'Remove ingredient 2', exact: true }).click();
  await expect(page.locator('.recipe-ingredient-row')).toHaveCount(1);
  await page.getByLabel('Step 1', { exact: true }).fill('Cook the pasta.');
  await page.getByRole('button', { name: 'Add step', exact: true }).click();
  await expect(page.getByLabel('Step 2', { exact: true })).toBeFocused();
  await page.getByLabel('Step 2', { exact: true }).fill('Toss with lemon.');
  await page.getByLabel('Step 2 options', { exact: true }).click();
  await page.getByRole('button', { name: 'Move step 2 up', exact: true }).click();
  await expect(page.getByLabel('Step 1', { exact: true })).toHaveValue('Toss with lemon.');

  await page.getByText('Time & servings', { exact: true }).click();
  await page.getByLabel('Prep time (minutes)', { exact: true }).fill('0');
  await page.getByLabel('Cook time (minutes)', { exact: true }).fill('15');
  await page.getByLabel('Makes', { exact: true }).fill('2 servings');
  await page.getByText('Source & inspiration', { exact: true }).click();
  await page.getByLabel('Source link', { exact: true }).fill('invalid');
  await page.getByText('Source & inspiration', { exact: true }).click();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.getByRole('button', { name: /Source: Invalid url/ }).click();
  await expect(page.getByLabel('Source link', { exact: true })).toBeFocused();
  await page.getByLabel('Source link', { exact: true }).fill('https://example.com/pasta');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'New recipe' })).toHaveCount(0);

  const drafts = await (await page.request.get('/api/drafts')).json();
  const draft = drafts.drafts.find(
    (item: { data: { title: string } }) => item.data.title === 'Lemon pasta',
  );
  expect(draft.data.prepMinutes).toBe(0);
  expect(draft.data.cookMinutes).toBe(15);
  expect(draft.data.yield.display).toBe('2 servings');
  await page.goto(`/recipe/draft?id=${encodeURIComponent(draft.id)}`);
  await expect(page.getByRole('heading', { name: 'Edit draft' })).toBeVisible();
  await expect(page.getByLabel('Cook time (minutes)', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Source link', { exact: true })).toHaveValue(
    'https://example.com/pasta',
  );
  await page.screenshot({ path: `${screenshots}/recipe-editor-options.png`, fullPage: true });
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Publish recipe', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit draft' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('mobile essentials fit without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/recipe/new');
  await expect(page.getByRole('heading', { name: 'New recipe' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.getByLabel('Ingredient 1 options', { exact: true }).click();
  await expect(page.getByLabel('Preparation', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.getByLabel('Ingredient 1 options', { exact: true }).click();
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: `${screenshots}/recipe-editor-mobile.png`, fullPage: true });
});
