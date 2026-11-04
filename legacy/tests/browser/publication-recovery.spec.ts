import { test, expect } from '@playwright/test';

test('publication survives a lost response, draft cleanup and a page reload with one recipe', async ({
  page,
}) => {
  await page.goto('/recipe/new');
  const title = `Recovery soup ${Date.now()}`;
  await page.getByLabel('Recipe title', { exact: true }).fill(title);
  await page.getByLabel('Ingredient 1 name', { exact: true }).fill('water');
  await page.getByLabel('Step 1', { exact: true }).fill('Boil.');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  const drafts = await (await page.request.get('/api/drafts')).json();
  const draft = drafts.drafts.find((item: any) => item.data.title === title);
  await page.goto(`/recipe/draft?id=${draft.id}`);
  await page.getByRole('checkbox').check();
  let published: any;
  let operationId: string;
  await page.route(
    '**/api/recipes',
    async (route) => {
      operationId = route.request().postDataJSON().operationId;
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      published = await response.json();
      await route.abort('failed');
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: 'Publish recipe', exact: true }).click();
  await expect(page.getByText('Failed to fetch', { exact: true })).toBeVisible();
  expect(operationId!).toMatch(/^[0-9a-f-]{36}$/);
  expect(
    (await (await page.request.get('/api/drafts')).json()).drafts.some(
      (item: any) => item.id === draft.id,
    ),
  ).toBe(false);
  await page.reload();
  await page.getByRole('button', { name: 'Restore changes', exact: true }).click();
  await page.getByRole('checkbox').check();
  let retried: any;
  await page.route(
    '**/api/recipes',
    async (route) => {
      expect(route.request().postDataJSON().operationId).toBe(operationId!);
      const response = await route.fetch();
      retried = await response.json();
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: 'Publish recipe', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit draft', exact: true })).toHaveCount(0);
  expect(retried.uri).toBe(published.uri);
  const recipes = await (
    await page.request.get(`/api/recipes?feed=mine&q=${encodeURIComponent(title)}`)
  ).json();
  expect(recipes.recipes.filter((item: any) => item.record.title === title)).toHaveLength(1);
});

for (const status of ['conflict', 'pending'] as const) {
  test(`${status} publication response preserves edits and ${status === 'conflict' ? 'unlocks' : 'blocks'} private draft saving`, async ({
    page,
  }) => {
    const title = `${status} recovery soup ${Date.now()}`;
    await page.goto('/recipe/new');
    await page.getByLabel('Recipe title', { exact: true }).fill(title);
    await page.getByLabel('Ingredient 1 name', { exact: true }).fill('water');
    await page.getByLabel('Step 1', { exact: true }).fill('Boil.');
    await page.getByRole('checkbox').check();
    let operationId = '';
    const attempts: string[] = [];
    await page.route('**/api/recipes', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      operationId = route.request().postDataJSON().operationId;
      attempts.push(operationId);
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error:
            status === 'conflict'
              ? 'This recipe has changed. Reload it before saving.'
              : 'This publication is already being processed. Retry with the same operation key.',
        }),
      });
    });
    await page.route('**/api/publication-operations/*', async (route) => {
      expect(route.request().url().split('/').at(-1)).toBe(operationId);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status }),
      });
    });
    await page.getByRole('button', { name: 'Publish recipe', exact: true }).click();
    await expect(
      page.getByText(
        status === 'conflict' ? /Your edits are preserved/ : /already being processed/,
      ),
    ).toBeVisible();
    await expect(page.getByLabel('Recipe title', { exact: true })).toHaveValue(title);
    const storedIntent = () =>
      page.evaluate(() => {
        const key = Object.keys(localStorage).find(
          (key) => key.startsWith('brownbag-recovery-v1:') && key.endsWith(':publication'),
        );
        return key ? JSON.parse(localStorage.getItem(key)!) : undefined;
      });
    const initialOperationId = operationId;
    if (status === 'conflict') {
      expect(await storedIntent()).toBeUndefined();
      const recovery = await page.evaluate(() => {
        const key = Object.keys(localStorage).find(
          (key) => key.startsWith('brownbag-recovery-v1:') && !key.endsWith(':publication'),
        );
        return key ? JSON.parse(localStorage.getItem(key)!) : undefined;
      });
      expect(recovery.title).toBe(title);
      await page.getByRole('button', { name: 'Save draft', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'New recipe', exact: true })).toHaveCount(0);
      const drafts = await (await page.request.get('/api/drafts')).json();
      expect(drafts.drafts.filter((item: any) => item.data.title === title)).toHaveLength(1);
    } else {
      expect((await storedIntent()).id).toBe(operationId);
      await page.getByRole('button', { name: 'Save draft', exact: true }).click();
      await expect(page.getByText(/An earlier publication has not been confirmed/)).toBeVisible();
      await expect(page.getByLabel('Recipe title', { exact: true })).toHaveValue(title);
      expect((await storedIntent()).id).toBe(operationId);
      const drafts = await (await page.request.get('/api/drafts')).json();
      expect(drafts.drafts.filter((item: any) => item.data.title === title)).toHaveLength(0);
      await page.getByRole('button', { name: 'Publish recipe', exact: true }).click();
      await expect.poll(() => attempts.length).toBe(2);
      await expect(page.getByText(/already being processed/)).toBeVisible();
      expect(attempts).toEqual([initialOperationId, initialOperationId]);
      expect((await storedIntent()).id).toBe(initialOperationId);
    }
  });
}
