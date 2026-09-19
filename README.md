# brownbag

A shared recipe platform at **brownbag.polli.page**. This branch replaces the self-hosted account model with existing AT Protocol accounts, a Neon-backed recipe index, and a serverless-ready web app. This is an initial implementation, not a production launch.

## What works in this slice

- Public discovery and PostgreSQL full-text search; personal, saved, and followed-cook feeds.
- Existing-account OAuth, encrypted server-side credentials, durable refresh locks, and cookie sessions. No passwords, email signup, or hosted accounts.
- Private drafts and bookmarks; public recipe publishing, optimistic-concurrency edits/deletes, and attributed adaptations.
- Public follow records and profile ingestion. The recipe editor uses ordinary cooking language, not protocol jargon.
- Revocable assistant keys, stateless MCP, and mandatory human approval before any agent-proposed publication.
- Filtered Jetstream ingestion with durable cursors, idempotent revision guards, tombstones, invalid-event storage, and bounded account reconciliation.

## Architecture and storage

The browser calls a same-origin Node API on Vercel. The API authenticates with the cook’s existing account provider and writes public records to their Personal Data Server (PDS). One **Neon PostgreSQL database** stores the queryable public index and private application state. No Redis, second database, or hosted PDS is needed for this slice.

The live indexer is a **separate persistent Node worker**, not a request handler. It subscribes to the three Brownbag collections and uses the same Neon database. Deploy it on a service that supports continuously running processes. Ordinary [Vercel Functions have bounded invocation lifetimes](https://vercel.com/docs/functions/limitations), so this worker is intentionally outside the Vercel function entrypoint.

Public recipe data is portable; private drafts, bookmarks, assistant keys, and review history currently are not. Back up PostgreSQL: rebuilding the public index does not restore private data or credentials. Public records can be copied by others and deletion cannot recall those copies.

### Records

| Collection                    | Key                        | Contents                                                                                                                                                                                                                                                                                     |
| ----------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `page.polli.brownbag.recipe`  | TID                        | Title, summary, story, structured ingredients (string quantity/unit/name/preparation/group), ordered steps and groups, yield, prep/cook minutes, tags, language, source URL/name, image blob references, creation/update times, and optional original recipe URI + CID with adaptation note. |
| `page.polli.brownbag.profile` | `self`                     | Brownbag display name, biography, avatar, and creation/update times; schema and ingestion are included, profile editing is not yet exposed.                                                                                                                                                  |
| `page.polli.brownbag.follow`  | Stable hash in this client | Target account DID and creation time. Other clients may use other valid record keys.                                                                                                                                                                                                         |

Exact field names, limits, and optionality live in [shared/atproto.ts](shared/atproto.ts) and [lexicons](lexicons). Public records reject extra private fields. Drafts permit unfinished content; publishing requires complete valid content. Neither likes, comments, ratings, nor public recipe collections are implemented yet.

Profiles also allow a banner, cuisine and dietary-interest lists, and a website. Before publishing these schemas as a stable ecosystem contract, finalize their versions and configure lexicon authority/discovery for the `page.polli.brownbag` namespace. This repository does not modify your DNS or publish schema records on your behalf.

## Local setup

Requires Node 22.12+ and npm. Legacy SQLite tests still require native build tools if a prebuilt binary is unavailable.

```sh
npm ci
cp .env.example .env
npm run keys:generate
```

Save the generated values privately in `.env`; do not commit or share them. Configure:

- `APP_ORIGIN=http://127.0.0.1:3000` locally. Use this exact browser host, not `localhost`, for OAuth’s loopback callback.
- `DATABASE_URL`: Neon **pooled** connection URL with TLS enabled.
- `DATABASE_URL_UNPOOLED`: direct URL for migrations, if available.
- `OAUTH_ENCRYPTION_KEY`: generated encryption secret; keep stable across deployments.
- `OAUTH_PRIVATE_KEY_JWK`: generated signing key; required for HTTPS deployments and must remain stable.

```sh
npm run db:migrate
npm run dev
# In a second terminal:
npm run indexer
```

Open http://127.0.0.1:3000. Without credentials the app shows a setup screen, not fake recipes or a bypass login. Migrations are explicit and serialized with a PostgreSQL advisory lock; they do not run on every request or during the frontend build.

## Vercel and worker deployment

1. Create a Neon project and run the migration against it. Place the API and worker near the database region. Use separate preview database branches and OAuth secrets; never point untrusted previews at production.
2. Configure the variables above in Vercel, with `APP_ORIGIN=https://brownbag.polli.page`, Node 22, and the custom domain. `vercel.json` builds the static client and routes API/OAuth/MCP requests to `api/index.ts`.
3. Make `/oauth-client-metadata.json`, `/jwks.json`, and `/api/auth/callback` publicly reachable. Deployment protection must not block OAuth metadata. Verify callback routing on a real preview before launch.
4. Deploy the same commit as a worker using `npm ci && npm run build`, then `node dist/indexer.js`. The worker needs `DATABASE_URL` and optionally `JETSTREAM_URL`; it does not need OAuth secrets.
5. Smoke-test real sign-in, publish/edit/delete, a second-account follow, and worker restart/replay. These require your deployment/accounts and are not covered by the local mocks.

For a container deployment, build the provided Dockerfile, run `node dist/migrate.js` once with database configuration, then run the app and indexer commands as separate services. `compose.yaml` provides both against the external database. It does not provision Neon or migrate automatically.

## Cost and reliability boundaries

The API uses small reusable connection pools (two connections per warm instance), with prepared statements disabled for pooler compatibility. Database-backed sessions, refresh locks, and rate limits work across instances. The public feed has short caching; private responses are not cacheable.

Neon’s free plan is useful for development, but the worker and queries still consume compute. It ignores unknown account-lifecycle events and checkpoints idle streams sparingly; **busy usage can prevent autosuspend**. The worker host is an additional service and may have its own cost. Watch compute, storage, connections, and egress rather than assuming a permanently free production system.

The [Jetstream feed](https://github.com/bluesky-social/jetstream) is trusted infrastructure, not cryptographic verification of every repository commit. Cursor replay is not a full historical archive guarantee. Account → Refresh cookbook reconciles a bounded stable PDS snapshot (up to 1,000 records); larger backfills, automated gap repair, identity refresh, replay tooling, and operator alerts still need production hardening. Run one indexer initially.

Before opening unrestricted public signup, add reporting/moderation/blocking, retention/cleanup jobs for expired sessions and rate limits, operational recovery for proposals stuck in `applying`, and load/security testing. The `hidden` recipe flag supports operator-side suppression but there is no moderation UI. Image record support exists, but upload/rendering and profile editing are deferred. Search uses PostgreSQL full text, not the old fuzzy-search implementation. Social previews and legacy imports are also deferred.

## Verification and legacy code

```sh
npm test
npm run build
npm run format:check
```

New integration tests run PostgreSQL semantics in PGlite and mock remote account writes. They check privacy, owner isolation, stale writes, stream replay, encrypted credentials, and agent approval races. They do not prove Neon networking, production OAuth, or Vercel routing. Existing SQLite tests remain as regression coverage for archived modules; those modules are not mounted by the new server. [Old self-hosting documentation](docs/legacy-self-hosted.md) and the old Compose smoke script are historical only. No old private recipes are automatically made public.

For an explicitly simulated, local-only browser preview after building, run `npx tsx tests/support/preview.ts` and open `http://127.0.0.1:3001`. It uses an in-memory test database, a synthetic account, and mocked publications, binds only to loopback, and is never imported by production code. Do not deploy that fixture.
