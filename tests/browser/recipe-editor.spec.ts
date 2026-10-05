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
  await page.getByRole('button', { name: 'Move ingredient 2 up', exact: true }).click();
  await expect(page.getByLabel('Ingredient 1 name', { exact: true })).toHaveValue('lemon');
  await page.getByRole('button', { name: 'Remove ingredient 2', exact: true }).click();
  await expect(page.locator('.recipe-ingredient-row')).toHaveCount(1);
  await page.getByLabel('Step 1', { exact: true }).fill('Cook the pasta.');
  await page.getByRole('button', { name: 'Add step', exact: true }).click();
  await expect(page.getByLabel('Step 2', { exact: true })).toBeFocused();
  await page.getByLabel('Step 2', { exact: true }).fill('Toss with lemon.');
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
  await page.getByLabel('Ingredient 1 preparation options', { exact: true }).click();
  await expect(page.locator('input[name="ingredients.0.preparation"]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.getByLabel('Ingredient 1 preparation options', { exact: true }).click();
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: `${screenshots}/recipe-editor-mobile.png`, fullPage: true });
});

test('categories suggest existing spellings across ingredients and steps and survive reordering', async ({
  page,
}) => {
  await page.goto('/recipe/new');
  await page.getByLabel('Recipe title', { exact: true }).fill('Category test');
  await page.getByLabel('Ingredient 1 name', { exact: true }).fill('Flour');
  await page.locator('.recipe-ingredient-row').first().hover();
  await page.getByLabel('Ingredient 1 category selector', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Ingredient 1 category', exact: true }).fill('Dough');
  await page.getByRole('combobox', { name: 'Ingredient 1 category', exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Add ingredient', exact: true }).click();
  await page.getByLabel('Ingredient 2 name', { exact: true }).fill('Water');
  await page.getByLabel('Ingredient 2 category selector', { exact: true }).click();
  const ingredientCategory = page.getByRole('combobox', {
    name: 'Ingredient 2 category',
    exact: true,
  });
  await ingredientCategory.fill('do');
  await expect(page.getByRole('option', { name: 'Dough', exact: true })).toBeVisible();
  await ingredientCategory.press('Escape');
  await expect(ingredientCategory).toHaveAttribute('aria-expanded', 'false');
  await ingredientCategory.fill('DO');
  await ingredientCategory.press('Enter');
  await expect(ingredientCategory).toHaveValue('Dough');
  await ingredientCategory.fill('');
  await expect(ingredientCategory).toBeVisible();
  await ingredientCategory.fill('Filling');
  await ingredientCategory.press('Enter');
  await page.getByLabel('Step 1', { exact: true }).fill('Mix.');
  await page.locator('.recipe-method-row').first().hover();
  await page.getByLabel('Step 1 category selector', { exact: true }).click();
  const stepCategory = page.getByRole('combobox', { name: 'Step 1 category', exact: true });
  await stepCategory.focus();
  await expect(page.getByRole('option', { name: 'Dough', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Filling', exact: true })).toBeVisible();
  await stepCategory.press('ArrowDown');
  await stepCategory.press('Enter');
  await expect(stepCategory).toHaveValue('Filling');
  await stepCategory.fill('dou');
  await page.getByRole('option', { name: 'Dough', exact: true }).click();
  await expect(stepCategory).toHaveValue('Dough');
  await page.getByRole('button', { name: 'Move ingredient 2 up', exact: true }).click();
  await expect(
    page.getByRole('combobox', { name: 'Ingredient 1 category', exact: true }),
  ).toHaveValue('Filling');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'New recipe' })).toHaveCount(0);
  const { drafts } = await (await page.request.get('/api/drafts')).json();
  const draft = drafts.find(
    (item: { data: { title: string } }) => item.data.title === 'Category test',
  );
  expect(draft.data.ingredients.map((item: { group: string }) => item.group)).toEqual([
    'Filling',
    'Dough',
  ]);
  expect(draft.data.instructions[0].group).toBe('Dough');
});

for (const loggedOut of [false, true]) {
  test(`preview shares the editor and cannot write (${loggedOut ? 'logged out' : 'signed in'})`, async ({
    page,
  }) => {
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/') && !['GET', 'HEAD'].includes(request.method()))
        writes.push(request.url());
    });
    if (loggedOut) {
      await page.route('**/api/me', (route) =>
        route.fulfill({ status: 401, json: { error: 'Sign in required' } }),
      );
      await page.route('**/api/config', (route) => route.fulfill({ json: { configured: false } }));
    }
    await page.goto('/editor-preview');
    await expect(page.getByRole('heading', { name: 'New recipe' })).toBeVisible();
    await expect(page.locator('details[open]')).toHaveCount(0);
    await page.getByLabel('Recipe title', { exact: true }).fill('Preview recipe');
    await page.getByText('Introduction', { exact: true }).click();
    await page.getByLabel('Short description', { exact: true }).fill('Introduction');
    const title = await page.locator('input[name="title"]').boundingBox();
    const introduction = await page.locator('textarea[name="summary"]').boundingBox();
    expect(introduction!.y).toBeGreaterThan(title!.y);
    await page.getByRole('checkbox').check();
    await expect(page.getByRole('button', { name: 'Publish recipe', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled();
    await page.getByLabel('Recipe title', { exact: true }).press('Enter');
    await page
      .locator('form.network-editor')
      .evaluate((form: HTMLFormElement) => form.requestSubmit());
    await page.getByText('Photos', { exact: true }).click();
    await expect(page.getByLabel('Add photos', { exact: true })).toBeDisabled();
    expect(writes).toEqual([]);
    expect(
      await page.evaluate(() =>
        Object.keys(localStorage).filter((key) => key.includes('recovery')),
      ),
    ).toEqual([]);
  });
}

test('editor fields use transparent surfaces and margin categories fit desktop, mobile and dark mode', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/editor-preview');
  await expect(page.getByRole('heading', { name: 'New recipe' })).toBeVisible();
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.resolvedTheme = theme;
    }, theme);
    for (const selector of [
      'fieldset.recipe-editor-fields',
      'input[name="title"]',
      'textarea[name="instructions.0.text"]',
    ]) {
      expect(
        await page
          .locator(selector)
          .evaluate((element) => getComputedStyle(element).backgroundColor),
      ).toBe('rgba(0, 0, 0, 0)');
    }
    expect(
      await page
        .locator('input[name="title"]')
        .evaluate((element) => getComputedStyle(element).fontFamily),
    ).toContain('Georgia');
    expect(
      await page
        .locator('textarea[name="instructions.0.text"]')
        .evaluate((element) => getComputedStyle(element).fontFamily),
    ).toContain('Arial');
    const row = page.locator('.recipe-method-row').first();
    await row.hover();
    const category = page.getByLabel('Step 1 category selector', { exact: true });
    await expect(category).toHaveCSS('opacity', '1');
    expect((await category.boundingBox())!.x).toBeGreaterThan(
      (await row.boundingBox())!.x + (await row.boundingBox())!.width,
    );
    if (
      !(await page
        .locator('.recipe-method-row .recipe-category')
        .first()
        .evaluate((element: HTMLDetailsElement) => element.open))
    )
      await category.click();
    await page.getByRole('combobox', { name: 'Step 1 category', exact: true }).fill('Dough');
    await page.screenshot({
      path: `${screenshots}/recipe-editor-${theme}-margin.png`,
      fullPage: true,
    });
  }
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await expect(
      page.getByRole('combobox', { name: 'Step 1 category', exact: true }),
    ).toBeVisible();
  }
  const actions = page.locator('.recipe-method-row .recipe-row-actions').first();
  expect(
    await actions
      .locator('button')
      .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label'))),
  ).toEqual(['Move step 1 up', 'Remove step 1', 'Move step 1 down']);
});
