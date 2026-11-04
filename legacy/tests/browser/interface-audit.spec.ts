import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const screens = [
  ['/preview/', 'Your recipes.'],
  ['/recipe-preview', 'Lemon & butter pasta'],
  ['/editor-preview', 'Edit recipe'],
  ['/cookbook-preview', 'Cookbook'],
  ['/feed-preview', 'Lemon & butter pasta'],
  ['/planner-preview', 'Meal Planner'],
  ['/shopping-preview', 'Shopping list'],
  ['/account-preview', 'Your account'],
  ['/ui-preview', 'Try the new kitchen'],
] as const;

for (const [width, colorScheme] of [
  [320, 'light'],
  [390, 'dark'],
  [768, 'light'],
  [1280, 'dark'],
] as const) {
  test(`interface is accessible and fits at ${width}px in ${colorScheme} mode`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    for (const [path, title] of screens) {
      await page.goto(path);
      await expect(
        page.getByRole('heading', { name: new RegExp(title.replace('&', '\\&')) }).first(),
      ).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator('html')).toHaveAttribute('data-resolved-theme', colorScheme);
      if (width < 800 && path !== '/ui-preview' && path !== '/account-preview') {
        await expect(page.locator('.network-library-link span')).toBeVisible();
        await expect(page.locator('.network-planner-link span')).toBeVisible();
        await expect(page.locator('.network-mobile-search span')).toBeVisible();
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        path,
      ).toBe(true);
      if (path === '/editor-preview') {
        const widths = await page
          .locator('.recipe-method-row .recipe-category')
          .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().width));
        expect(
          widths.every((value) => value >= 150),
          'Step categories need a readable column',
        ).toBe(true);
      }
      if (path === '/planner-preview' && width >= 768) {
        const rows = await page
          .locator('.planner-day')
          .evaluateAll((days) =>
            days.map((day) =>
              Array.from(day.querySelectorAll('.planner-slot'), (slot) =>
                Math.round(slot.getBoundingClientRect().top),
              ),
            ),
          );
        expect(
          rows.every((row) => JSON.stringify(row) === JSON.stringify(rows[0])),
          'Meal rows should align across the week',
        ).toBe(true);
      }
      await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
      const violations = await page.evaluate(async () => {
        const result = await (window as any).axe.run();
        return result.violations.map((violation: any) => ({
          id: violation.id,
          impact: violation.impact,
          nodes: violation.nodes.map((node: any) => ({
            target: node.target,
            message: node.failureSummary,
          })),
        }));
      });
      expect(violations, `${path}: ${JSON.stringify(violations)}`).toEqual([]);
      if (width === 320 || width === 1280) {
        await page.screenshot({
          path: testInfo.outputPath(`${path.replace(/\W/g, '') || 'home'}.png`),
          fullPage: true,
        });
      }
    }
  });
}

test('blocked storage and unavailable randomUUID do not prevent editing and planning', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('Storage blocked');
      },
    });
    Object.defineProperty(crypto, 'randomUUID', { value: undefined });
  });
  await page.goto('/editor-preview');
  await expect(page.getByRole('heading', { name: 'Edit recipe', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add ingredient', exact: true }).click();
  await expect(page.getByLabel('Ingredient 5 name', { exact: true })).toBeFocused();
  await page.getByLabel('Ingredient 5 name', { exact: true }).fill('basil');
  page.once('dialog', (dialog) => dialog.accept());
  await page.goto('/recipe-preview');
  await page.getByRole('button', { name: 'Plan meal', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Add to Meal Planner' })).toBeVisible();
});

test('cancelled navigation preserves the editor and its return destination', async ({ page }) => {
  await page.goto('/editor-preview');
  await page.getByLabel('Recipe title', { exact: true }).fill('Unsaved pasta');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('link', { name: 'Cookbook', exact: true }).click();
  await expect(page).toHaveURL(/\/recipe\/edit/);
  await expect(page.getByLabel('Recipe title', { exact: true })).toHaveValue('Unsaved pasta');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Back to recipes', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Lemon & butter pasta', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to recipes', exact: true })).toBeVisible();
});

test('navigation, search clearing, and row removal retain keyboard focus', async ({ page }) => {
  await page.goto('/preview/');
  await page.getByRole('link', { name: 'Cookbook', exact: true }).click();
  await expect(page.locator('#main-content')).toBeFocused();
  const search = page.getByRole('textbox', { name: 'Search recipes', exact: true });
  await search.fill('pasta');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(search).toBeFocused();
  await page.goto('/editor-preview');
  await page.getByRole('button', { name: 'Remove ingredient 2', exact: true }).click();
  await expect(page.getByLabel('Ingredient 2 name', { exact: true })).toBeFocused();
  await expect(page.getByLabel('Ingredient 2 name', { exact: true })).toHaveValue('lemon');
});

test('appearance choices participate in the account menu keyboard navigation', async ({ page }) => {
  await page.goto('/preview/');
  const account = page.getByRole('button', { name: 'Open account menu', exact: true });
  await account.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio', { name: 'System', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio', { name: 'Light', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  const dark = page.getByRole('menuitemradio', { name: 'Dark', exact: true });
  await expect(dark).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dark).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-resolved-theme', 'dark');
  await page.keyboard.press('Escape');
  await expect(account).toBeFocused();
});

test('destructive confirmations focus Cancel and Undo remains available', async ({ page }) => {
  await page.goto('/recipe-preview');
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete this recipe?', exact: true });
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Saved — remove from cookbook', exact: true }).click();
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeVisible();
  await page.waitForTimeout(6500);
  await expect(undo).toBeVisible();
  await undo.click();
  await expect(
    page.getByRole('button', { name: 'Saved — remove from cookbook', exact: true }),
  ).toBeVisible();
});

test('cookbook and shopping errors can be retried without reloading', async ({ page }) => {
  for (const [path, endpoint, loaded] of [
    ['/cookbook', '**/api/recipes?*', '.network-card'],
    ['/meal-planner/shopping-list', '**/api/planner/shopping-list?*', '.shopping-summary'],
  ]) {
    await page.route(endpoint, (route) =>
      route.fulfill({ status: 503, json: { error: 'Temporarily unavailable.' } }),
    );
    await page.goto(path);
    await expect(page.getByText('Temporarily unavailable.', { exact: true })).toBeVisible();
    await page.unroute(endpoint);
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.getByText('Temporarily unavailable.', { exact: true })).toBeHidden();
    await expect(page.locator(loaded).first()).toBeVisible();
  }
});

test('a signed-out cookbook explains sign-in without fetching private recipes', async ({
  page,
}) => {
  const recipeCalls: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/recipes') recipeCalls.push(request.url());
  });
  await page.route('**/api/me', (route) =>
    route.fulfill({ status: 401, json: { error: 'Sign in required.' } }),
  );
  await page.goto('/cookbook');
  await expect(page.getByRole('heading', { name: 'Your cookbook', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
  await expect(page.getByRole('dialog', { name: 'Your cookbook starts here' })).toBeVisible();
  expect(recipeCalls).toEqual([]);
});

test('modified links retain native browser behavior and prep-only recipes are labelled correctly', async ({
  page,
}) => {
  await page.goto('/preview/');
  const prevented = await page.locator('.network-library-link').evaluate((link) => {
    let prevented = false;
    document.addEventListener(
      'click',
      (event) => {
        prevented = event.defaultPrevented;
        event.preventDefault();
      },
      { once: true },
    );
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
    return prevented;
  });
  expect(prevented).toBe(false);
  await expect(page).toHaveURL(/\/preview\/$/);
  await page.getByRole('link', { name: 'Cookbook', exact: true }).click();
  await page
    .locator('.network-card')
    .filter({ hasText: 'Apple overnight oats' })
    .getByRole('link')
    .click();
  await expect(page.locator('.recipe-title-time')).toHaveText('5 min prep');
});

test('assistant suggestions are readable and deletions require an explicit confirmation', async ({
  page,
}) => {
  await page.route('**/api/proposals', (route) =>
    route.fulfill({
      json: {
        proposals: [
          {
            id: 'sample-create',
            status: 'pending',
            payload: {
              action: 'create',
              recipe: {
                title: 'Suggested soup',
                summary: 'A comforting lunch.',
                ingredients: [{ quantity: '2', name: 'carrots' }],
                instructions: [{ text: 'Simmer until tender.' }],
              },
            },
          },
          {
            id: 'sample-delete',
            status: 'pending',
            payload: {
              action: 'delete',
              uri: 'at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/page.polli.brownbag.recipe/3mabc234567ab',
            },
          },
        ],
      },
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Open account menu' }).click();
  await page.getByRole('menuitem', { name: 'Manage account' }).click();
  const account = page.getByRole('dialog', { name: 'Your account', exact: true });
  await expect(account.getByText('2 carrots', { exact: true })).toBeVisible();
  await expect(account.getByText('Simmer until tender.', { exact: true })).toBeVisible();
  await account.getByRole('button', { name: 'Review deletion', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Approve this change?', exact: true });
  await expect(confirm.getByText(/will permanently delete the public recipe/)).toBeVisible();
  await expect(
    confirm.getByRole('button', { name: 'Delete public recipe', exact: true }),
  ).toBeVisible();
  await expect(confirm.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(account).toBeVisible();
});

test('empty feeds, unsuccessful searches, and setup states have accessible headings', async ({
  page,
}) => {
  await page.goto('/feed-preview');
  for (const next of ['Roasted tomato soup', 'Apple overnight oats', 'You’re all caught up.']) {
    await page.getByRole('button', { name: 'Next recipe', exact: true }).click();
    await expect(page.getByRole('heading', { name: next, exact: true })).toBeVisible();
  }
  await expect(page.locator('h1')).toHaveCount(1);
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  expect(await page.evaluate(async () => (await (window as any).axe.run()).violations)).toEqual([]);
  await page.locator('.network-brand').click();
  await page
    .getByRole('textbox', { name: 'Search recipes', exact: true })
    .fill('no-such-sample-recipe');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No recipes found', exact: true })).toBeVisible();
  expect(await page.evaluate(async () => (await (window as any).axe.run()).violations)).toEqual([]);
  await page.route('**/api/config', (route) => route.fulfill({ json: { configured: false } }));
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'A place for good food.', exact: true }),
  ).toBeVisible();
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  expect(await page.evaluate(async () => (await (window as any).axe.run()).violations)).toEqual([]);
});
