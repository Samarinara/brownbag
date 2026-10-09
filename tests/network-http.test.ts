import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test, { type TestContext } from 'node:test';
import { createNetworkApp } from '../server/network-app.js';
import type { OAuthService } from '../server/atproto/oauth.js';
import type { NetworkStore } from '../server/network-store.js';

async function fixture(t: TestContext, state?: string) {
  const sessions: unknown[][] = [];
  const store = {
    db: {
      transaction: async (fn: (db: NetworkStore['db']) => Promise<unknown>) => fn(store.db),
      query: async (sql: string, params: unknown[]) => {
        if (sql.startsWith('INSERT INTO app_sessions')) sessions.push(params);
        return [];
      },
    },
    actor: async () => {},
    rateLimit: async () => {},
  } as unknown as NetworkStore;
  const oauth = {
    callback: async () => ({ state, session: { did: 'did:plc:alice' } }),
    identity: async () => ({ handle: 'alice.example' }),
    authorize: async () => new URL('https://pds.example/authorize'),
  } as unknown as OAuthService;
  const server = createNetworkApp({ origin: 'http://localhost', store, oauth }).listen(
    0,
    '127.0.0.1',
  );
  await new Promise<void>((resolve) => server.once('listening', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, sessions };
}

test('network API rejects malformed JSON as a client error without echoing the body', async (t) => {
  const { url } = await fixture(t);
  const response = await fetch(`${url}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"handle":"private-input",',
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Request body must be valid JSON.' });
  assert.equal(response.headers.get('cache-control'), 'no-store');

  const valid = await fetch(`${url}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handle: 'alice.example' }),
  });
  assert.equal(valid.status, 200);
});

test('network OAuth callback rejects invalid states before creating an app session', async (t) => {
  for (const state of [undefined, 'short', 'b'.repeat(43), 'é'.repeat(43)]) {
    await t.test(`state: ${state === undefined ? 'missing' : state.slice(0, 5)}`, async (t) => {
      const { url, sessions } = await fixture(t, state);
      const response = await fetch(`${url}/api/auth/callback`, {
        headers: { cookie: `brownbag_oauth=${'a'.repeat(43)}` },
        redirect: 'manual',
      });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), {
        error: 'Sign-in could not be verified. Please try again.',
      });
      assert.equal(sessions.length, 0);
    });
  }
});

test('network OAuth callback accepts matching states and issues a protected session cookie', async (t) => {
  const nonce = 'a'.repeat(43);
  const { url, sessions } = await fixture(t, nonce);
  const response = await fetch(`${url}/api/auth/callback`, {
    headers: { cookie: `brownbag_oauth=${nonce}` },
    redirect: 'manual',
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/');
  assert.match(response.headers.get('set-cookie')!, /brownbag_session=.*HttpOnly.*SameSite=Lax/);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0][1], 'did:plc:alice');
});
