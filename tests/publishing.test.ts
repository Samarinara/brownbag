import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase } from './support/database.js';
import { Publisher } from '../server/publishing.js';
import { createRecipeRecord } from '../server/atproto/records.js';
import { RECIPE_COLLECTION } from '../shared/atproto.js';

test('PDS publication preserves timestamps, guards CIDs and checks ownership before connecting', async () => {
  const { pg, db } = await createTestDatabase();
  const did = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
  await db.query('INSERT INTO actors(did) VALUES ($1)', [did]);
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
  let currentCid = 'old-cid';
  const agent = {
    com: {
      atproto: {
        repo: {
          getRecord: async () => ({ data: { uri, cid: currentCid, value: previous } }),
          putRecord: async (args: any) => {
            writes.push(args);
            currentCid = 'new-cid';
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
      db,
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
  await pg.close();
});

const alice = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const input = {
  title: 'Soup',
  ingredients: [{ name: 'water' }],
  instructions: [{ text: 'Simmer.' }],
};
async function durableHarness() {
  const { pg, db } = await createTestDatabase();
  await db.query('INSERT INTO actors(did) VALUES ($1)', [alice]);
  const records = new Map<string, { cid: string; uri: string; value: any }>();
  const writes: any[] = [];
  let loseResponse = false;
  let failBeforeWrite = false;
  let projectFails = false;
  let readFails = false;
  let deletes = 0;
  const agent = {
    com: {
      atproto: {
        sync: { getLatestCommit: async () => ({ data: { rev: '3mabc234567ac' } }) },
        repo: {
          getRecord: async ({ rkey }: any) => {
            if (readFails) throw new Error('PDS unreachable');
            const record = records.get(rkey);
            if (!record)
              throw Object.assign(new Error('Record not found'), { error: 'RecordNotFound' });
            return { data: record };
          },
          putRecord: async (args: any) => {
            writes.push(args);
            if (failBeforeWrite) {
              failBeforeWrite = false;
              throw new Error('Connection failed before acceptance');
            }
            const old = records.get(args.rkey);
            if ((old?.cid || null) !== args.swapRecord)
              throw Object.assign(new Error('CAS mismatch'), { error: 'InvalidSwap' });
            const record = {
              cid: `cid-${writes.length}`,
              uri: `at://${alice}/${RECIPE_COLLECTION}/${args.rkey}`,
              value: args.record,
            };
            records.set(args.rkey, record);
            if (loseResponse) {
              loseResponse = false;
              throw new Error('Response lost');
            }
            return { data: { ...record, commit: { rev: '3mabc234567ac' } } };
          },
          deleteRecord: async (args: any) => {
            deletes++;
            if (records.get(args.rkey)?.cid !== args.swapRecord) throw new Error('CAS mismatch');
            records.delete(args.rkey);
            if (loseResponse) {
              loseResponse = false;
              throw new Error('Response lost');
            }
            return { data: { commit: { rev: '3mabc234567ad' } } };
          },
        },
      },
    },
  };
  const projected: any[] = [];
  const store = {
    db,
    index: async (event: any) => {
      if (projectFails) throw new Error('Database unavailable');
      projected.push(event);
    },
  } as any;
  const publisher = () => new Publisher(store, async () => agent as any);
  return {
    pg,
    db,
    records,
    agent,
    writes,
    store,
    publisher,
    projected,
    lose: () => {
      loseResponse = true;
    },
    failBefore: () => {
      failBeforeWrite = true;
    },
    failProjection: (fail: boolean) => {
      projectFails = fail;
    },
    failRead: (fail: boolean) => {
      readFails = fail;
    },
    deletes: () => deletes,
  };
}

test('lost create responses recover across Publisher restarts without duplicate records; keys bind account and payload', async () => {
  const h = await durableHarness();
  try {
    h.lose();
    await assert.rejects(
      h.publisher().publish(alice, input, undefined, 'create-one'),
      /Response lost/,
    );
    const recovered = await h.publisher().publish(alice, input, undefined, 'create-one');
    assert.equal(h.writes.length, 1);
    assert.equal(h.records.size, 1);
    assert.equal(
      recovered.uri,
      h.writes[0] && `at://${alice}/${RECIPE_COLLECTION}/${h.writes[0].rkey}`,
    );
    await assert.rejects(
      h.publisher().publish(alice, { ...input, title: 'Different' }, undefined, 'create-one'),
      /different content/,
    );
    await h.db.query('INSERT INTO actors(did) VALUES ($1)', ['did:plc:bbbbbbbbbbbbbbbbbbbbbbbb']);
    // Keys are scoped to accounts; another account cannot inspect Alice's result.
    await assert.rejects(
      h.publisher().recover('did:plc:bbbbbbbbbbbbbbbbbbbbbbbb', 'create-one'),
      /not found/,
    );
  } finally {
    await h.pg.close();
  }
});

test('active claims stop concurrent operations and expired claims inspect PDS before replay', async () => {
  const h = await durableHarness();
  try {
    h.lose();
    await assert.rejects(h.publisher().publish(alice, input, undefined, 'lease-test'));
    await h.db.query(
      "UPDATE publication_operations SET lease_until=now()+interval '1 minute',lease_token=$1",
      ['00000000-0000-4000-8000-000000000001'],
    );
    await assert.rejects(h.publisher().recover(alice, 'lease-test'), /already being processed/);
    await h.db.query("UPDATE publication_operations SET lease_until=now()-interval '1 minute'");
    h.failRead(true);
    await assert.rejects(h.publisher().recover(alice, 'lease-test'), /unreachable/);
    assert.equal(h.writes.length, 1);
    h.failRead(false);
    await h.publisher().recover(alice, 'lease-test');
    assert.equal(h.writes.length, 1);
  } finally {
    await h.pg.close();
  }
});

test('uncertain updates recover their result; later edits conflict instead of overwriting', async () => {
  const h = await durableHarness();
  try {
    const first = await h.publisher().publish(alice, input, undefined, 'initial');
    h.lose();
    await assert.rejects(
      h.publisher().publish(alice, { ...input, title: 'Better soup' }, first, 'edit'),
    );
    const recovered = await h
      .publisher()
      .publish(alice, { ...input, title: 'Better soup' }, first, 'edit');
    assert.equal(recovered.record.title, 'Better soup');
    assert.equal(h.writes.length, 2);
    h.lose();
    await assert.rejects(
      h.publisher().publish(alice, { ...input, title: 'Newest' }, recovered, 'next'),
    );
    const key = h.writes[2].rkey;
    h.records.set(key, {
      cid: 'external-edit',
      uri: first.uri,
      value: { ...h.writes[2].record, title: 'External' },
    });
    await assert.rejects(h.publisher().recover(alice, 'next'), /changed/);
    assert.equal(h.writes.length, 3);
    assert.equal(h.records.get(key)?.value.title, 'External');
  } finally {
    await h.pg.close();
  }
});

test('lost delete responses recover absence without another delete; projection failures remain durable', async () => {
  const h = await durableHarness();
  try {
    const recipe = await h.publisher().publish(alice, input, undefined, 'initial');
    h.lose();
    await assert.rejects(h.publisher().delete(alice, recipe.uri, recipe.cid, 'delete-one'));
    h.failProjection(true);
    await h.publisher().delete(alice, recipe.uri, recipe.cid, 'delete-one');
    assert.equal(h.deletes(), 1);
    const [operation] = await h.db.query(
      "SELECT status,projection_pending FROM publication_operations WHERE operation_key='delete-one'",
    );
    assert.equal(operation.status, 'succeeded');
    assert.equal(operation.projection_pending, true);
    h.failProjection(false);
    await h.publisher().recover(alice, 'delete-one');
    assert.equal(h.deletes(), 1);
    assert.equal(h.projected.at(-1).deleted, true);
    assert.equal(
      (
        await h.db.query(
          "SELECT projection_pending FROM publication_operations WHERE operation_key='delete-one'",
        )
      )[0].projection_pending,
      false,
    );
  } finally {
    await h.pg.close();
  }
});

test('proposal recovery completes an approved intent after response loss and only audits once', async () => {
  const { recoverPublications } = await import('../server/network-mcp.js');
  const h = await durableHarness();
  try {
    const id = '00000000-0000-4000-8000-000000000002';
    await h.db.query(
      "INSERT INTO proposals(id,did,payload,status) VALUES ($1,$2,$3::text::jsonb,'applying')",
      [id, alice, JSON.stringify({ action: 'create', recipe: input })],
    );
    h.lose();
    await assert.rejects(h.publisher().publish(alice, input, undefined, `proposal:${id}`));
    const outcomes = await recoverPublications(h.store, h.publisher());
    assert.equal(outcomes[0].recovered, true);
    assert.equal(h.writes.length, 1);
    assert.equal(
      (await h.db.query('SELECT status FROM proposals WHERE id=$1', [id]))[0].status,
      'approved',
    );
    await recoverPublications(h.store, h.publisher());
    assert.equal((await h.db.query('SELECT * FROM audit_events')).length, 1);
    // Also recover the narrower crash window before an operation was persisted.
    const nextId = '00000000-0000-4000-8000-000000000003';
    await h.db.query(
      "INSERT INTO proposals(id,did,payload,status) VALUES ($1,$2,$3::text::jsonb,'applying')",
      [nextId, alice, JSON.stringify({ action: 'create', recipe: input })],
    );
    const pendingId = '00000000-0000-4000-8000-000000000004';
    await h.db.query('INSERT INTO proposals(id,did,payload) VALUES ($1,$2,$3::text::jsonb)', [
      pendingId,
      alice,
      JSON.stringify({ action: 'create', recipe: input }),
    ]);
    await recoverPublications(h.store, h.publisher());
    assert.equal(h.writes.length, 2);
    assert.equal(
      (await h.db.query('SELECT status FROM proposals WHERE id=$1', [pendingId]))[0].status,
      'pending',
    );
  } finally {
    await h.pg.close();
  }
});

test('an uncertain unaccepted create retries the persisted record key after authoritative absence', async () => {
  const h = await durableHarness();
  try {
    h.failBefore();
    await assert.rejects(
      h.publisher().publish(alice, input, undefined, 'unaccepted'),
      /before acceptance/,
    );
    assert.equal(h.records.size, 0);
    const recovered = await h.publisher().recover(alice, 'unaccepted');
    assert.equal(h.records.size, 1);
    assert.equal(h.writes[0].rkey, h.writes[1].rkey);
    assert.equal(h.writes[0].record.createdAt, h.writes[1].record.createdAt);
    assert.equal(recovered?.uri, `at://${alice}/${RECIPE_COLLECTION}/${h.writes[0].rkey}`);
  } finally {
    await h.pg.close();
  }
});

test('concurrent proposal recovery preserves approval while a lease owner prepares its write', async () => {
  const { recoverPublications, completeProposal } = await import('../server/network-mcp.js');
  const h = await durableHarness();
  let releaseAgent!: () => void;
  let enteredAgent!: () => void;
  const waiting = new Promise<void>((resolve) => {
    releaseAgent = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    enteredAgent = resolve;
  });
  let publication: Promise<import('../shared/atproto.js').RecipeView> | undefined;
  try {
    const id = '00000000-0000-4000-8000-000000000005';
    await h.db.query(
      "INSERT INTO proposals(id,did,payload,status) VALUES ($1,$2,$3::text::jsonb,'applying')",
      [id, alice, JSON.stringify({ action: 'create', recipe: input })],
    );
    const original = new Publisher(h.store, async () => {
      enteredAgent();
      await waiting;
      return h.agent as any;
    });
    publication = original.publish(alice, input, undefined, `proposal:${id}`);
    await entered;
    const [operation] = await h.db.query(
      'SELECT attempted,status,lease_token FROM publication_operations WHERE operation_key=$1',
      [`proposal:${id}`],
    );
    assert.equal(operation.attempted, false);
    assert.equal(operation.status, 'pending');
    assert.ok(operation.lease_token);
    const outcomes = await recoverPublications(h.store, h.publisher());
    assert.equal(outcomes[0].recovered, false);
    assert.match(outcomes[0].error!, /already being processed/);
    assert.equal(
      (await h.db.query('SELECT status FROM proposals WHERE id=$1', [id]))[0].status,
      'applying',
    );
    const rejected = await h.db.query(
      "UPDATE proposals SET status='rejected' WHERE id=$1 AND status='pending' RETURNING id",
      [id],
    );
    assert.equal(rejected.length, 0);
    assert.equal(h.writes.length, 0);
    releaseAgent();
    const recipe = await publication;
    await completeProposal(h.store, id, alice, 'create', recipe);
    assert.equal(h.writes.length, 1);
    assert.equal(
      (await h.db.query('SELECT status FROM proposals WHERE id=$1', [id]))[0].status,
      'approved',
    );
  } finally {
    releaseAgent();
    await publication?.catch(() => {});
    await h.pg.close();
  }
});
