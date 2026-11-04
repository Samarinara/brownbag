import assert from 'node:assert/strict';
import test from 'node:test';
import { api, ApiError } from '../src/api';

test('API accepts all RequestInit header formats and preserves explicit content types', async (t) => {
  const cases: HeadersInit[] = [
    { Authorization: 'Bearer test', 'content-type': 'text/plain' },
    new Headers({ Authorization: 'Bearer test', 'content-type': 'text/plain' }),
    [
      ['Authorization', 'Bearer test'],
      ['content-type', 'text/plain'],
    ],
  ];
  t.mock.method(globalThis, 'fetch', async (path: string, options: RequestInit) => {
    assert.equal(path, '/api/test');
    const headers = new Headers(options.headers);
    assert.equal(headers.get('Authorization'), 'Bearer test');
    assert.equal(headers.get('Content-Type'), 'text/plain');
    assert.equal(options.cache, 'no-store');
    return Response.json({ ok: true });
  });
  for (const headers of cases) {
    assert.deepEqual(await api('/test', { method: 'POST', body: 'hello', headers }), { ok: true });
  }
});

test('API defaults request bodies to JSON', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_path: string, options: RequestInit) => {
    assert.equal(new Headers(options.headers).get('Content-Type'), 'application/json');
    return Response.json({ ok: true });
  });
  await api('/test', { method: 'POST', body: '{}' });
});

test('API preserves HTTP status when errors contain HTML, empty or unexpected JSON bodies', async (t) => {
  const responses = [
    new Response('<html>Unavailable</html>', { status: 503 }),
    new Response(null, { status: 401 }),
    Response.json(null, { status: 403 }),
    Response.json({ error: { details: 'Internal failure' } }, { status: 500 }),
  ];
  t.mock.method(globalThis, 'fetch', async () => responses.shift()!);
  for (const status of [503, 401, 403, 500]) {
    await assert.rejects(api('/test'), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, status);
      assert.equal(error.message, 'Request failed.');
      return true;
    });
  }
});

test('API displays server validation errors and rejects malformed successful responses', async (t) => {
  const responses = [
    Response.json({ error: 'Check the recipe title.' }, { status: 400 }),
    new Response('invalid JSON', { status: 200 }),
  ];
  t.mock.method(globalThis, 'fetch', async () => responses.shift()!);
  await assert.rejects(api('/test'), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 400);
    assert.equal(error.message, 'Check the recipe title.');
    return true;
  });
  await assert.rejects(api('/test'), SyntaxError);
});
