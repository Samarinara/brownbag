import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import test from 'node:test';
import postgres from 'postgres';
import { createTokenCipher } from '../server/atproto/crypto.js';
import { createOAuthService, OAUTH_SCOPE } from '../server/atproto/oauth.js';

test('OAuth secrets are encrypted, randomized, authenticated, and bound to their row', () => {
  const cipher = createTokenCipher(randomBytes(32).toString('base64'));
  const secret = { refresh_token: 'private-refresh-token', dpopJwk: { d: 'private-key' } };
  const encrypted = cipher.encrypt(secret, 'session:did:plc:alice');
  assert.deepEqual(cipher.decrypt(encrypted, 'session:did:plc:alice'), secret);
  assert.ok(!JSON.stringify(encrypted).includes(secret.refresh_token));
  assert.notDeepEqual(cipher.encrypt(secret, 'session:did:plc:alice'), encrypted);
  assert.throws(() => cipher.decrypt(encrypted, 'session:did:plc:bob'));
  const tampered = Buffer.from(encrypted.data, 'base64');
  tampered[0] ^= 1;
  assert.throws(() =>
    cipher.decrypt({ ...encrypted, data: tampered.toString('base64') }, 'session:did:plc:alice'),
  );
  assert.throws(() =>
    createTokenCipher(randomBytes(32).toString('base64')).decrypt(
      encrypted,
      'session:did:plc:alice',
    ),
  );
  assert.throws(() => createTokenCipher('bad key'));
});

test('local OAuth uses the virtual client and loopback callback', async () => {
  const sql = postgres('postgres://unused:unused@127.0.0.1:1/unused');
  try {
    const oauth = await createOAuthService(
      { appOrigin: 'http://127.0.0.1:3000', encryptionKey: randomBytes(32).toString('base64') },
      sql,
    );
    const clientId = new URL(oauth.clientMetadata.client_id);
    assert.equal(clientId.origin, 'http://localhost');
    assert.equal(clientId.searchParams.get('scope'), OAUTH_SCOPE);
    assert.equal(
      clientId.searchParams.get('redirect_uri'),
      'http://127.0.0.1:3000/api/auth/callback',
    );
    assert.equal(oauth.clientMetadata.token_endpoint_auth_method, 'none');
    assert.deepEqual(oauth.jwks, { keys: [] });
    await assert.rejects(
      createOAuthService(
        {
          appOrigin: 'https://brownbag.polli.page',
          encryptionKey: randomBytes(32).toString('base64'),
        },
        sql,
      ),
      /private ES256/,
    );
  } finally {
    await sql.end();
  }
});

test('production client publishes only the public part of its signing key', async () => {
  const sql = postgres('postgres://unused:unused@127.0.0.1:1/unused');
  try {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = { ...privateKey.export({ format: 'jwk' }), kid: 'test-signing-key', alg: 'ES256' };
    const oauth = await createOAuthService(
      {
        appOrigin: 'https://brownbag.polli.page',
        encryptionKey: randomBytes(32).toString('base64'),
        privateKeyJwk: JSON.stringify(jwk),
      },
      sql,
    );
    assert.equal(
      oauth.clientMetadata.client_id,
      'https://brownbag.polli.page/oauth-client-metadata.json',
    );
    assert.equal(oauth.clientMetadata.token_endpoint_auth_method, 'private_key_jwt');
    assert.equal(oauth.jwks.keys[0].kid, jwk.kid);
    assert.equal((oauth.jwks.keys[0] as { d?: string }).d, undefined);
    assert.ok(!JSON.stringify(oauth.jwks).includes(jwk.d!));
  } finally {
    await sql.end();
  }
});
