import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Agent } from '@atproto/api';
import {
  JoseKey,
  NodeOAuthClient,
  type NodeSavedSession,
  type NodeSavedState,
  type RuntimeLock,
} from '@atproto/oauth-client-node';
import type postgres from 'postgres';
import { createTokenCipher, type EncryptedValue } from './crypto.js';

export const OAUTH_SCOPE =
  'atproto repo:page.polli.brownbag.recipe repo:page.polli.brownbag.profile repo:page.polli.brownbag.follow blob:image/*';

export interface OAuthConfig {
  appOrigin: string;
  encryptionKey: string;
  /** JSON private ES256 JWK with a stable kid, required outside local development. */
  privateKeyJwk?: string;
}

export async function createOAuthService(config: OAuthConfig, sql: postgres.Sql) {
  const cipher = createTokenCipher(config.encryptionKey);
  const origin = new URL(config.appOrigin);
  if (origin.origin !== config.appOrigin || origin.username || origin.password) {
    throw new Error('APP_ORIGIN must be an origin without a path or trailing slash');
  }
  const local = origin.protocol === 'http:' && origin.hostname === '127.0.0.1';
  if (!local && origin.protocol !== 'https:') {
    throw new Error('APP_ORIGIN must use HTTPS, or http://127.0.0.1 for local OAuth');
  }
  const callbackUri = `${origin.origin}/api/auth/callback`;
  const key =
    !local && config.privateKeyJwk ? await JoseKey.fromImportable(config.privateKeyJwk) : undefined;
  if (!local && (!key?.isPrivate || !key.kid || !key.algorithms.includes('ES256'))) {
    throw new Error('OAUTH_PRIVATE_KEY_JWK must contain a private ES256 signing key with kid');
  }

  // AsyncLocalStorage ties session writes to the lock that authorized them. A
  // delayed worker cannot overwrite credentials after another worker takes over.
  const locks = new AsyncLocalStorage<{ key: string; owner: string }>();
  const requestLock: RuntimeLock = async (lockKey, fn) => {
    const owner = randomUUID();
    const deadline = Date.now() + 10_000;
    while (true) {
      const claimed = await sql`
        INSERT INTO oauth_locks (key, owner, expires_at)
        VALUES (${lockKey}, ${owner}, now() + interval '2 minutes')
        ON CONFLICT (key) DO UPDATE SET owner = EXCLUDED.owner, expires_at = EXCLUDED.expires_at
        WHERE oauth_locks.expires_at < now() RETURNING key`;
      if (claimed.length) break;
      if (Date.now() >= deadline) throw new Error('OAuth session is busy; please retry');
      await delay(100 + Math.random() * 100);
    }
    try {
      return await locks.run({ key: lockKey, owner }, fn);
    } finally {
      await sql`DELETE FROM oauth_locks WHERE key = ${lockKey} AND owner = ${owner}`;
    }
  };

  const client = new NodeOAuthClient({
    clientMetadata: {
      client_id: local
        ? `http://localhost?${new URLSearchParams({ redirect_uri: callbackUri, scope: OAUTH_SCOPE })}`
        : `${origin.origin}/oauth-client-metadata.json`,
      client_name: 'Brownbag',
      ...(local ? {} : { client_uri: origin.origin }),
      redirect_uris: [callbackUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      application_type: local ? 'native' : 'web',
      token_endpoint_auth_method: local ? 'none' : 'private_key_jwt',
      ...(local
        ? {}
        : { token_endpoint_auth_signing_alg: 'ES256', jwks_uri: `${origin.origin}/jwks.json` }),
      dpop_bound_access_tokens: true,
      scope: OAUTH_SCOPE,
    },
    keyset: key ? [key] : undefined,
    requestLock,
    stateStore: {
      async set(id, value) {
        await sql`INSERT INTO oauth_state (key, value, expires_at)
          VALUES (${id}, ${sql.json(cipher.encrypt(value, `state:${id}`))}, now() + interval '15 minutes')
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at`;
      },
      async get(id) {
        const [row] =
          await sql`SELECT value FROM oauth_state WHERE key = ${id} AND expires_at > now()`;
        return row
          ? cipher.decrypt<NodeSavedState>(row.value as EncryptedValue, `state:${id}`)
          : undefined;
      },
      async del(id) {
        await sql`DELETE FROM oauth_state WHERE key = ${id}`;
      },
    },
    sessionStore: {
      async set(id, value) {
        await sql.begin(async (tx) => {
          const lease = locks.getStore();
          if (lease) {
            const owned = await tx`SELECT key FROM oauth_locks WHERE key = ${lease.key}
              AND owner = ${lease.owner} AND expires_at > now() FOR UPDATE`;
            if (!owned.length) throw new Error('OAuth refresh lock expired; retry sign-in');
          }
          await tx`INSERT INTO oauth_sessions (key, value) VALUES (${id}, ${tx.json(cipher.encrypt(value, `session:${id}`))})
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
        });
      },
      async get(id) {
        const [row] = await sql`SELECT value FROM oauth_sessions WHERE key = ${id}`;
        return row
          ? cipher.decrypt<NodeSavedSession>(row.value as EncryptedValue, `session:${id}`)
          : undefined;
      },
      async del(id) {
        await sql.begin(async (tx) => {
          const lease = locks.getStore();
          if (lease) {
            const owned = await tx`SELECT key FROM oauth_locks WHERE key = ${lease.key}
              AND owner = ${lease.owner} AND expires_at > now() FOR UPDATE`;
            if (!owned.length) throw new Error('OAuth refresh lock expired; retry sign-in');
          }
          await tx`DELETE FROM oauth_sessions WHERE key = ${id}`;
        });
      },
    },
  });

  return {
    clientMetadata: client.clientMetadata,
    jwks: client.jwks,
    authorize(handle: string, state?: string) {
      return client.authorize(handle.trim().replace(/^@/, ''), { scope: OAUTH_SCOPE, state });
    },
    callback(params: URLSearchParams) {
      return client.callback(params);
    },
    restore(did: string) {
      return client.restore(did);
    },
    async agent(did: string) {
      return new Agent(await client.restore(did));
    },
    /** SDK verifies that the DID's advertised handle resolves back to that DID. */
    identity(did: string) {
      return client.identityResolver.resolve(did);
    },
    revoke(did: string) {
      return client.revoke(did);
    },
  };
}

export type OAuthService = Awaited<ReturnType<typeof createOAuthService>>;
