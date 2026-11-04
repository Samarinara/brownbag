# Database operations and production releases

Vercel builds compile the application without running database migrations. Automatic Git
deployments from `main` are disabled in `vercel.json`; other branches retain preview deployments.
Production releases now use the manually dispatched **Release reviewed production build**
workflow. This intentionally replaces automatic production releases on merge. Existing live
deployments continue serving until a staged release is promoted.

The workflows in this repository do not provision accounts, databases, environments or secrets.
Complete the following setup before merging the deployment change or dispatching a workflow.

## Environment setup

Protect `main` with pull-request review and required CI checks. Create these GitHub environments
with deployment branch restrictions allowing only `main`, required reviewers, and prevention of
self-review where available. Review the exact workflow commit before approving its jobs.

| GitHub environment     | Secrets                                                                                 | Variables                                                  | Purpose                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| `database-preview`     | `DATABASE_URL`, optionally `DATABASE_MAINTENANCE_URL`                                   | None                                                       | Reviewed migrations and manual cleanup of the isolated preview database |
| `database-production`  | `DATABASE_URL`, optionally `DATABASE_MAINTENANCE_URL`                                   | None                                                       | Production migrations and cleanup                                       |
| `production-staging`   | `VERCEL_TOKEN`, `VERCEL_AUTOMATION_BYPASS_SECRET` when deployment protection is enabled | `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `VERCEL_CLI_VERSION` | Build and stage the production deployment; run API smoke checks         |
| `production-promotion` | `VERCEL_TOKEN`                                                                          | Same Vercel variables as staging                           | Separate approval before assigning production domains                   |

`DATABASE_URL` in each database environment must be a direct PostgreSQL connection for the
corresponding target, using a migration role with schema-change permission. These are GitHub
**environment secrets**, never repository-wide database secrets. Keep the maintenance connection
in the separate `DATABASE_MAINTENANCE_URL` secret with the narrower role described below.

Set `VERCEL_CLI_VERSION` to a reviewed exact stable version such as `x.y.z`, not `latest` or a
range. Verify that staging and promotion IDs identify the same intended Vercel team and project.
Provision the Vercel token with the least project/team access available. Secrets belong directly
in GitHub/Vercel secret settings; do not put values in workflow inputs, git, logs, or comments.

In Vercel, scope runtime `DATABASE_URL` and OAuth configuration separately for Production and
Preview. Preview must use a different database or isolated database branch containing only
appropriate test data, with separate credentials. A preview connection must never reach the
production database. Keep `APP_ORIGIN` and the OAuth callback configuration appropriate for each
environment. If previews need additional schema, apply reviewed preview migrations before
testing that feature; builds do not initialize empty databases. Per-PR database provisioning is
an operator responsibility, not implemented by these workflows.

The project remains Git-linked for previews, while `git.deploymentEnabled.main: false` prevents
automatic production deployment. Do not remove that gate while releases depend on this manual
workflow. Avoid alternate production deploy hooks that bypass it. Review any project dashboard
build-command override so it cannot reintroduce migrations in builds.

## Release a reviewed commit

1. Confirm CI is green for the reviewed `main` commit and a recoverable database backup exists.
   Confirm new migrations are compatible with the currently deployed API and worker. Serialize
   releases; do not advance `main` with incompatible schema changes during an active release.
2. Dispatch **Release reviewed production build** with the branch selector set to `main`.
   The workflow uses its immutable dispatch commit (`github.sha`); it accepts no arbitrary
   checkout ref or deployment URL. Approve `database-production` for that commit.
3. The first job installs dependencies, verifies formatting, runs tests, compiles the app, and
   runs the browser suite. Only then does its migration step receive the migration credential.
   Migrations use the existing transactional advisory lock and migration history.
4. Approve `production-staging`. It builds with Production Vercel configuration, then runs
   `vercel deploy --prebuilt --prod --skip-domain`. Existing production domains stay on the
   previous release. `/health` must report a healthy database and `/api/config` must report
   configured database/OAuth services on the staged deployment. Protection bypass credentials,
   when needed, are scoped only to smoke checks. Build outputs and pulled environment files
   are not uploaded as workflow artifacts.
5. Inspect the staged deployment and perform any release-specific checks (sign-in, recipe
   publishing, private planner behavior). Approve `production-promotion` only after they pass.
   This job promotes the exact staged URL from the successful smoke job, without rebuilding.
6. Roll the persistent indexer forward to the same reviewed release using its host's release
   procedure, then verify its cursor/heartbeat. This workflow does not deploy the worker.

The workflows share a per-target concurrency group with maintenance and standalone migrations;
an in-progress database operation is not cancelled by a newer run. Only dispatches from `main`
can execute. Environment protection must also be configured: declaring an environment in YAML
does not create its reviewer or secret policy.

If compilation or browser tests fail, no migration runs. If migration fails, staging is blocked.
If staging or smoke checks fail, the old deployment stays live; compatible schema expansions may
already be present. Repair forward and repeat the release. Application rollback does not undo
database migrations. Never restore a database backup over live user data as an automatic
application rollback.

For a standalone schema operation, dispatch **Apply reviewed database migrations**, choose
`preview` or `production`, and select `main`. It verifies tests/build before applying migrations
using only the selected database environment. It never deploys the application. Use this for
reviewed expansion/backfill operations or initializing an isolated preview database.

## Compatible schema changes

Use expansion, transition, and contraction across separate releases:

- Add nullable columns/tables/indexes first. The currently deployed API and worker must keep
  working after the migration and before the new code is promoted.
- Release code that understands both representations. Backfill in bounded, resumable jobs,
  rather than holding a large transaction inside deployment. Track backfill completion before
  relying on the new representation.
- Remove old columns/constraints only after both API and worker have stopped using them and
  the rollback window is deliberately closed. A destructive contraction is a separately
  reviewed operation, not part of the same release that changes readers.

Migrations are transactional. PostgreSQL operations that require being outside a transaction
(for example concurrent index creation) need a separately reviewed operator procedure; do not
insert them into the transactional runner. Keep migration locks short. The GitHub job timeout
is a final bound, not a substitute for evaluating database locks and migration duration.

## Expired-state maintenance

**Clean expired database state** supports a manual `preview`/`production` target and defaults to
a dry-run. It removes only expired `app_sessions`, `oauth_state`, `oauth_locks`, and `rate_limits`.
It retains OAuth refresh sessions, audit events, indexing failures, private plans, and user data.
Audit and failed-indexing history have no automatic age retention policy; recovery or archival
must be designed before adding one.

Each table is processed oldest-first with at most 500 rows per transaction and 10 batches per
run. Locked rows are skipped, active/renewed rows are protected by row locking and an expiry
recheck, and the PostgreSQL server clock determines expiration. Logs contain only aggregate
counts. `limitReached: true` means the table used its budget and may need another run; `false`
does not guarantee no locked expired rows remain. Later runs are safe and finish remaining work.
A failure rolls back the current batch; earlier batches may already be committed.

The standalone command is `node --import tsx server/maintenance.task.ts` (or the compiled task
entrypoint when included in the worker build). Export a maintenance-only `DATABASE_URL` in the
process environment. Its configuration is:

| Variable                  | Default | Bounds/meaning                                     |
| ------------------------- | ------- | -------------------------------------------------- |
| `MAINTENANCE_DRY_RUN`     | `true`  | Exactly `true` or `false`; dry-run does not delete |
| `MAINTENANCE_BATCH_SIZE`  | `500`   | Integer 1–10,000                                   |
| `MAINTENANCE_MAX_BATCHES` | `10`    | Integer 1–100 per table                            |

The connection uses a 30-second statement timeout, 5-second lock timeout and one connection.
Row budgets bound deletions, not table scans: large tables without expiry indexes may require
index tuning after observing real workload. Dry-run counts are also capped by the row budget.

Daily production cleanup at 04:41 UTC is disabled by default. Enable it only after a successful
manual dry-run and deletion run by setting the **repository variable**
`DATABASE_MAINTENANCE_ENABLED` to exactly `true` and provisioning the protected
`database-production` maintenance secret. Scheduled runs explicitly delete expired rows. The
GitHub environment's approval policy still applies to scheduled jobs; a required reviewer must
approve each scheduled run. Leave the flag unset if unattended scheduling is inappropriate.
Disable that flag to stop scheduled cleanup. Manual runs remain available.

## Credentials and least privilege

Use separate roles/connections rather than sharing a database owner everywhere:

- The migration role owns or can change the schema. Keep it in the protected GitHub database
  environment, not the application's runtime environment.
- The API role needs only the application DML privileges it uses, no schema creation or role
  administration. Explicitly grant new table/sequence privileges as migrations add features.
- The persistent indexer should use its own connection and role. Grant projection/cursor/failure
  and actor DML plus the existing planner-expiration permissions it currently uses. New recovery
  jobs may require additional explicit grants. Avoid private drafts, API keys and OAuth-session
  access unless a particular worker responsibility requires it.
- The maintenance role needs database connection/schema usage, `SELECT` and `DELETE` on the
  four expiry tables, plus `UPDATE` permission required by PostgreSQL `FOR UPDATE`. It needs no
  access to OAuth token values, audit history, recipes, private plans or proposals beyond what
  the column-level grants needed for this query imply. PostgreSQL column grants can further
  limit its `SELECT`/`UPDATE` access to each key and `expires_at`; verify grants on a test
  database before provisioning the production secret.

These are provisioning requirements, not claims that roles already exist. Test the least-
privilege connections against the same queries before enabling jobs. Rotate each connection
independently and avoid exposing runtime or migration credentials to preview builds.

References: [Vercel Git configuration](https://vercel.com/docs/project-configuration/git-configuration),
[production promotion](https://vercel.com/docs/deployments/promoting-a-deployment),
[GitHub workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax).
