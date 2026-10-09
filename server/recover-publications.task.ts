// Run this bounded task from a scheduler or operator job; it is not started by the API.
// OAuth sessions must remain restorable, and failed outcomes exit nonzero for monitoring.
import 'dotenv/config';
import { connectDatabase } from './db.js';
import { createOAuthService } from './atproto/oauth.js';
import { NetworkStore } from './network-store.js';
import { Publisher } from './publishing.js';
import { recoverPublications } from './network-mcp.js';

const { sql, db } = connectDatabase();
try {
  const oauth = await createOAuthService(
    {
      appOrigin: process.env.APP_ORIGIN || 'http://127.0.0.1:3000',
      encryptionKey: process.env.OAUTH_ENCRYPTION_KEY!,
      privateKeyJwk: process.env.OAUTH_PRIVATE_KEY_JWK,
    },
    sql,
  );
  const store = new NetworkStore(db);
  const outcomes = await recoverPublications(
    store,
    new Publisher(store, (did) => oauth.agent(did)),
  );
  console.log(JSON.stringify(outcomes));
  if (outcomes.some((outcome) => !outcome.recovered)) process.exitCode = 1;
} finally {
  await sql.end();
}
