import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import express from 'express';
import { PGlite } from '@electric-sql/pglite';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { mountNetworkMcp } from '../server/network-mcp.js';
import { NetworkStore, HttpError } from '../server/network-store.js';
import type { Database } from '../server/db.js';
import type { Publisher } from '../server/publishing.js';
import { RECIPE_COLLECTION } from '../shared/atproto.js';

test('agent writes require owner review, claims prevent duplicate publication, and ambiguous failures cannot be replayed', async () => {
  const pg = new PGlite();
  await pg.exec(await readFile(new URL('../migrations/001_network.sql', import.meta.url), 'utf8'));
  const wrap = (connection: Pick<PGlite, 'query' | 'transaction'>): Database => ({
    query: async (text, params) => (await connection.query(text, params)).rows as any,
    transaction: (fn) => connection.transaction((tx) => fn(wrap(tx as unknown as PGlite))),
  });
  const store = new NetworkStore(wrap(pg));
  await store.actor('did:plc:alice');
  await store.actor('did:plc:bob');
  let writes = 0;
  let fail = false;
  const publisher = {
    async publish(did: string, recipe: unknown) {
      writes++;
      if (fail) throw new Error('Response lost after PDS accepted the write');
      return {
        uri: `at://${did}/${RECIPE_COLLECTION}/one`,
        cid: `bafyre${'a'.repeat(53)}`,
        record: recipe,
        authorDid: did,
      };
    },
  } as unknown as Publisher;
  const app = express();
  app.use(express.json());
  const user: express.RequestHandler = (req, res, next) => {
    const did = req.headers['x-user'];
    if (!did) return next(new HttpError(401, 'Sign in'));
    res.locals.user = { did };
    next();
  };
  mountNetworkMcp(app, store, publisher, user);
  app.use(((error, _req, res, _next) =>
    res.status(error.status || 500).json({ error: error.message })) as express.ErrorRequestHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as import('node:net').AddressInfo;
  const url = `http://127.0.0.1:${address.port}`;
  const api = (path: string, body?: unknown, did = 'did:plc:alice') =>
    fetch(url + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'x-user': did },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const client = new Client({ name: 'test-agent', version: '1' });
  try {
    const keyResponse = await api('/api/keys', { name: 'Test agent' });
    assert.equal(keyResponse.status, 201);
    const key = (await keyResponse.json()) as any;
    assert.match(key.token, /^bb_/);
    const stored = (await pg.query<{ hash: string }>('SELECT hash FROM agent_keys')).rows[0];
    assert.notEqual(stored.hash, key.token);
    assert.ok(!JSON.stringify(await (await api('/api/keys')).json()).includes(key.token));
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url + '/mcp'), {
        requestInit: { headers: { Authorization: `Bearer ${key.token}` } },
      }),
    );
    const recipe = {
      title: 'Soup',
      ingredients: [{ name: 'water' }],
      instructions: [{ text: 'Boil.' }],
    };
    const result = await client.callTool({ name: 'create_recipe', arguments: { recipe } });
    const proposal = JSON.parse((result.content as { text: string }[])[0].text);
    assert.equal(proposal.status, 'pending');
    assert.equal(writes, 0);
    assert.equal(
      (await api(`/api/proposals/${proposal.id}/review`, { approve: true }, 'did:plc:bob')).status,
      404,
    );
    const approvals = await Promise.all([
      api(`/api/proposals/${proposal.id}/review`, { approve: true }),
      api(`/api/proposals/${proposal.id}/review`, { approve: true }),
    ]);
    assert.deepEqual(approvals.map((r) => r.status).sort(), [200, 409]);
    assert.equal(writes, 1);
    assert.equal(
      (
        await pg.query<{ status: string }>('SELECT status FROM proposals WHERE id=$1', [
          proposal.id,
        ])
      ).rows[0].status,
      'approved',
    );
    const cid = `bafyre${'a'.repeat(53)}`;
    const uri = `at://did:plc:alice/${RECIPE_COLLECTION}/one`;
    await store.index({
      did: 'did:plc:alice',
      collection: RECIPE_COLLECTION,
      rkey: 'one',
      cid,
      record: { ...recipe, $type: RECIPE_COLLECTION, createdAt: new Date().toISOString() },
      rev: '1',
    });
    const otherOwner = await client.callTool({
      name: 'update_recipe',
      arguments: {
        uri: `at://did:plc:bob/${RECIPE_COLLECTION}/one`,
        cid,
        recipe,
      },
    });
    assert.equal(otherOwner.isError, true);
    const staleId = randomUUID();
    await pg.query('INSERT INTO proposals(id,did,payload) VALUES ($1,$2,$3)', [
      staleId,
      'did:plc:alice',
      JSON.stringify({ action: 'update', uri, cid: `bafyre${'b'.repeat(53)}`, recipe }),
    ]);
    assert.equal((await api(`/api/proposals/${staleId}/review`, { approve: true })).status, 409);
    assert.equal(writes, 1);
    const id = randomUUID();
    await pg.query('INSERT INTO proposals(id,did,payload) VALUES ($1,$2,$3)', [
      id,
      'did:plc:alice',
      JSON.stringify({ action: 'create', recipe }),
    ]);
    fail = true;
    assert.equal((await api(`/api/proposals/${id}/review`, { approve: true })).status, 500);
    assert.equal((await api(`/api/proposals/${id}/review`, { approve: true })).status, 409);
    assert.equal(writes, 2);
    assert.equal(
      (await pg.query<{ status: string }>('SELECT status FROM proposals WHERE id=$1', [id])).rows[0]
        .status,
      'applying',
    );
    assert.equal(
      (
        await fetch(url + `/api/keys/${key.id}`, {
          method: 'DELETE',
          headers: { 'x-user': 'did:plc:alice' },
        })
      ).status,
      200,
    );
    await assert.rejects(client.callTool({ name: 'list_changes', arguments: {} }));
  } finally {
    await client.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await pg.close();
  }
});
