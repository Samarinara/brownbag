# brownbag

A shared recipe platform at **brownbag.polli.page**. This branch replaces the self-hosted account model with existing AT Protocol accounts, a Neon-backed recipe index, and a serverless-ready web app. This is an initial implementation, not a production launch.

## What works in this slice

- Public discovery and PostgreSQL full-text search; personal, saved, and followed-cook feeds.
- Text-based ingredient and unit autocomplete, case-insensitive exact filters, and indexed ingredient/unit groups with numeric quantity totals.
- Existing-account OAuth, encrypted server-side credentials, durable refresh locks, and cookie sessions. No passwords, email signup, or hosted accounts.
- Private drafts and bookmarks; public recipe publishing, optimistic-concurrency edits/deletes, and attributed adaptations.
- Private Meal Planner: Sunday-first weeks, a mobile day agenda, a month week-picker, multiple recipes per meal, notes, and a cross-device default meal preference. Use the top-bar **Meal Planner** link or **Plan meal** on any recipe.
- Private shopping lists from the Meal Planner: default to today and the next six days, adjust 1–93 days with a slider or number input, combine ingredients across every planned meal, and save purchased checkmarks across devices.
- Public follow records and profile ingestion. The recipe editor uses ordinary cooking language, not protocol jargon.
- Revocable assistant keys, stateless MCP, and mandatory human approval before any agent-proposed publication.
- Filtered Jetstream ingestion with durable cursors, idempotent revision guards, tombstones, invalid-event storage, and bounded account reconciliation.

Meal Planner data lives only in PostgreSQL, scoped to the signed-in account’s DID; it is not published to AT Protocol. Migration `004_meal_planner.sql` adds its tables. Vercel runs pending migrations as part of its build; other deployment targets must run `npm run db:migrate` before starting the new release. Deleting a recipe cascades to every plan referencing it. Recipe notes also appear together in the day view’s meal notes. Publishing from a meal slot adds the recipe and returns to that week; saving a private draft does not add anything. If assignment fails after publication, the editor can retry assignment without publishing another copy.

Plans before the date one calendar month ago are permanently deleted using a UTC date boundary, while future dates have no planning horizon. Cleanup runs on planner reads and hourly in the indexer, including for inactive accounts. Deployments without the indexer should schedule `node dist/prune-meal-plans.js` daily (`npm run planner:prune` in development). Local sample plans are included in the isolated, in-memory preview fixture: after `npm run build`, run `npx tsx tests/support/preview.ts` and open port 3001. The fixture never writes to a real account or database.

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

### Ingredient index

Migration `005_ingredient_index.sql` backfills existing public recipes and maintains a separate `recipe_ingredients` projection through a database trigger. Apply it with `npm run db:migrate` before starting the updated API and indexer (Vercel applies migrations during its build). Published recipe text, drafts, and AT Protocol schemas retain their original format. Comparison keys lowercase names and units, trim surrounding whitespace, and collapse repeated whitespace. `carrots`, `CARROTS`, and `CaRRoTs` share a key; synonyms, singular/plural forms, and unit abbreviations are not merged. The editor offers optional suggestions from visible public recipes and continues to accept arbitrary text, including offline.

- `GET /api/ingredients/suggestions?kind=ingredient&q=car&limit=12` returns `{ suggestions: [{ value, recipeCount }] }`. Use `kind=unit` for units. Queries match literal normalized prefixes; the maximum limit is 50. Hidden recipes, inactive authors, and private drafts do not contribute.
- `GET /api/recipes?ingredient=CARROTS&unit=CUPS` filters by exact normalized ingredient and unit on the same ingredient row, alongside existing search/feed filters. Either filter is optional; `unit=` matches ingredients with no unit.
- `POST /api/ingredients/group` with `{ "uris": ["at://..."] }` groups up to 100 selected public recipes by ingredient and unit. Duplicate URIs do not multiply quantities. Each group includes occurrence/recipe counts, original quantity entries, `knownQuantity`, `totalQuantity`, and `unquantifiedCount`. Hidden, inactive, deleted, and unknown recipes contribute nothing. This read endpoint does not save a shopping list.

The projection stores decimal quantities, fractions (`1/2`), mixed fractions (`1 1/2`), and Unicode fractions (`1½`, `⅜`) as PostgreSQL numeric values for sorting and totals. Zero is valid. Ranges, negative values, prose, and ambiguous comma-separated values remain unquantified. `knownQuantity` sums parsed values; `totalQuantity` is null when any entry in the group is unquantified. Numeric results are returned as decimal strings to preserve database precision. This public grouping endpoint does not convert units: cups and grams stay in separate groups, and an empty unit remains its own group.

The private shopping list at `/meal-planner/shopping-list` uses the projection separately and counts each scheduled occurrence of a recipe, including duplicates. Quantities cover the complete recipe without serving multipliers. Weight units convert to grams and volume units to millilitres, with larger totals displayed as kilograms or litres. Cups, spoons, pints, quarts, gallons and fluid ounces use US customary measures. Empty units and explicit count/each/piece units count individual items; unknown units remain separate. Names match case-insensitively after whitespace normalization; ingredient synonyms and singular/plural names are not inferred. Unknown quantities are shown alongside known subtotals for manual shopping decisions, and rounded displays use `≈`.

Migration `006_shopping_list.sql` adds account-private purchased quantities associated with planned meal dates. Run `npm run db:migrate` before starting the updated API outside Vercel. `GET /api/planner/shopping-list?from=YYYY-MM-DD&days=7` returns the inclusive range, meal count, and combined items. `PUT /api/planner/shopping-list/check` accepts `{ from, days, key, fingerprint, checked }` and returns the updated list; item keys and fingerprints come from the GET response. Purchased quantities are shared across overlapping ranges. Increases appear as a separate unchecked row for the difference; decreases stay checked and retain unused purchase credits until their associated meal date passes. Unchecking a purchased row clears that ingredient's purchase credits in the selected range. Unspecified amounts are tracked by occurrence rather than guessed. Stale check requests return 409. The page advances its start date when the local calendar day changes, removing past meals and their associated purchased quantities. Old purchase records are cleaned up on shopping-list reads using the one-month UTC retention boundary.

## Mobile app

The website supports Home Screen installation on iOS/Android, offline recipe text, and local draft recovery. A small Android TWA project builds with `npm run android:debug` or `npm run android:unsigned`; no cloud build service is required. See [mobile setup and signing](docs/mobile.md) for SDK requirements, domain verification, and offline behavior.

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

1. Create a Neon project and place the API and worker near the database region. Vercel's build runs pending migrations using `DATABASE_URL_UNPOOLED` when configured, otherwise `DATABASE_URL`. Use separate preview database branches and OAuth secrets; never point untrusted previews at production.
2. Configure the variables above in Vercel, with `APP_ORIGIN=https://brownbag.polli.page`, Node 22, and the custom domain. `vercel.json` builds the static client and routes API/OAuth/MCP requests to `api/index.ts`.
3. Make `/oauth-client-metadata.json`, `/jwks.json`, and `/api/auth/callback` publicly reachable. Deployment protection must not block OAuth metadata. Verify callback routing on a real preview before launch.
4. Deploy the same commit as a worker using `npm ci && npm run build`, then `node dist/indexer.js`. The worker needs `DATABASE_URL` and optionally `JETSTREAM_URL`; it does not need OAuth secrets.
5. Smoke-test real sign-in, publish/edit/delete, a second-account follow, and worker restart/replay. These require your deployment/accounts and are not covered by the local mocks.

For a container deployment, build the provided Dockerfile, run `node dist/migrate.js` once with database configuration, then run the app and indexer commands as separate services. `compose.yaml` provides both against the external database. It does not provision Neon or migrate automatically.

## Cost and reliability boundaries

The API uses small reusable connection pools (two connections per warm instance), with prepared statements disabled for pooler compatibility. Database-backed sessions, refresh locks, and rate limits work across instances. The public feed has short caching; private responses are not cacheable.

Neon’s free plan is useful for development, but the worker and queries still consume compute. It ignores unknown account-lifecycle events and checkpoints idle streams sparingly; **busy usage can prevent autosuspend**. The worker host is an additional service and may have its own cost. Watch compute, storage, connections, and egress rather than assuming a permanently free production system.

The [Jetstream feed](https://github.com/bluesky-social/jetstream) is trusted infrastructure, not cryptographic verification of every repository commit. Cursor replay is not a full historical archive guarantee. Account → Refresh cookbook reconciles a bounded stable PDS snapshot (up to 1,000 records); larger backfills, automated gap repair, identity refresh, replay tooling, and operator alerts still need production hardening. Run one indexer initially.

Before opening unrestricted public signup, add reporting/moderation/blocking, retention/cleanup jobs for expired sessions and rate limits, operational recovery for proposals stuck in `applying`, and load/security testing. The `hidden` recipe flag supports operator-side suppression but there is no moderation UI. Recipes support photo upload and display; profile editing is deferred. The dedicated recipe editor reveals optional groups, preparation notes, yields, language, source credits, and photos as needed. Photos are uploaded to the account provider even while the recipe is a private draft. Search uses PostgreSQL full text, not the old fuzzy-search implementation. Social previews and legacy imports are also deferred.

## Verification and legacy code

```sh
npm test
npm run build
npm run format:check
```

New integration tests run PostgreSQL semantics in PGlite and mock remote account writes. They check privacy, owner isolation, stale writes, stream replay, encrypted credentials, and agent approval races. They do not prove Neon networking, production OAuth, or Vercel routing. Existing SQLite tests remain as regression coverage for archived modules; those modules are not mounted by the new server. [Old self-hosting documentation](docs/legacy-self-hosted.md) and the old Compose smoke script are historical only. No old private recipes are automatically made public.

For an explicitly simulated, local-only browser preview after building, run `npx tsx tests/support/preview.ts` and open `http://127.0.0.1:3001`. It uses an in-memory test database, a synthetic account, and mocked publications, binds only to loopback, and is never imported by production code. Do not deploy that fixture.
