import assert from 'node:assert/strict';
import test from 'node:test';
import { createId } from '../src/id';

test('client IDs remain valid and distinct when randomUUID is unavailable', (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis.crypto, 'randomUUID');
  Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true });
  t.after(() => {
    if (original) Object.defineProperty(globalThis.crypto, 'randomUUID', original);
    else delete (globalThis.crypto as Partial<Crypto>).randomUUID;
  });
  const ids = Array.from({ length: 100 }, createId);
  for (const id of ids)
    assert.match(id, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
  assert.equal(new Set(ids).size, ids.length);
});
