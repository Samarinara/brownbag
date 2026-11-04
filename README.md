# Brownbag

A Polli cookbook for Expo, React Native, Android, iOS, and web. Recipes, a seven-day meal planner, and a shopping list share a native interface built with `@samarinara/polli-ui` 0.2. Settings live under the account button. Recipe sharing uses the system share sheet and a circular button.

The app uses WorkOS AuthKit and the existing Polli Neon Postgres database through an app-owned API. Database credentials never enter the Expo bundle. The API uses Polli's server transaction helper and Drizzle to store app payloads beside `platform.entities`. Polli owns identity, permissions, revisions, sync events, and account deletion.

## Development

Use Node 24 and npm.

```sh
npm ci
cp .env.example .env
npm start
```

Without a WorkOS client ID, the app works locally. Native data uses SQLite, browser data uses localStorage. Local recipes, meals, and shopping items survive restarts. Recipe drafts save on the device, including operation IDs for retry after a lost response. Export and restore backups in settings. Local data uploads only after choosing **Add this device’s recipes to Polli** while signed in.

For cloud mode, configure the public values in `.env`, follow [Polli setup](docs/polli.md), then start the API separately with `npm run dev:api`. Register the browser redirect and `brownbag://callback` against the same WorkOS client accepted by `api.polli.page`. See [mobile builds](docs/mobile.md) for device API addresses and APKs.

## Verification

```sh
npm run check
npm test
npm run format:check
npm run build
npx expo export --platform android --output-dir dist-android
npm run test:browser
```

Database tests apply Polli's real SQL migrations in PGlite and switch to `polli_app` for writes. They cover account isolation, viewer permissions, stale revisions, retry receipts, sync events, cascading payload deletion, and inactive accounts. HTTP tests check authentication and browser origins. No test connects to production.

The browser suite covers local recipe creation, editing, reload, meal planning, shopping, backup export, settings, and responsive layouts. Android CI prebuilds, compiles a release APK, and uploads it as `brownbag-android-apk`. The Expo template uses a debug signing key for sideload testing. Use your own signing setup for distribution.

## Cutover and limits

This PR replaces the active Vite client, AT Protocol login, separate database, and Android TWA. The previous source and deployment instructions live in `legacy/` for migration and reference. No legacy service, migration, indexer, cron, or workflow runs from the new entry points. Keep the old deployment until the account and data cutover passes your smoke test.

AT Protocol DIDs do not map to WorkOS identities automatically. Export legacy data and review its ownership before importing it into Polli. The rewrite does not publish to the AT Protocol network, follow accounts, upload photos, or expose old MCP endpoints. Existing AT Protocol posts stay in their original repositories. This is a private cookbook cutover, not an automatic migration of social accounts.

Cloud writes require connectivity. Failed saves keep the editor and its local draft. Conflicts never overwrite a newer revision automatically. The first cloud read downloads 100 recent items; Load more fetches another page. Account caches are separate and refresh after identity verification. A cold start still needs an online identity check. This version has no background upload queue or automatic conflict merge. Local mode works fully offline.

The shopping generator snapshots the next seven days. Repeated ingredient lines use whole-recipe multipliers. It does not convert units or adjust existing shopping rows when meals change. Edit or remove those rows explicitly. Ingredient text remains as entered. Unchanged imported quantities and step sections survive recipe edits.

Vendored Polli packages are pinned source snapshots so CI does not need private registry credentials. See [vendor provenance](vendor/README.md). QStash account lifecycle jobs stay in polli-platform; Brownbag content deletes through foreign keys and needs no duplicate cleanup callback.
