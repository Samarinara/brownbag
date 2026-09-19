import test from 'node:test';
import assert from 'node:assert/strict';
import { Publisher } from '../server/publishing.js';
import { createRecipeRecord } from '../server/atproto/records.js';
import { RECIPE_COLLECTION } from '../shared/atproto.js';

test('PDS publication preserves timestamps, guards CIDs and checks ownership before connecting', async () => {
  const did = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
  const uri = `at://${did}/${RECIPE_COLLECTION}/3mabc234567ab`;
  const input = {
    title: 'Soup',
    ingredients: [{ name: 'water' }],
    instructions: [{ text: 'Simmer.' }],
  };
  const previous = createRecipeRecord(input, undefined, '2026-01-01T00:00:00.000Z');
  const writes: any[] = [];
  const projected: any[] = [];
  let connections = 0;
  const agent = {
    com: {
      atproto: {
        repo: {
          getRecord: async () => ({ data: { cid: 'old-cid', value: previous } }),
          putRecord: async (args: any) => {
            writes.push(args);
            return { data: { uri, cid: 'new-cid', commit: { rev: '3mabc234567ac' } } };
          },
          deleteRecord: async (args: any) => {
            writes.push(args);
            return { data: { commit: { rev: '3mabc234567ad' } } };
          },
        },
      },
    },
  };
  const publisher = new Publisher(
    {
      index: async (event: any) => {
        projected.push(event);
      },
    } as any,
    async () => {
      connections++;
      return agent as any;
    },
  );
  await assert.rejects(
    () => publisher.publish('did:plc:bbbbbbbbbbbbbbbbbbbbbbbb', input, { uri, cid: 'old-cid' }),
    /own recipes/,
  );
  assert.equal(connections, 0);
  await assert.rejects(() => publisher.publish(did, input, { uri, cid: 'stale-cid' }), /changed/);
  assert.equal(writes.length, 0);
  await publisher.publish(did, { ...input, title: 'Better soup' }, { uri, cid: 'old-cid' });
  assert.equal(writes[0].swapRecord, 'old-cid');
  assert.equal(writes[0].record.createdAt, previous.createdAt);
  assert.equal(projected[0].rev, '3mabc234567ac');
  await publisher.publish(did, input);
  assert.equal(writes[1].swapRecord, null);
  await publisher.delete(did, uri, 'new-cid');
  assert.equal(writes[2].swapRecord, 'new-cid');
  assert.equal(projected[2].deleted, true);
});
