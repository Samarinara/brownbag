import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRecipePage, recipeImportUrl } from "../server/recipe-import.js";
import { dateSchema, payloadSchema } from "../shared/model.js";
test("structured recipe import preserves ingredients, sections, duration, and source credit", () => {
  const recipe = parseRecipePage(
    `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Recipe", name: "Noodles", recipeIngredient: ["2 cups noodles"], recipeInstructions: [{ "@type": "HowToSection", name: "Sauce", itemListElement: [{ "@type": "HowToStep", text: "Mix <b>well</b>." }] }], cookTime: "PT15M", author: { name: "Sam" } })}</script>`,
    "https://example.com/noodles",
  );
  assert.equal(recipe.title, "Noodles");
  assert.equal(recipe.cookMinutes, 15);
  assert.equal(recipe.ingredients[0].name, "2 cups noodles");
  assert.deepEqual(recipe.instructions, [
    { text: "Mix well.", group: "Sauce" },
  ]);
  assert.equal(recipe.source?.name, "Sam");
});
test("rejects malformed links, nonrecipes, and invalid calendar dates", () => {
  for (const value of [
    "file:///etc/passwd",
    "https://user:secret@example.com",
    "nonsense",
  ])
    assert.throws(() => recipeImportUrl(value));
  assert.throws(() =>
    parseRecipePage("<h1>No recipe</h1>", "https://example.com"),
  );
  assert.equal(dateSchema.safeParse("2026-02-30").success, false);
  assert.equal(dateSchema.safeParse("2028-02-29").success, true);
  assert.equal(
    payloadSchema.safeParse({ kind: "recipe", data: { title: "incomplete" } })
      .success,
    false,
  );
});
