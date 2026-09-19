#!/usr/bin/env bash
set -euo pipefail

echo 'This archived SQLite smoke test does not apply to the decentralized branch. See README.md for PostgreSQL setup and verification.' >&2
exit 2

# Uses a disposable project/volume and a configurable localhost port.
engine=${1:?Usage: bash scripts/smoke-compose.sh docker|podman}
case "$engine" in
  docker) compose=(docker compose) ;;
  podman) compose=(podman-compose) ;;
  *) echo "Unsupported engine: $engine" >&2; exit 2 ;;
esac
cd "$(dirname "$0")/.."
compose+=(--env-file /dev/null -f compose.yaml -p "brownbag-smoke-$$")
# Validate production startup without contacting a real SMTP server.
export HOST_PORT=${HOST_PORT:-3000}
export APP_ORIGIN=http://localhost:$HOST_PORT SMTP_HOST=smtp.example.invalid
export SMTP_FROM=brownbag@example.invalid SMTP_PORT=587 SMTP_SECURE=false
export SMTP_REQUIRE_TLS=true SMTP_USER= SMTP_PASSWORD= TRUST_PROXY_HOPS=

cleanup() {
  result=$?
  if [ "$result" -ne 0 ]; then
    "${compose[@]}" logs || true
  fi
  "${compose[@]}" down --volumes
  exit "$result"
}
trap cleanup EXIT

wait_healthy() {
  local container status
  container=$("${compose[@]}" ps -q)
  for ((attempt=0; attempt<60; attempt++)); do
    status=$("$engine" inspect --format '{{.State.Health.Status}}' "$container")
    if [ "$status" = healthy ]; then
      curl --fail --silent --show-error "http://localhost:$HOST_PORT/health"
      return
    fi
    sleep 2
  done
  echo "Container did not become healthy" >&2
  return 1
}

"${compose[@]}" config >/dev/null
"${compose[@]}" up -d --build
wait_healthy
"${compose[@]}" exec -T brownbag node --input-type=module -e '
  import assert from "node:assert/strict";
  import { existsSync } from "node:fs";
  import Database from "better-sqlite3";
  assert.notEqual(process.getuid(), 0, "app must run as non-root");
  assert.ok(existsSync("/data/brownbag.sqlite"), "app database must exist");
  const db = new Database("/data/compose-smoke.sqlite");
  db.exec("CREATE TABLE smoke (value TEXT)");
  db.prepare("INSERT INTO smoke VALUES (?)").run("persisted");
  db.close();
'
"${compose[@]}" down
"${compose[@]}" up -d
wait_healthy
"${compose[@]}" exec -T brownbag node --input-type=module -e '
  import assert from "node:assert/strict";
  import Database from "better-sqlite3";
  const db = new Database("/data/compose-smoke.sqlite", { readonly: true });
  assert.equal(db.prepare("SELECT value FROM smoke").get().value, "persisted");
  db.close();
'
echo "$engine Compose smoke test passed"
