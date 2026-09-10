import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store, AppError } from '../server/store.js';
import { recipeSchema } from '../shared/schema.js';

const recipe = recipeSchema.parse({
  title: 'Lemon pasta',
  ingredients: [
    { quantity: 200, unit: 'g', ingredient: 'spaghetti' },
    { quantity: 1, ingredient: 'lemon' },
  ],
  steps: [{ text: 'Boil pasta. Toss with lemon.' }],
  tags: ['Weeknight'],
});
test('private collections, fuzzy ingredients, title-first ranking, tags and indexed updates', () => {
  const store = new Store(':memory:');
  try {
    const alice = store.ensureUser('alice@example.com');
    const bob = store.ensureUser('bob@example.com');
    const created = store.mutate(alice.id, { action: 'create', data: recipe }, 'human');
    assert.equal(created.status, 'applied');
    if (created.status !== 'applied') return;
    assert.equal(store.search(alice.id, 'spagheti')[0].title, 'Lemon pasta');
    assert.equal(store.search(alice.id, 'spagheti', true).length, 0);
    assert.equal(store.search(alice.id, '', false, 'Weeknight').length, 1);
    store.mutate(
      alice.id,
      { action: 'create', data: { ...recipe, title: 'Spaghetti supper' } },
      'human',
    );
    assert.equal(store.search(alice.id, 'spaghetti')[0].title, 'Spaghetti supper');
    assert.equal(store.search(bob.id).length, 0);
    assert.throws(
      () => store.get(bob.id, created.recipe.id),
      (e: unknown) => e instanceof AppError && e.status === 404,
    );
    assert.throws(() =>
      store.mutate(
        bob.id,
        { action: 'delete', recipeId: created.recipe.id, baseVersion: 1 },
        'human',
      ),
    );
    store.mutate(
      alice.id,
      {
        action: 'update',
        recipeId: created.recipe.id,
        baseVersion: 1,
        data: {
          ...recipe,
          title: 'Tomato rice',
          ingredients: [{ quantity: 1, unit: 'cup', ingredient: 'rice', note: '' }],
        },
      },
      'human',
    );
    assert.equal(store.search(alice.id, 'lemon', true).length, 0);
    assert.equal(store.search(alice.id, 'tomato', true).length, 1);
  } finally {
    store.db.close();
  }
});
test('agent proposals require review, enforce ownership and detect stale edits', () => {
  const store = new Store(':memory:');
  try {
    const alice = store.ensureUser('alice@example.com');
    const bob = store.ensureUser('bob@example.com');
    const pending = store.mutate(alice.id, { action: 'create', data: recipe }, 'agent', true);
    assert.equal(pending.status, 'pending');
    if (pending.status !== 'pending') return;
    assert.equal(store.search(alice.id).length, 0);
    assert.throws(() => store.review(bob.id, pending.changeId, true));
    const approved = store.review(alice.id, pending.changeId, true).recipe!;
    assert.equal(approved.version, 1);
    assert.throws(() => store.review(alice.id, pending.changeId, true));
    const edit = store.mutate(
      alice.id,
      {
        action: 'update',
        recipeId: approved.id,
        baseVersion: 1,
        data: { ...recipe, title: 'Agent version' },
      },
      'agent',
      true,
    );
    store.mutate(
      alice.id,
      {
        action: 'update',
        recipeId: approved.id,
        baseVersion: 1,
        data: { ...recipe, title: 'Human version' },
      },
      'human',
    );
    if (edit.status !== 'pending') throw new Error('Expected pending');
    assert.throws(
      () => store.review(alice.id, edit.changeId, true),
      (e: unknown) => e instanceof AppError && e.status === 409,
    );
    assert.equal(store.changes(alice.id).find((c) => c.id === edit.changeId)?.status, 'pending');
    assert.equal(store.get(alice.id, approved.id).title, 'Human version');
    store.review(alice.id, edit.changeId, false);
    assert.equal(store.changes(alice.id).find((c) => c.id === edit.changeId)?.status, 'rejected');
  } finally {
    store.db.close();
  }
});
test('per-user YOLO, atomic merge, soft deletion, immutable history and restore', () => {
  const store = new Store(':memory:');
  try {
    const alice = store.ensureUser('alice@example.com');
    const bob = store.ensureUser('bob@example.com');
    store.db.prepare('UPDATE users SET yolo=1 WHERE id=?').run(alice.id);
    const first = store.mutate(alice.id, { action: 'create', data: recipe }, 'agent', true);
    const second = store.mutate(alice.id, { action: 'create', data: recipe }, 'agent', true);
    assert.equal(
      store.mutate(bob.id, { action: 'create', data: recipe }, 'agent', true).status,
      'pending',
    );
    if (first.status !== 'applied' || second.status !== 'applied') throw new Error('Expected YOLO');
    assert.equal(store.duplicates(alice.id, first.recipe.id)[0].recipe.id, second.recipe.id);
    const merge = {
      action: 'merge',
      recipeId: first.recipe.id,
      baseVersion: 1,
      sourceId: second.recipe.id,
      sourceVersion: 2,
      data: { ...recipe, title: 'Merged lemon pasta' },
    };
    assert.throws(() => store.mutate(alice.id, merge, 'agent', true));
    assert.equal(store.get(alice.id, first.recipe.id).version, 1);
    store.mutate(alice.id, { ...merge, sourceVersion: 1 }, 'agent', true);
    assert.equal(store.search(alice.id).length, 1);
    assert.equal(store.trash(alice.id).length, 1);
    assert.equal(store.revisions(alice.id, second.recipe.id).length, 2);
    const old = store.revisions(alice.id, first.recipe.id).find((r) => r.version === 1)!;
    const restored = store.restore(alice.id, first.recipe.id, old.id, 2);
    assert.equal(restored.version, 3);
    assert.equal(restored.title, recipe.title);
    assert.equal(store.revisions(alice.id, first.recipe.id).length, 3);
    assert.throws(() => store.revisions(bob.id, first.recipe.id));
    const deleted = store.revisions(alice.id, second.recipe.id)[0];
    store.restore(alice.id, second.recipe.id, deleted.id, 2);
    assert.equal(store.search(alice.id).length, 2);
    assert.equal(store.trash(alice.id).length, 0);
    assert.ok(store.logs(alice.id).length > 5);
  } finally {
    store.db.close();
  }
});
