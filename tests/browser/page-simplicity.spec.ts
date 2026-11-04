import { test, expect } from '@playwright/test';

// The install event can arrive long before someone opens Settings.
test('installation stays in Settings and retains the browser install prompt', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Open account menu' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Install app', exact: true })).toHaveCount(0);
  await expect(page.locator('.pwa-tools')).toHaveCount(0);
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(event, {
      prompt: async () => {
        document.documentElement.dataset.installPrompted = 'true';
      },
      userChoice: Promise.resolve({ outcome: 'accepted' }),
    });
    window.dispatchEvent(event);
  });
  await page.getByRole('button', { name: 'Open account menu' }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await settings.getByRole('button', { name: 'Install app', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-install-prompted', 'true');
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(settings.getByRole('button', { name: 'Install app', exact: true })).toHaveCount(0);
  await expect(settings.getByText('Brownbag is installed on this device.')).toBeVisible();
  await settings.getByRole('button', { name: 'Offline recipes', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Offline recipes', exact: true })).toBeVisible();
});

test('settings remain available before sign-in and recipe sharing has one control', async ({
  page,
}) => {
  await page.route('**/api/me', (route) =>
    route.fulfill({ status: 401, json: { error: 'Sign in' } }),
  );
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open login menu', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Sign in', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await settings.getByRole('button', { name: 'Install app', exact: true }).click();
  await expect(settings.getByText(/On iPhone or iPad/)).toBeVisible();
  await settings.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Open login menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Your cookbook starts here' })).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('/recipe-preview');
  await expect(
    page.getByRole('button', { name: 'Copy link to this recipe', exact: true }),
  ).toHaveCount(0);
  const share = page.getByRole('button', { name: 'Share this recipe', exact: true });
  await expect(share).toBeVisible();
  const shape = await share.evaluate((button) => {
    const bounds = button.getBoundingClientRect();
    return {
      width: bounds.width,
      height: bounds.height,
      radius: getComputedStyle(button).borderRadius,
    };
  });
  expect(shape.width).toBe(shape.height);
  expect(shape.radius).toBe('50%');
});

for (const width of [390, 1280]) {
  test(`planner retains meals during a delayed refresh at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/meal-planner');
    await page.getByRole('tab', { name: 'Week', exact: true }).click();
    const entries = page.locator('.planner-entry');
    await expect(entries.first()).toBeVisible();
    const count = await entries.count();
    const before = await page.locator('.planner-board').boundingBox();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/planner?*', async (route) => {
      await held;
      await route.fulfill({ status: 503, json: { error: 'Please retry.' } });
    });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.locator('.planner-board')).toHaveAttribute('aria-busy', 'true');
    await expect(entries).toHaveCount(count);
    expect(await page.locator('.planner-board').boundingBox()).toEqual(before);
    release();
    await expect(page.locator('.planner-board')).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByRole('alert')).toContainText('Please retry.');
    await expect(entries).toHaveCount(count);
    await page.unroute('**/api/planner?*');
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.locator('.planner-board')).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByRole('alert')).toHaveCount(0);

    let loadWeek!: () => void;
    const nextWeek = new Promise<void>((resolve) => {
      loadWeek = resolve;
    });
    await page.route('**/api/planner?*', async (route) => {
      await nextWeek;
      await route.fulfill({ json: { entries: [] } });
    });
    await page.getByRole('button', { name: 'Next week', exact: true }).click();
    await expect(page.locator('.planner-slot-placeholder')).toHaveCount(28);
    await expect(entries).toHaveCount(0);
    loadWeek();
    await expect(page.locator('.planner-board')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('.planner-slot-placeholder')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Add recipe to / })).toHaveCount(28);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
