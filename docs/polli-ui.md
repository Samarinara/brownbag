# Brownbag’s Polli UI

Brownbag imports the shared `@samarinara/polli-ui` components and stylesheet. Its adapter in `src/ui.tsx` preserves existing native form submission defaults and layout classes. The Brownbag logo, navigation, routes, recipe flows, planner, shopping list, account controls, and offline behavior remain in the application.

All existing UI controls now use the corresponding published Polli primitives: buttons, fields, labels, checkboxes, dialogs, disclosures (Accordion), collection/view/theme selectors (Tabs), account and planner menus, badges, avatars, loading placeholders, alerts, empty states, recipe surfaces and picker rows. Application adapters preserve form defaults, collapsed field values and validation focus. Recipes, meal boards, shopping rows and the Brownbag logo remain application compositions of these primitives; Polli has no recipe, calendar or editable-combobox component. Ingredient and category autocomplete retain their existing suggestion logic with Polli inputs and disclosure controls.

Polli text fields retain the package's underline focus treatment. Legacy boxed focus outlines and search-container focus rings must not override them.

`src/polli.css` maps the existing CSS aliases onto Polli’s theme tokens. The requested accent `#456342` is olive green, not brown. Polli’s coral, yellow, blue and mint accents remain. Dark mode uses Polli’s dark tokens with a lighter accessible version of the app accent. The root `.dark` class follows the existing light/dark/system preference, including portalled dialogs.

Fonts are self-hosted, with their upstream OFL licenses in `public/fonts/licenses`. Lora covers headings, labels, ingredients, quantities, times and servings. Inter covers navigation and actions. Patrick Hand covers descriptions, instructions, personal notes and most user-entered text. Ingredient and numeric inputs use Lora.

## Public interactive previews

Open `/ui-preview` for all sample screens, or go directly to:

- `/recipe-preview`
- `/editor-preview`
- `/cookbook-preview`
- `/feed-preview`
- `/planner-preview`
- `/shopping-preview`
- `/account-preview`

The aliases enter a `/preview/...` route, where the actual app components run against an in-memory sample API. Navigation stays within the preview namespace. No authentication, database, or account API access is required; changes reset on reload. Direct links into `/preview/...` also work. The production API retains its authentication requirements. To view previews without configuring a backend, run `npx vite --host 0.0.0.0 --port 5173` and open `/ui-preview`.

## Published npm dependency

Brownbag is configured to install `@samarinara/polli-ui` from the public npm registry. `.npmrc` explicitly maps the `@samarinara` scope to `https://registry.npmjs.org`. No GitHub Packages token, `NODE_AUTH_TOKEN`, or package-read Actions secret is needed.

The application installs the published npm package, with an exact version in `package.json` and integrity-pinned registry artifact in `package-lock.json`. `npm run polli:update` installs and pins the latest published version. There is no vendored source archive or source-build fallback. Fresh installs, container builds, and CI use the public registry without package credentials.

## Automatic update PRs

`.github/workflows/polli-ui-update.yml` checks daily and supports manual runs and upstream `polli-ui-released` dispatches. It installs the latest published `@samarinara/polli-ui` package through the configured registry. It never builds a replacement package from source; registry access must be available for the update to succeed. It runs formatting, tests, a production build and browser checks before opening or updating `automation/polli-ui-update`. It does not merge or deploy automatically. The scheduled workflow becomes active when merged into the default branch.

The repository’s GitHub Actions setting for creating pull requests has been enabled. Upstream release dispatches additionally require enrollment and a dispatch credential in Polli UI; daily polling works independently and needs no extra secret. Workflow PRs created with `GITHUB_TOKEN` do not trigger separate PR workflows, so the update workflow runs the full verification itself before opening the PR.
