import { test, expect } from '@playwright/test';

// Exercise the feature boundaries through their real HTTP adapters and persisted state.
test('account appearance and planner preferences survive their extracted feature boundaries', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open account menu' }).click();
  await page.getByRole('radio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-resolved-theme', 'dark');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open account menu' })).toBeFocused();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-resolved-theme', 'dark');
  await page.getByRole('button', { name: 'Open account menu' }).click();
  await page.getByRole('menuitem', { name: 'Manage account' }).click();
  const dialog = page.getByRole('dialog', { name: 'Your account', exact: true });
  await dialog.getByLabel('Meal', { exact: true }).selectOption('lunch');
  await expect(dialog.getByText('Default meal saved.', { exact: true })).toBeVisible();
  const settings = await (await page.request.get('/api/planner/settings')).json();
  expect(settings.defaultSlot).toBe('lunch');
  await dialog.getByLabel('Meal', { exact: true }).selectOption('dinner');
  await expect(dialog.getByText('Default meal saved.', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByRole('button', { name: 'Open account menu' })).toBeFocused();
});

test('planner selection and note editing persist across dialogs and navigation', async ({
  page,
}) => {
  await page.goto('/meal-planner');
  await page.locator('.planner-date-title').click();
  const calendar = page.getByRole('dialog', { name: 'Choose a week' });
  await expect(calendar.locator('.planner-month-grid button')).toHaveCount(42);
  await calendar.getByRole('button', { name: 'Close dialog' }).click();
  await page
    .getByRole('button', { name: /^Add recipe to Breakfast on / })
    .first()
    .click();
  const picker = page.getByRole('dialog', { name: 'Choose recipes' });
  await picker.getByRole('button', { name: 'Discover', exact: true }).click();
  await picker.getByRole('button', { name: 'Add Sunday lemon pasta', exact: true }).click();
  await expect(picker.getByText(/Added Sunday lemon pasta to Breakfast/)).toBeVisible();
  await picker.getByRole('button', { name: 'Done', exact: true }).click();
  const entry = page.locator('.planner-entry').filter({ hasText: 'Sunday lemon pasta' }).first();
  await entry.getByRole('button', { name: 'Options for Sunday lemon pasta' }).click();
  await entry.getByRole('button', { name: 'Edit note', exact: true }).click();
  const note = page.getByRole('dialog', { name: 'Recipe note', exact: true });
  await note.getByLabel(/^Note/).fill('Pack leftovers for lunch.');
  await note.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(entry.getByText('Pack leftovers for lunch.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.locator('.planner-entry').filter({ hasText: 'Pack leftovers for lunch.' }),
  ).toHaveCount(1);
});
