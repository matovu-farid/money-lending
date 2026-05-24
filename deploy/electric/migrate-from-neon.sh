#!/usr/bin/env bash
# One-shot dump + restore from Neon to the self-hosted Postgres on node1.
# Run from your Mac — uses local Docker so no host Postgres install needed.
#
# Usage:
#   SOURCE_URL='postgresql://neondb_owner:...@ep-crimson-meadow-abfn36mg.eu-west-2.aws.neon.tech/neondb?sslmode=require' \
#   TARGET_URL='postgresql://money:PASSWORD@node1.example.com:5432/money_lending?sslmode=require' \
#   ./migrate-from-neon.sh
#
# Notes:
#   - SOURCE_URL must be the DIRECT (non-pooled) Neon URL. pg_dump against
#     pgbouncer in transaction-pooling mode produces inconsistent dumps.
#   - TARGET_URL points at the new postgres exposed on node1:5432.
#   - Dump file is kept on disk so restore can be re-run without re-dumping.
#   - --no-owner --no-acl strips Neon's `neondb_owner` ownership so objects
#     end up owned by the connecting user on the new DB.
#   - --clean --if-exists drops existing objects in target first. Safe on a
#     fresh DB (everything skipped via IF EXISTS); useful for retries.

set -euo pipefail

: "${SOURCE_URL:?SOURCE_URL is required (direct, non-pooled Neon URL)}"
: "${TARGET_URL:?TARGET_URL is required (postgres URL for the new DB)}"

if echo "$SOURCE_URL" | grep -q "pooler"; then
  echo "ERROR: SOURCE_URL uses a pooler hostname (-pooler). pg_dump needs the"
  echo "       direct (non-pooled) URL — pgbouncer in transaction-pooling mode"
  echo "       will fail or produce inconsistent dumps."
  exit 1
fi

DUMP_FILE="${DUMP_FILE:-/tmp/neon-dump-$(date +%Y%m%d-%H%M%S).pgcustom}"

echo "==> Source: ${SOURCE_URL%%@*}@<redacted>"
echo "==> Target: ${TARGET_URL%%@*}@<redacted>"
echo "==> Dump file: $DUMP_FILE"
echo

if [ -f "$DUMP_FILE" ]; then
  echo "==> Reusing existing dump file ($(du -h "$DUMP_FILE" | cut -f1))"
else
  echo "==> Dumping from Neon (custom format)..."
  # pg_dump writes the custom-format dump to stdout; we capture to a file
  # so a failed restore doesn't force re-dumping (Neon egress isn't free).
  docker run --rm \
    -e PGCONNECT_TIMEOUT=30 \
    postgres:17 \
    pg_dump \
      --format=custom \
      --no-owner \
      --no-acl \
      --verbose \
      "$SOURCE_URL" \
    > "$DUMP_FILE"
  echo "==> Dump complete: $(du -h "$DUMP_FILE" | cut -f1)"
fi

echo
echo "==> Restoring to target..."
# Stream the dump into pg_restore via stdin so we don't have to mount the
# file into the container.
docker run --rm -i \
  -e PGCONNECT_TIMEOUT=30 \
  postgres:17 \
  pg_restore \
    --no-owner \
    --no-acl \
    --clean --if-exists \
    --verbose \
    --dbname="$TARGET_URL" \
  < "$DUMP_FILE"

echo
echo "==> Verifying row counts on target..."
docker run --rm postgres:17 \
  psql "$TARGET_URL" -c "
    SELECT schemaname, relname, n_live_tup
    FROM pg_stat_user_tables
    ORDER BY n_live_tup DESC
    LIMIT 25;
  "

echo
echo "==> SUCCESS."
echo
echo "Next steps:"
echo "  1. Update DATABASE_URL in Vercel (Project Settings → Environment Variables)."
echo "     Set it to: $TARGET_URL"
echo "  2. Update ELECTRIC_DATABASE_URL in GitHub repo secrets to the"
echo "     overlay-network URL (so Electric talks to the local postgres):"
echo "       postgres://money:<PG_PASSWORD>@postgres:5432/money_lending?sslmode=require"
echo "  3. Trigger the Deploy ElectricSQL workflow (manual dispatch or push)."
echo "  4. Once Electric is healthy with the new DB, decommission Neon."
echo
echo "Dump file kept at $DUMP_FILE — delete it once you've confirmed the cutover."
