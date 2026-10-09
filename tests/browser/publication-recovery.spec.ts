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
