# Local Production Database Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a repeatable Dockerized PostgreSQL 17 workflow that restores a full Neon production dump into a local copy and points the local app at that copy.

**Architecture:** A custom PostgreSQL 17 image runs in `docker-compose.prod-copy.yml` on `127.0.0.1:55432` with a named volume. `scripts/refresh-prod-db-copy.sh` obtains a custom-format dump from `DATABASE_URL_PROD`, recreates only the local copy database, restores it with local ownership, and verifies the restored schema/data. The full dump and local credentials remain gitignored.

**Tech Stack:** Dockerfile, Docker Compose, PostgreSQL 17, `pg_dump`, `pg_restore`, `psql`, Bash, Neon PostgreSQL, dotenv-backed `.env` configuration.

---

### Task 1: Add the local PostgreSQL image and Compose service

**Files:**
- Create: `docker/prod-copy/Dockerfile`
- Create: `docker/prod-copy/init/00-local-extensions.sql`
- Create: `docker-compose.prod-copy.yml`
- Modify: `.gitignore`

- [ ] **Step 1: Add the PostgreSQL 17 image definition**

Create `docker/prod-copy/Dockerfile`:

```dockerfile
FROM postgres:17-alpine

COPY init/ /docker-entrypoint-initdb.d/
```

Create `docker/prod-copy/init/00-local-extensions.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

The initialization SQL only prepares a fresh local cluster; the production dump remains the source of schema and data.

- [ ] **Step 2: Add the Compose service**

Create `docker-compose.prod-copy.yml` with a service named `prod-db-copy`:

```yaml
services:
  prod-db-copy:
    build:
      context: ./docker/prod-copy
    environment:
      POSTGRES_DB: ${PROD_COPY_DB_NAME:-money_lending}
      POSTGRES_USER: ${PROD_COPY_DB_USER:-money_lending_local}
      POSTGRES_PASSWORD: ${PROD_COPY_DB_PASSWORD:?Set PROD_COPY_DB_PASSWORD in .env}
    ports:
      - "127.0.0.1:${PROD_COPY_DB_PORT:-55432}:5432"
    volumes:
      - prod-db-copy-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB"]
      interval: 2s
      timeout: 5s
      retries: 30

volumes:
  prod-db-copy-data:
```

Bind only to loopback so the production snapshot is not reachable from the network.

- [ ] **Step 3: Ignore local snapshot artifacts**

Add these entries to `.gitignore`:

```gitignore
# local full production database copy (contains PII)
/docker/prod-copy/dumps/*
!/docker/prod-copy/dumps/.gitkeep
```

Create the empty tracked directory marker with `docker/prod-copy/dumps/.gitkeep`.

- [ ] **Step 4: Validate Compose syntax without starting anything**

Run:

```bash
docker compose -f docker-compose.prod-copy.yml config
```

Expected: valid rendered Compose configuration. If `PROD_COPY_DB_PASSWORD` is not available yet, use a temporary shell value for this validation only; do not commit credentials.

- [ ] **Step 5: Commit the infrastructure files**

```bash
git add docker/prod-copy/Dockerfile docker/prod-copy/init/00-local-extensions.sql docker/prod-copy/dumps/.gitkeep docker-compose.prod-copy.yml .gitignore
git commit -m "chore: add local production db container"
```

### Task 2: Implement the safe dump-and-restore workflow

**Files:**
- Create: `scripts/refresh-prod-db-copy.sh`

- [ ] **Step 1: Create the refresh script with strict safety checks**

The script must:

1. Resolve the repository root from its own location.
2. Load `.env` without printing values.
3. Require `DATABASE_URL_PROD`, `DATABASE_URL`, `PROD_COPY_DB_NAME`, `PROD_COPY_DB_USER`, and `PROD_COPY_DB_PASSWORD`.
4. Refuse to continue if the local `DATABASE_URL` contains `neon.tech`.
5. Refuse to continue if `DATABASE_URL_PROD` does not contain `neon.tech`.
6. Write the dump only to `docker/prod-copy/dumps/production-latest.dump`.
7. Run `pg_dump --format=custom --no-owner --no-privileges --file "$DUMP_PATH" "$DATABASE_URL_PROD"`.
8. Start the Compose service and wait for its health status.
9. Drop and recreate only `$PROD_COPY_DB_NAME` through the local `DATABASE_URL`, never through `DATABASE_URL_PROD`.
10. Restore with `pg_restore --exit-on-error --no-owner --no-privileges --dbname "$DATABASE_URL" "$DUMP_PATH"`.
11. Run verification queries against `DATABASE_URL` only.
12. Print counts and the target loan’s status without printing credentials.

Use `set -Eeuo pipefail`, quote every variable expansion, and use a `trap` to remove any temporary files while retaining the final ignored dump for reuse.

- [ ] **Step 2: Add explicit local-only database recreation**

Use the local URL to execute:

```sql
DROP DATABASE IF EXISTS "money_lending";
CREATE DATABASE "money_lending";
```

The script must derive the database name from `PROD_COPY_DB_NAME` and use `psql` against the local administrative database connection, not a hard-coded production URL. Avoid shell interpolation inside SQL by passing the validated database identifier as a quoted identifier or by using the local Postgres utility commands with separate `-U` and `-d` arguments.

- [ ] **Step 3: Add verification queries**

After restore, verify:

```sql
SELECT current_database(), inet_server_addr(), inet_server_port();

SELECT table_name
FROM information_schema.tables
WHERE (table_schema, table_name) IN (
  ('public', 'loans'),
  ('public', 'payments'),
  ('public', 'transactions'),
  ('public', 'audit_log'),
  ('drizzle', '__drizzle_migrations')
)
ORDER BY table_schema, table_name;

SELECT 'loans' AS table_name, count(*) FROM public.loans
UNION ALL SELECT 'payments', count(*) FROM public.payments
UNION ALL SELECT 'transactions', count(*) FROM public.transactions;

SELECT left(id::text, 8) AS short_id, status
FROM public.loans
WHERE lower(left(id::text, 8)) = lower('29251e01');
```

The script exits nonzero if a required table is missing, any representative count is zero, or the target loan is absent.

- [ ] **Step 4: Make the script executable and run shell syntax checks**

```bash
chmod +x scripts/refresh-prod-db-copy.sh
bash -n scripts/refresh-prod-db-copy.sh
```

Expected: no syntax errors.

- [ ] **Step 5: Commit the refresh workflow**

```bash
git add scripts/refresh-prod-db-copy.sh
git commit -m "chore: automate production db copy refresh"
```

### Task 3: Switch local environment configuration safely and document usage

**Files:**
- Modify: `.env`
- Create: `docs/LOCAL_PRODUCTION_DB_COPY.md`

- [ ] **Step 1: Preserve production and point local app at Docker**

In the local-only `.env`:

- Comment out the existing production `DATABASE_URL` line without deleting its value.
- Preserve `DATABASE_URL_PROD` unchanged for the refresh script.
- Set `DATABASE_URL` to the local `money_lending_local` connection at `127.0.0.1:55432`.
- Add `PROD_COPY_DB_NAME=money_lending`, `PROD_COPY_DB_USER=money_lending_local`, `PROD_COPY_DB_PASSWORD`, and `PROD_COPY_DB_PORT=55432`.

Generate one local-only password and use it consistently in `DATABASE_URL` and `PROD_COPY_DB_PASSWORD`; do not print it or add it to tracked files. Do not copy the production URL into any new variable or documentation block.

- [ ] **Step 2: Document lifecycle, safety, and troubleshooting**

Create `docs/LOCAL_PRODUCTION_DB_COPY.md` covering:

- Docker Desktop prerequisite.
- Full-data/PII warning.
- Initial or repeated refresh command: `./scripts/refresh-prod-db-copy.sh`.
- Local app connection URL and port.
- Stop while retaining data: `docker compose -f docker-compose.prod-copy.yml down`.
- Delete the local copy for a clean rebuild: `docker compose -f docker-compose.prod-copy.yml down -v`.
- Never point a destructive command at `DATABASE_URL_PROD`.
- Refreshing intentionally discards local experiments.
- How to change the local port if `55432` is occupied.

- [ ] **Step 3: Check that tracked files contain no credentials or dump artifacts**

```bash
git status --short
git diff --check
git ls-files docker/prod-copy/dumps
```

Expected: only `.gitkeep` is tracked under the dump directory; `.env` remains ignored.

- [ ] **Step 4: Commit tracked documentation**

```bash
git add docs/LOCAL_PRODUCTION_DB_COPY.md
git commit -m "docs: document local production db copy"
```

### Task 4: Dump Neon, restore Docker, and verify the clone

**Files:**
- Generated local-only: `docker/prod-copy/dumps/production-latest.dump`

- [ ] **Step 1: Confirm Docker and Neon connectivity without modifying either database**

Run:

```bash
docker version
pg_dump --version
psql --version
```

Expected: Docker daemon is reachable and PostgreSQL client tools are installed.

- [ ] **Step 2: Run the refresh script**

```bash
./scripts/refresh-prod-db-copy.sh
```

Expected: the script reports a successful Neon dump, local Postgres health, restore completion, and verification output showing a loopback/local server and the target loan `29251e01` with status `active`.

- [ ] **Step 3: Verify the application’s local connection independently**

Run:

```bash
node --input-type=module -e 'import "dotenv/config"; import postgres from "postgres"; const sql=postgres(process.env.DATABASE_URL); const rows=await sql`select current_database() as database_name, inet_server_port() as port`; console.log(rows); await sql.end();'
```

Expected: database `money_lending` and port `55432`; no Neon hostname.

- [ ] **Step 4: Run repository checks that do not write to production**

```bash
bash -n scripts/refresh-prod-db-copy.sh
git diff --check
```

If Docker is available, also run the project’s relevant local test command against the restored `DATABASE_URL`; do not run migrations or destructive scripts against `DATABASE_URL_PROD`.

- [ ] **Step 5: Report the handoff state**

Report the local Compose service name, port, dump path, verification results, and the exact stop/refresh commands. Do not include database passwords, Neon URLs, customer PII, or dump contents in the report.
