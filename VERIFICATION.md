# Verification — September 10, 2026

## Automated

- TypeScript type checking passes.
- Vite frontend and bundled Node server production build pass.
- Built production server starts successfully and serves `/health`, the HTML page, and compiled JavaScript with production security headers.
- Prettier checks pass.
- Dependency audit reports no known production vulnerabilities.
- Five integration suites pass, covering:
  - Single-use email codes, expiry, guess limits, resend cooldown, cookie flags, and cross-origin rejection.
  - A real MCP SDK client: tool discovery, pending writes, human approval, account isolation, YOLO, stale versions, and key revocation.
  - Fuzzy title/ingredient search, misspelled multi-ingredient queries, title-first ranking, tags, and index invalidation after edits.
  - Proposal ownership, stale approval conflicts, rejection, pending counts, and pagination.
  - Per-user YOLO isolation, duplicate candidates, atomic merging, soft deletion, immutable application-level history, and restoration.

## Collaborative browser

Verified against the running development server at desktop and phone widths:

- Home page and responsive layout; no horizontal overflow at 390px on the home and recipe screens.
- Email-code sign-in using development terminal delivery.
- Manual recipe creation and saved formatted ingredients/instructions.
- Fuzzy live title suggestions and full search on Enter.
- Random selection from the filtered results.
- A real MCP create request appears as a pending proposal; approving it in the review screen makes the recipe visible in the collection.
- Account/API key screen, key revocation, and sign-out.

The shared browser needed the workspace machine's network address rather than its own localhost. `APP_ORIGIN` was set for that development process. The default documented localhost configuration is unchanged. Browser checks used a private `browser-test@example.com` development account; its verification key was revoked and the browser was signed out afterward.

## Not verified here

- Docker runtime: Docker is not installed in this environment. CI includes a Docker image build.
- Actual SMTP provider delivery: tests use a local delivery stub or development console. Configure and verify your mail provider before deployment.
- Production traffic/load, multi-process operation, and hosted billing. This release targets one application process and does not claim cloud-scale validation.
