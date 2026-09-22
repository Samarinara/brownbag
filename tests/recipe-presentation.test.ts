import assert from 'node:assert/strict';
import test from 'node:test';
import { ingredientSections, recipeTime, recipeYield } from '../src/RecipePresentation';
import type { RecipeInput } from '../shared/atproto';

const recipe: RecipeInput = {
  title: 'Supper',
  ingredients: [{ name: 'salt' }],
  instructions: [{ text: 'Cook.' }],
};

test('recipe facts distinguish missing, zero and partial times', () => {
  assert.equal(recipeTime(recipe), null);
  assert.deepEqual(recipeTime({ ...recipe, prepMinutes: 0 }), { label: 'Prep time', minutes: 0 });
  assert.deepEqual(recipeTime({ ...recipe, cookMinutes: 20 }), { label: 'Cook time', minutes: 20 });
  assert.deepEqual(recipeTime({ ...recipe, prepMinutes: 10, cookMinutes: 20 }), {
    label: 'Total time',
    minutes: 30,
  });
  assert.equal(recipeYield(recipe), '');
  assert.equal(
    recipeYield({ ...recipe, yield: { display: '4 bowls', quantity: '2', unit: 'litres' } }),
    '4 bowls',
  );
  assert.equal(
    recipeYield({ ...recipe, yield: { display: ' ', quantity: '2', unit: 'litres' } }),
    '2 litres',
  );
});

test('ingredient sections preserve recipe order and checklist indices across repeated and empty groups', () => {
  const ingredients = [
    { name: 'salt' },
    { name: 'flour', group: ' Dough ' },
    { name: 'water', group: 'Dough' },
    { name: 'tomato', group: 'Sauce' },
    { name: 'oil' },
    { name: 'yeast', group: 'Dough' },
  ];
  const sections = ingredientSections(ingredients);
  assert.deepEqual(
    sections.map(({ name, items }) => ({ name, indices: items.map(({ index }) => index) })),
    [
      { name: '', indices: [0] },
      { name: 'Dough', indices: [1, 2] },
      { name: 'Sauce', indices: [3] },
      { name: '', indices: [4] },
      { name: 'Dough', indices: [5] },
    ],
  );
  assert.deepEqual(
    sections.flatMap(({ items }) => items.map(({ ingredient }) => ingredient)),
    ingredients,
  );
});
