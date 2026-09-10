import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Store } from '../server/store.js';
import { createApp } from '../server/app.js';
import { recipeSchema } from '../shared/schema.js';

async function fixture() {
  const store = new Store(':memory:'); const codes = new Map<string, string>();
  const app = createApp(store, { origin: 'http://localhost:3000', production: false, mailMode: 'console', sendCode: async (email, code) => { codes.set(email, code); } });
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (path: string, body?: unknown, headers: Record<string, string> = {}, method?: string) => fetch(`${url}${path}`, { method: method || (body === undefined ? 'GET' : 'POST'), headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const login = async (email: string) => { assert.equal((await request('/api/auth/code', { email })).status, 200); const response = await request('/api/auth/verify', { email, code: codes.get(email) }); assert.equal(response.status, 200); return response.headers.get('set-cookie')!.split(';')[0]; };
  const close = async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); store.db.close(); };
  return { store, codes, url, request, login, close };
}
test('email codes are one-use, expire, limit guesses and never leak to HTTP', async () => {
  const f = await fixture();
  try {
    const email = 'a@example.com';
    const send = await f.request('/api/auth/code', { email }); assert.deepEqual(await send.json(), { ok: true });
    assert.equal((await f.request('/api/auth/code', { email })).status, 429);
    assert.equal((await f.request('/api/auth/verify', { email, code: '00000000' })).status, 400);
    const response = await f.request('/api/auth/verify', { email, code: f.codes.get(email) }); assert.equal(response.status, 200);
    assert.match(response.headers.get('set-cookie')!, /HttpOnly/); assert.match(response.headers.get('set-cookie')!, /SameSite=Lax/);
    assert.equal((await f.request('/api/auth/verify', { email, code: f.codes.get(email) })).status, 400);
    const locked = 'locked@example.com'; await f.request('/api/auth/code', { email: locked });
    for (let i = 0; i < 5; i++) await f.request('/api/auth/verify', { email: locked, code: '00000000' });
    assert.equal((await f.request('/api/auth/verify', { email: locked, code: f.codes.get(locked) })).status, 400);
    const expired = 'expired@example.com'; await f.request('/api/auth/code', { email: expired });
    f.store.db.prepare('UPDATE login_codes SET expires_at=0 WHERE email=?').run(expired);
    assert.equal((await f.request('/api/auth/verify', { email: expired, code: f.codes.get(expired) })).status, 400);
    assert.equal((await f.request('/api/recipes')).status, 401);
    assert.equal((await f.request('/api/auth/code', { email }, { origin: 'https://evil.example' })).status, 403);
  } finally { await f.close(); }
});
test('real MCP client: discovery, review, tenant isolation, YOLO, revocation and human-only controls', async () => {
  const f = await fixture(); const client = new Client({ name: 'brownbag-test', version: '1.0.0' });
  try {
    const cookie = await f.login('alice@example.com');
    const key = await (await f.request('/api/keys', { name: 'test agent' }, { cookie })).json();
    assert.ok(key.token.startsWith('bb_'));
    const stored = f.store.db.prepare('SELECT hash FROM api_keys WHERE id=?').get(key.id) as { hash: string }; assert.notEqual(stored.hash, key.token);
    await client.connect(new StreamableHTTPClientTransport(new URL(`${f.url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${key.token}` } } }));
    const names = (await client.listTools()).tools.map(t => t.name);
    assert.ok(names.includes('merge_recipes')); assert.ok(!names.includes('approve_change')); assert.ok(!names.includes('enable_yolo'));
    const data = recipeSchema.parse({ title: 'Chickpea salad', ingredients: [{ ingredient: 'chickpeas' }], steps: [{ text: 'Mix and serve.' }] });
    const result = await client.callTool({ name: 'create_recipe', arguments: { recipe: data } });
    const pending = JSON.parse((result.content as { text: string }[])[0].text); assert.equal(pending.status, 'pending');
    assert.equal((await (await f.request('/api/recipes', undefined, { cookie })).json()).total, 0);
    assert.equal((await f.request('/api/changes/' + pending.changeId + '/review', { approve: true }, { Authorization: `Bearer ${key.token}` })).status, 401);
    assert.equal((await f.request('/api/me', { yolo: true }, { Authorization: `Bearer ${key.token}` }, 'PATCH')).status, 401);
    const bobCookie = await f.login('bob@example.com');
    assert.equal((await f.request('/api/changes/' + pending.changeId + '/review', { approve: true }, { cookie: bobCookie })).status, 404);
    const approved = await (await f.request('/api/changes/' + pending.changeId + '/review', { approve: true }, { cookie })).json();
    assert.equal((await f.request(`/api/recipes/${approved.recipe.id}`, undefined, { cookie: bobCookie })).status, 404);
    const read = await client.callTool({ name: 'get_recipe', arguments: { id: approved.recipe.id } }); assert.equal(read.isError, undefined);
    await f.request('/api/me', { yolo: true }, { cookie }, 'PATCH');
    const edit = await client.callTool({ name: 'update_recipe', arguments: { id: approved.recipe.id, baseVersion: 1, recipe: { ...data, title: 'Better chickpea salad' } } });
    const applied = JSON.parse((edit.content as { text: string }[])[0].text); assert.equal(applied.status, 'applied'); assert.equal(applied.recipe.version, 2);
    const conflict = await client.callTool({ name: 'delete_recipe', arguments: { id: approved.recipe.id, baseVersion: 1 } }); assert.equal(conflict.isError, true);
    await f.request(`/api/keys/${key.id}`, undefined, { cookie }, 'DELETE');
    await assert.rejects(() => client.callTool({ name: 'search_recipes', arguments: {} }));
    await f.request('/api/auth/logout', {}, { cookie }); assert.equal((await f.request('/api/me', undefined, { cookie })).status, 401);
  } finally { await client.close(); await f.close(); }
});
