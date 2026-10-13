import { test, expect } from '@playwright/test';

test('public demos reuse the real screens without making API requests', async ({ page }) => {
  const calls: string[] = [];
  const errors: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) calls.push(request.url());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/ui-preview');
  await page.getByRole('link', { name: /^Recipe editor/ }).click();
  await expect(page.getByLabel('Recipe title', { exact: true })).toHaveValue(
    'Lemon & butter pasta',
  );
  await page.getByLabel('Recipe title', { exact: true }).fill('My sample pasta');
  await page.getByRole('button', { name: 'Add ingredient', exact: true }).click();
  await expect(page.getByLabel('Ingredient 5 name', { exact: true })).toBeFocused();
  await page.getByLabel('Ingredient 5 name', { exact: true }).fill('basil');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Publish changes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My sample pasta', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/preview\/recipe\?/);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Lemon & butter pasta', exact: true }),
  ).toBeVisible();
  expect(calls).toEqual([]);
  expect(errors).toEqual([]);
});

test('shopping preview checkboxes and ranges update sample data', async ({ page }) => {
  await page.goto('/shopping-preview');
  await expect(page.getByRole('heading', { name: 'Shopping list', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox').first()).toBeVisible();
  await page.getByRole('checkbox').first().check();
  await expect(page.getByRole('checkbox').first()).toBeChecked();
  await page.getByLabel('Days to shop for', { exact: true }).fill('14');
  await expect(page).toHaveURL(/\/preview\/meal-planner\/shopping-list\?.*days=14/);
  await expect(page.getByLabel('Days to shop for', { exact: true })).toHaveValue('14');
});

test('Polli dialogs retain focus and appearance follows the root theme', async ({ page }) => {
  await page.goto('/account-preview');
  const storedTheme = await page.evaluate(() => localStorage.getItem('brownbag-theme'));
  const dialog = page.getByRole('dialog', { name: 'Your account', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox', { name: /^Meal\b/ }).selectOption('lunch');
  await expect(dialog.getByText('Default meal saved.', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Open account menu', exact: true }).click();
  await page.getByRole('radio', { name: 'Dark', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.getByRole('radio', { name: 'Light', exact: true }).click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  expect(await page.evaluate(() => localStorage.getItem('brownbag-theme'))).toBe(storedTheme);
});

test('recipe and editor previews fit on mobile and use the requested font roles', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/recipe-preview');
  await expect(
    page.getByRole('heading', { name: 'Lemon & butter pasta', exact: true }),
  ).toBeVisible();
  expect(
    await page.locator('.ingredient-rows').evaluate((node) => getComputedStyle(node).fontFamily),
  ).toContain('Lora');
  expect(
    await page.locator('.network-summary').evaluate((node) => getComputedStyle(node).fontFamily),
  ).toContain('Patrick Hand');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.goto('/editor-preview');
  await expect(page.getByLabel('Recipe title', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test('resolved Polli light and dark theme colors preserve readable text and actions', async ({
  page,
}) => {
  await page.goto('/recipe-preview');
  await expect(
    page.getByRole('heading', { name: 'Lemon & butter pasta', exact: true }),
  ).toBeVisible();
  for (const mode of ['light', 'dark']) {
    const results = await page.evaluate((mode) => {
      document.documentElement.classList.toggle('dark', mode === 'dark');
      const pairs: [string, string, number][] = [
        ['color-text', 'color-canvas', 7],
        ['color-text-muted', 'color-canvas', 4.5],
        ['color-text-subtle', 'color-canvas', 4.5],
        ['color-accent-muted', 'color-canvas', 4.5],
        ['color-on-accent', 'color-action', 4.5],
        ['color-text-danger', 'color-surface-danger', 4.5],
      ];
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d')!;
      const sample = document.createElement('span');
      document.body.append(sample);
      const luminance = (token: string) => {
        if (!getComputedStyle(document.documentElement).getPropertyValue(`--${token}`).trim())
          throw new Error(`Missing theme token ${token}`);
        sample.style.color = `var(--${token})`;
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = getComputedStyle(sample).color;
        context.fillRect(0, 0, 1, 1);
        const rgb = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map((channel) => {
          const value = channel / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
      };
      const results = pairs.map(([foreground, background, minimum]) => {
        const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
        return { foreground, background, minimum, ratio: (values[0] + 0.05) / (values[1] + 0.05) };
      });
      sample.remove();
      return results;
    }, mode);
    for (const result of results)
      expect(
        result.ratio,
        `${mode}: ${result.foreground} on ${result.background}`,
      ).toBeGreaterThanOrEqual(result.minimum);
  }
});
