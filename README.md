# brownbag

A private recipe collection for people and their AI agents. One search box, a random recipe button, and a place to save the keepers.

## Run locally

Requires Node.js 22.12+ and npm. Native SQLite installation may require Python, Make, and a C++ compiler if a prebuilt binary isn't available.

```sh
npm ci
npm run dev
```

Open **http://localhost:3000**. Choose **Sign in**, enter an email, and find the 8-digit code in the server terminal. Development mode does not send mail unless SMTP is configured. There are no shared demo accounts or seeded recipes.

Copy `.env.example` to `.env` to customize settings. Development loads `.env` automatically. Use `APP_ORIGIN` matching the browser URL, including its port.

## Self-host with one container

Configure `.env` with your `APP_ORIGIN`, `SMTP_HOST`, and mail credentials, then run:

```sh
docker compose up -d --build
```

The app, API, MCP server, and SQLite database run in one container. Data lives in the `brownbag-data` volume, mounted at `/data`. The process runs as a non-root user. `/health` checks database availability. Compose binds to localhost by default; put an HTTPS reverse proxy in front for remote access. Set `TRUST_PROXY_HOPS=1` only if exactly one trusted proxy stands between clients and the app. Adapt the port binding for your network if necessary.

Production requires SMTP and never logs login codes. Use port 465 with `SMTP_SECURE=true` for implicit TLS, or your provider's STARTTLS port (usually 587) with `SMTP_SECURE=false`. STARTTLS is required by default; set `SMTP_REQUIRE_TLS=false` only for a trusted local relay without TLS. HTTPS origins enable secure session cookies. All browser API origins must match `APP_ORIGIN`.

### Send sign-in emails

Copy `.env.example` to `.env` and enter your SMTP provider's settings:

```dotenv
SMTP_HOST=smtp.your-provider.example
SMTP_PORT=587
SMTP_SECURE=false
SMTP_REQUIRE_TLS=true
SMTP_USER=your-smtp-username
SMTP_PASSWORD=your-smtp-password
SMTP_FROM="brownbag <login@your-domain.example>"
```

Use a sender address or domain verified with your provider. Some providers require an app password or a dedicated SMTP credential. Set both username and password, or leave both empty for an unauthenticated local relay. Credentials stay on the server.

Run `npm run email:check` from your local checkout to check the SMTP connection, TLS, and authentication without sending a message. This check does not verify sender authorization or inbox delivery. Restart the app after changing settings, then request a sign-in code in the browser to send an actual email. Setting `SMTP_HOST` enables delivery in development too; leaving it empty keeps development codes in the terminal.

The server validates SMTP settings at startup and uses bounded connection and delivery timeouts. If the SMTP server rejects a message or cannot be reached, sign-in returns an error and removes the undelivered code so you can retry immediately. An accepted message may still be filtered or bounced by the recipient's provider; check spam and your SMTP provider's delivery logs if it does not arrive.

Accounts are created after email verification. Each account owns a completely private collection. No instance-wide roles, shared collections, public recipes, or billing are implemented yet.

### Backups

Back up the full `/data` volume while the container is stopped, or use SQLite's online backup API. Do **not** copy only the live `.sqlite` file: committed data can still be in the WAL file. Restore a backup into the same volume while the app is stopped. Keep the entire database: it includes sessions, API key hashes, recipes, proposals, revision history, and audit logs. Treat backups as private data.

## What works

- Email-code accounts: single-use 8-digit codes, 10-minute expiry, five guesses, resend cooldown, request limits, and 30-day HTTP-only sessions.
- Structured ingredients (quantity, unit, name, note) displayed as formatted text; ordered instructions; title, short and long descriptions; tags; servings; prep/cook times; source URL; notes; extensible JSON metadata.
- Live fuzzy title suggestions. Enter searches titles and ingredients, with title matches first. SQLite FTS5 covers token/prefix search; cached, account-scoped Fuse indexes tolerate typos. No ingredient synonym mapping.
- Random selection from the entire private collection on the home page; random selection from current query/tag results on the search page.
- Human recipe creation/editing, cooking checkboxes, version history and restore, soft deletion and recovery.
- Agent changes wait for human review by default. **Per-user YOLO** allows all that user's keys to write immediately. Existing pending proposals still need review.
- Full before/after proposal inspection. Version checks reject stale edits and merges; merge updates and source deletion happen in one transaction.
- Named, revocable API keys, shown once and stored as hashes. Account activity and immutable application-level recipe revisions.

## Connect an MCP client

Sign in → account avatar → **Agents & API keys** → create a named key. Connect to:

```text
POST https://your-brownbag.example/mcp
Authorization: Bearer bb_YOUR_KEY
```

Use **Streamable HTTP**. Example configuration (the exact wrapper varies by client):

```json
{
  "mcpServers": {
    "brownbag": {
      "type": "http",
      "url": "https://your-brownbag.example/mcp",
      "headers": { "Authorization": "Bearer bb_YOUR_KEY" }
    }
  }
}
```

| Tool                 | Purpose                                               |
| -------------------- | ----------------------------------------------------- |
| `search_recipes`     | Paginated fuzzy search; optional tag                  |
| `get_recipe`         | Full content and current version                      |
| `random_recipe`      | Random recipe, optionally filtered                    |
| `create_recipe`      | Create or propose a new recipe                        |
| `update_recipe`      | Replace full recipe content at `baseVersion`          |
| `delete_recipe`      | Soft-delete at `baseVersion`                          |
| `find_duplicates`    | Fuzzy-title candidates with ingredient overlap        |
| `merge_recipes`      | Retain combined target, soft-delete source atomically |
| `list_changes`       | Inspect pending and reviewed proposals                |
| `get_recipe_history` | Read revisions, including deleted recipes             |

Mutations return `{ "status": "pending", "changeId": "…" }` or `{ "status": "applied", "recipe": { ... } }`. Pending does not mean saved. Read a recipe before editing and supply its version. Updates replace content; preserve fields you aren't changing, including metadata. Merges require both recipes' current versions and explicitly combined recipe data. Duplicate detection is advisory and never merges automatically.

API keys cannot approve proposals, change YOLO, manage keys, or sign in to the browser API. Those actions require a human browser session. Recipe content and metadata should be treated as untrusted data by agents.

### Minimal create payload

```json
{
  "recipe": {
    "title": "Lemon pasta",
    "shortDescription": "A bright, quick weeknight dinner.",
    "ingredients": [
      { "quantity": 200, "unit": "g", "ingredient": "spaghetti" },
      { "quantity": 1, "unit": "", "ingredient": "lemon", "note": "zested and juiced" }
    ],
    "steps": [
      { "text": "Cook the spaghetti in salted water." },
      { "text": "Toss with lemon zest, juice, and a little pasta water." }
    ],
    "tags": ["Weeknight"],
    "servings": 2
  }
}
```

## Development and architecture

```sh
npm test
npm run check
npm run build
npm run format:check
```

React + Vite frontend; Express TypeScript server; official MCP TypeScript SDK; Zod contracts; SQLite via better-sqlite3. Both HTTP APIs use the same transactional recipe service. FTS5 is paired with account-scoped fuzzy indexes (up to 100 accounts cached). No external fonts, image services, AI providers, or frontend CDNs are needed.

- `shared/schema.ts`: validated recipe and change contracts
- `server/store.ts`: ownership, schema initialization, search, transactions, review, history
- `server/auth.ts`: verification, sessions, API keys, user settings
- `server/mail.ts`: SMTP configuration and sign-in email delivery
- `server/mcp.ts`: MCP tool definitions
- `server/app.ts`: browser API and request protections
- `src/`: responsive interface
- `tests/`: database behavior and real HTTP/MCP client integration

SQLite uses WAL mode. Schema version 1 is recorded in `migrations`; future schema changes need sequential migrations. Recipe metadata provides an extension point without adding columns for every optional field.

### Deployment scope and next steps

This is a working first version for a single application process. SQLite and in-process rate limits/search caches are deliberately simple; don't point multiple app replicas at the same database. A large hosted service will need a PostgreSQL storage implementation, shared rate limits, load testing, account lifecycle controls, and operational monitoring. These are not claimed to be implemented by this MVP.

"Offline" here means a locally hosted app without required SaaS services. It is **not** an offline browser/PWA with synchronization. Email sign-in needs access to an SMTP server, although existing local sessions and recipe operations don't need an internet connection.

Imports, sharing/social features, favorites, meal planning, shopping lists, and billing are deferred. Duplicate detection currently uses title similarity with ingredient-overlap information, not semantic inference. History and audit events persist indefinitely; the UI displays the latest 200 audit events and up to 500 recent proposals.

Choose a project license before publishing or accepting contributions; no license choice has been assumed for you.
