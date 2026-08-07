# Local Production Database Copy Design

## Goal

Provide a repeatable, local-only workflow for restoring a full production Neon PostgreSQL snapshot into a disposable Dockerized PostgreSQL instance so production issues can be investigated safely against matching data.

## Scope

- Use PostgreSQL 17 locally to match the installed production client/server expectations.
- Dump the full production database, including customer, creditor, loan, payment, audit, migration, and ledger data.
- Keep the dump and local database state out of git.
- Preserve the production Neon URL as `DATABASE_URL_PROD` and comment out the current production `DATABASE_URL` entry.
- Set local `DATABASE_URL` to the Docker database on `127.0.0.1:55432`.
- Make the refresh process repeatable without modifying production.

## Architecture

`docker/prod-copy/Dockerfile` builds a small PostgreSQL 17 image and installs required local initialization SQL. `docker-compose.prod-copy.yml` runs it with a named volume, a healthcheck, and a non-default host port so it does not collide with another local PostgreSQL instance.

`scripts/refresh-prod-db-copy.sh` is the workflow entry point. It reads `DATABASE_URL_PROD` and local connection settings from `.env`, creates a custom-format dump under an ignored local directory, starts the container, recreates only the local copy database, restores the dump with ownership and privilege remapping, and runs read-only verification queries.

## Data flow

```text
Neon production
    │ pg_dump --format=custom --no-owner --no-privileges
    ▼
docker/prod-copy/dumps/production-latest.dump (gitignored)
    │ pg_restore into freshly recreated local database
    ▼
Docker PostgreSQL on 127.0.0.1:55432
    │
    └── local app DATABASE_URL
```

The refresh script must never run `INSERT`, `UPDATE`, `DELETE`, migration, or restore commands against `DATABASE_URL_PROD`; production is used only as the `pg_dump` source.

## Local environment

The committed repository will not contain credentials or a dump. The existing `.env` is local-only and will retain the production value in a comment, keep `DATABASE_URL_PROD` available for refreshes, and use a separate local username/password/database for `DATABASE_URL`.

The local database password is used only by Docker and the local app. The dump directory, local Compose environment file if created, and any Postgres data directory are ignored by git.

## Refresh and lifecycle commands

- `./scripts/refresh-prod-db-copy.sh` — dump production, start Postgres, recreate the local database, restore, and verify.
- `docker compose -f docker-compose.prod-copy.yml down` — stop the local copy while retaining its named volume.
- `docker compose -f docker-compose.prod-copy.yml down -v` — remove the local copy volume when a clean rebuild is needed.

## Verification

The refresh command will verify:

- PostgreSQL accepts connections on the local URL.
- Core tables such as `loans`, `payments`, `transactions`, `audit_log`, and `drizzle.__drizzle_migrations` exist.
- The restored database has nonzero row counts for representative production tables.
- The target loan from the reported failure is present and active.
- The local database identity is not the Neon production host.

## Safety boundaries

- No production write is performed.
- The dump is full and contains PII, so the workflow documentation will warn against sharing or committing it.
- Database recreation is limited to the Docker copy database named by the local Compose configuration.
- Refreshing the copy intentionally discards local experiments in that database.
