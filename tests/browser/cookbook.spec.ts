import { test, expect } from "@playwright/test";
test("local cookbook, draft recovery, meal planning, shopping, settings, and backup", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Add a recipe", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Lemon rice");
  await page
    .getByRole("textbox", { name: "Ingredients", exact: true })
    .fill("1 cup rice\n1 lemon");
  await page
    .getByRole("textbox", { name: "Method", exact: true })
    .fill("Cook the rice.\n\nAdd lemon.");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Add a recipe", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveValue("Lemon rice");
  await page.getByRole("button", { name: "Save recipe", exact: true }).click();
  await page
    .getByRole("button", { name: "Open Lemon rice", exact: true })
    .click();
  await expect(page.getByText("Cook the rice.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit recipe", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Lemon rice for two");
  await page.getByRole("button", { name: "Save recipe", exact: true }).click();
  await page.getByRole("button", { name: "Plan a meal", exact: true }).click();
  await page.getByRole("button", { name: "Add meal", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Meal plan", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Lemon rice for two", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Shopping", exact: true }).click();
  await page
    .getByRole("button", { name: "Add this week’s ingredients", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "1 cup rice", exact: true }),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: "1 cup rice", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "1 cup rice", exact: true }),
  ).toBeChecked();
  await page.reload();
  await page.getByRole("button", { name: "Shopping", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "1 cup rice", exact: true }),
  ).toBeChecked();
  await page
    .getByRole("button", { name: "Account and settings", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Sign in with Polli", exact: true }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export backup", exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe("brownbag-backup.json");
  await page.screenshot({ path: "test-results/settings-mobile.png" });
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Recipes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open Lemon rice for two", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: "test-results/cookbook-desktop.png" });
  expect(errors).toEqual([]);
});
