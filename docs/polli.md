# Connect Brownbag to Polli

## Database

Use the existing Polli Neon database with the platform migrations already applied. Do not run `legacy/migrations` against it.

1. Create an app migration owner and a separate runtime login. The runtime login must belong to `polli_app` only, must not own platform or Brownbag tables, and must not have superuser or BYPASSRLS privileges. Follow `polli-platform/docs/app-integration.md`.
2. Set `MIGRATION_DATABASE_URL` to the schema owner's direct Neon URL and run `npm run db:migrate`. This creates only the `brownbag` schema, payload table, retry receipts, policies, and grants.
3. Set `DATABASE_URL` on the API to the runtime login's pooled URL. Initialization rejects owner, API, worker, superuser, and BYPASSRLS credentials.
4. Set `POLLI_PLATFORM_URL=https://api.polli.page`. Every request authenticates through Polli's profile API before setting transaction-local identity. Clients cannot select an account ID.

Payloads reference `platform.entities` with `ON DELETE CASCADE`. Recipe entities use type `recipe`; meals and shopping use `brownbag.meal` and `brownbag.shopping`. Selective cleanup must name each desired type. Account deletion removes all owned types. Save receipts disappear with their entity. Delete receipts contain only UUIDs. No external files need cleanup callbacks.

Every app write touches the entity in the same transaction. Platform triggers increment revisions and emit sync events. Edit/delete require the current revision. Operation UUIDs make retries idempotent and reject reuse with changed content. RLS stays active on both schemas.

## WorkOS

Use the same public client ID that Polli accepts. Register the exact Brownbag web origin and redirect URI, plus `brownbag://callback` for native builds. Enable public-client PKCE and Polli's existing Google, Apple, and email sign-in methods. No WorkOS API key belongs in Expo configuration.

Web production builds should set `EXPO_PUBLIC_WORKOS_API_HOSTNAME` to Polli's custom Authentication API domain after DNS and allowed origins are configured. AuthKit then uses refresh cookies. Without it, AuthKit uses development mode with browser storage.

Provider references: https://github.com/workos/expo-authkit-example and https://github.com/workos/authkit-js.

## Existing Vercel deployment

Keep the project root at the repository root. `vercel.json` exports Expo to `dist`, serves a SPA, and routes `/api/*` and `/health` to `api/index.ts`. Builds never migrate a database.

Set these separately for preview and production:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Restricted app login in the Polli database |
| `POLLI_PLATFORM_URL` | Polli API origin |
| `ALLOWED_ORIGINS` | Exact browser origins, comma separated |
| `EXPO_PUBLIC_API_URL` | Brownbag API origin |
| `EXPO_PUBLIC_PLATFORM_URL` | `https://api.polli.page` |
| `EXPO_PUBLIC_WORKOS_CLIENT_ID` | Existing Polli public client ID |
| `EXPO_PUBLIC_REDIRECT_URI` | Exact Brownbag browser URL |
| `EXPO_PUBLIC_WORKOS_API_HOSTNAME` | Verified custom WorkOS Authentication API hostname |

Use an isolated Neon branch and WorkOS test configuration for previews. Add each preview origin explicitly to `ALLOWED_ORIGINS` and WorkOS. The previous default-branch-only deployment restriction is removed so this PR can produce a preview.

Do not copy `MIGRATION_DATABASE_URL` into Expo or runtime settings. Old AT Protocol OAuth secrets, worker settings, and database credentials are unused by this app. Keep them with the old deployment until cutover review. `public/sw.js` retires the old Workbox worker. Existing PWAs may need one reload.

## Cutover smoke test

Sign in on web, import a link, edit the recipe, schedule a meal, generate a shopping list, and check an item. Sign in on the APK with the same account and refresh. Confirm both clients read the same data. Edit the same recipe on both devices and confirm a stale save fails while retaining its draft. Switch accounts and verify that the first account's recipes disappear. Test deletion and selective cleanup in an isolated database.

Preserve a legacy database backup. Transform only records whose owner explicitly selected the destination Polli account into the version-1 backup format exported by this app. Review ownership and attribution before restore. Neither repository has a trusted DID-to-WorkOS mapping, so this PR does not infer one. Social posting, photo uploads, exact shopping unit conversion, and the old agent endpoints remain archived.
