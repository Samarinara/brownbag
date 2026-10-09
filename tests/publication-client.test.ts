import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readPublicationIntent,
  persistPublicationIntent,
  removePublicationIntent,
} from '../src/publication-operation';
import { recoveryKey, clearDeviceData } from '../src/offline-storage';
const storage: Record<string, string> = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => storage[key] || null,
    setItem: (key: string, value: string) => {
      storage[key] = value;
      Object.defineProperty(localStorage, key, { value, configurable: true, enumerable: true });
    },
    removeItem: (key: string) => {
      delete storage[key];
      delete (localStorage as any)[key];
    },
  },
});
Object.defineProperty(globalThis, 'window', { value: new EventTarget() });

test('publication identity and frozen input survive restore, remain account/draft scoped, and clear with device data', async () => {
  const key = recoveryKey('did:plc:alice', '/recipe/draft/one');
  const intent = {
    id: '00000000-0000-4000-8000-000000000001',
    recipe: { title: 'Soup', ingredients: [{ name: 'water' }], instructions: [{ text: 'Boil.' }] },
    draftId: '00000000-0000-4000-8000-000000000002',
  };
  persistPublicationIntent(key, intent);
  assert.deepEqual(readPublicationIntent(key), intent);
  intent.recipe.title = 'Changed';
  assert.equal(readPublicationIntent(key)?.recipe.title, 'Soup');
  assert.equal(readPublicationIntent(recoveryKey('did:plc:bob', '/recipe/draft/one')), undefined);
  assert.equal(readPublicationIntent(recoveryKey('did:plc:alice', '/recipe/draft/two')), undefined);
  removePublicationIntent(key);
  assert.equal(readPublicationIntent(key), undefined);
  persistPublicationIntent(key, intent);
  localStorage.setItem('brownbag-theme', 'dark');
  await clearDeviceData();
  assert.equal(readPublicationIntent(key), undefined);
  assert.equal(localStorage.getItem('brownbag-theme'), 'dark');
});
