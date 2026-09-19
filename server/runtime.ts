import { connectDatabase } from './db.js';
import { createOAuthService } from './atproto/oauth.js';
import { createNetworkApp } from './network-app.js';
import { NetworkStore } from './network-store.js';

export async function initializeApp() {
  const origin = process.env.APP_ORIGIN || 'http://127.0.0.1:3000';
  const missing = [
    'DATABASE_URL',
    'OAUTH_ENCRYPTION_KEY',
    ...(origin.startsWith('https:') ? ['OAUTH_PRIVATE_KEY_JWK'] : []),
  ].filter((key) => !process.env[key]);
  if (missing.length) return createNetworkApp({ origin, missing });
  const { sql, db } = connectDatabase();
  const oauth = await createOAuthService(
    {
      appOrigin: origin,
      encryptionKey: process.env.OAUTH_ENCRYPTION_KEY!,
      privateKeyJwk: process.env.OAUTH_PRIVATE_KEY_JWK,
    },
    sql,
  );
  return createNetworkApp({ origin, store: new NetworkStore(db), oauth });
}
