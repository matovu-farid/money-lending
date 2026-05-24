# Self-hosted Postgres + ElectricSQL + nginx proxy

This directory contains the production deployment for our **self-hosted Postgres**, **ElectricSQL instance**, and a **caching nginx reverse proxy** — run as a Docker Swarm stack on a single node (`node1`).

We moved off Neon to a Postgres on the same box as Electric because:

1. **Cost** — Neon's compute autosuspend can't kick in while Electric holds a logical replication slot open. That meant the Neon compute ran 24/7 and burned ~110 CU-hrs/month even on a near-idle app.
2. **Latency** — Electric ↔ Postgres now hops over the docker overlay network instead of cross-region TCP, which speeds up WAL streaming and removes a class of timeout failures.
3. **Control** — `wal_level`, `max_replication_slots`, and TLS config are all in this repo.

## What's in here

| File | Purpose |
|---|---|
| `docker-stack.yml` | Three-service swarm stack: `postgres` (data) + `electric` (sync) + `nginx` (cache/proxy) |
| `nginx.conf` | nginx config: long-poll-aware caching, gzip, live-bypass, request collapsing |
| `deploy.sh` | Manual deploy script (mostly superseded by CI; useful for local debugging) |
| `migrate-from-neon.sh` | One-shot `pg_dump | pg_restore` from Neon into the new Postgres |
| `.env.example` | Required env vars: `ELECTRIC_DATABASE_URL`, `ELECTRIC_SECRET`, `PG_PASSWORD` |

## How it gets deployed

Pushing changes under `deploy/electric/**` to `main` triggers `.github/workflows/deploy-electric.yml`, which:

1. Validates `docker-stack.yml` and `nginx.conf` syntactically.
2. SCPs the two files to `node1`.
3. SSHes in and runs `docker stack deploy` with the secrets from GitHub Actions.
4. Smoke-tests `http://127.0.0.1:3001/v1/health` and verifies the response went through nginx (checks `Server: nginx/...`).
5. Cleans up orphaned nginx config versions.

The nginx config is rotated by content hash (`NGINX_CONF_HASH = sha256(nginx.conf) | head -c12`) because swarm configs are immutable — only the *name* can carry new content. Identical content → identical name → no-op deploy.

`docker-stack.yml` itself is referenced by file, so changes to it apply on the next deploy without a name rotation.

## Architecture

```
                                ┌──────────────────────────┐  ┌──────────────────────────┐
                                │ node1 — tier=apps        │  │ node2 — tier=data        │
browser                         │ (swarm manager / leader) │  │ (swarm worker)           │
   │                            │                          │  │                          │
   │ HTTPS                      │  ┌────────────────────┐  │  │  ┌────────────────────┐  │
   ▼                            │  │ nginx (host :3001) │  │  │  │ postgres (:5432)   │  │
Next.js app (Vercel)            │  │  proxy_cache + gz  │  │  │  │  wal_level=logical │  │
   │                            │  └─────────┬──────────┘  │  │  │  TLS, ssl=on       │  │
   │ /api/electric/<table>      │            │ overlay     │  │  │  vol: postgres_data│  │
   ├──────────────────────────► │            ▼             │  │  └─────────▲──────────┘  │
   │                            │  ┌────────────────────┐  │  │            │ overlay     │
   │                            │  │ electric           │  │  │            │             │
   │                            │  │ logical replication├──┼──┼────────────┘             │
   │                            │  └────────────────────┘  │  │                          │
   │                            │                          │  │                          │
   │ DATABASE_URL :5432 TLS                                                              │
   └────────────────────────────►  (ingress mesh — either node IP routes to postgres on node2)
                                │                          │  │                          │
                                └──────────────────────────┘  └──────────────────────────┘
```

The Next.js app has **two** independent connections into the swarm:

- `/api/electric/<table>` → nginx on node1 (`:3001`) → electric on node1 → postgres on node2 (via overlay network). The Vercel route authenticates (better-auth session cookie), whitelists the table, injects `ELECTRIC_SECRET`, and forwards. nginx caches.
- `DATABASE_URL` → postgres on `:5432`. Conventional SQL path used by drizzle, server actions, and migrations.

Electric reaches postgres over the docker overlay network as `postgres:5432`, so its connection string never leaves the swarm.

## Node layout & pinning (multi-node swarm)

Two-node swarm: node1 runs stateless services (electric, nginx) on the manager; node2 holds the database. Nodes are labeled:

| node | label | runs |
|---|---|---|
| node1 (manager) | `tier=apps` | electric, nginx |
| node2 (worker) | `tier=data` | postgres |

Postgres is pinned to `node.labels.tier == data` because its volume is `driver: local` (lives on whichever node the container ran on). If postgres were allowed to schedule freely, a reschedule to the other node would silently start with an empty volume — the old data would be orphaned on the original node. The pin makes the home node stable.

To re-apply the labels (idempotent):

```bash
ssh node1
docker node update --label-add tier=apps ubuntu-4gb-hel1-4
docker node update --label-add tier=data ubuntu-4gb-hel1-6
```

If you ever need to move postgres to a different node, the procedure is:

1. Stop the service (`docker service scale electric_postgres=0`).
2. Copy `/var/lib/docker/volumes/electric_postgres_data/_data/` from old node to new node (rsync over the wire, or restore from a `pg_dump`).
3. Remove the label from the old node and add it to the new node.
4. Scale back up (`docker service scale electric_postgres=1`).

## Connecting from your laptop (psql)

Once deployed, postgres is reachable from anywhere via swarm's ingress mesh. Either node's public IP works — connecting to node1 makes swarm route the TCP to node2 internally:

```bash
psql 'postgresql://money:<PG_PASSWORD>@<node1-ip>:5432/money_lending?sslmode=require'
```

`sslmode=require` enables encryption-in-transit but doesn't verify the cert chain (the cert is self-signed). Use `sslmode=verify-full` only after wiring an actual CA-signed cert.

There is **no nginx in the SQL path**. The existing nginx is HTTP-only (Electric shape responses). A TCP proxy in front of postgres would add a hop without adding security — swarm's ingress mesh already load-balances TCP across nodes, and the encryption + auth is end-to-end between psql and postgres.

## TLS

Postgres has `ssl=on`. The certificate is self-signed and generated on the first container start into `/var/lib/postgresql/data/certs/`, so it survives container restarts (lives in the named volume `postgres_data`). Clients should connect with `sslmode=require`, not `verify-full` — there's no CA chain to verify against. Encryption-in-transit is the goal; identity is established by the password (SCRAM-SHA-256).

To rotate the cert, delete `certs/server.{crt,key}` from inside the running container and restart the service:

```bash
ssh node1
docker exec -it "$(docker ps -q -f name=electric_postgres -n 1)" bash -c 'rm /var/lib/postgresql/data/certs/server.*'
docker service update --force electric_postgres
```

## Migrating from Neon (one-time)

The cutover has minimal downtime if you pause Vercel writes during the dump/restore window. Steps from a fresh checkout:

1. **Add the new GitHub secret.** Generate a strong password and add it as `PG_PASSWORD` in the repo's Actions secrets. The same value will be used by Vercel's `DATABASE_URL`.

2. **Deploy the stack.** Push these changes to `main` (or trigger the workflow manually). This starts the new `postgres` service with an empty `money_lending` DB. Electric is unaffected — it's still pointing at Neon via the existing `ELECTRIC_DATABASE_URL` secret.

3. **Pause writes.** In the Vercel dashboard, enable maintenance mode or just take the deployment offline briefly. Reads against Neon are fine to leave running during the dump.

4. **Run the migration.** From your Mac:

   ```bash
   SOURCE_URL='postgresql://neondb_owner:...@ep-crimson-meadow-abfn36mg.eu-west-2.aws.neon.tech/neondb?sslmode=require' \
   TARGET_URL='postgresql://money:<PG_PASSWORD>@<node1-host>:5432/money_lending?sslmode=require' \
   ./deploy/electric/migrate-from-neon.sh
   ```

   `SOURCE_URL` **must** be the direct (non-pooled) Neon URL — the `-pooler` hostname routes through pgbouncer and breaks `pg_dump`. The script will refuse to run with a pooler URL.

5. **Flip the secrets.**
   - Vercel: update `DATABASE_URL` to the new `postgres://money:...@<node1-host>:5432/money_lending?sslmode=require`.
   - GitHub repo secrets: update `ELECTRIC_DATABASE_URL` to the overlay-network URL `postgres://money:<PG_PASSWORD>@postgres:5432/money_lending?sslmode=require`. Note this uses the *service name* `postgres`, not the public hostname — Electric talks to Postgres over the docker overlay network.

6. **Redeploy Electric.** Manual dispatch on the Deploy ElectricSQL workflow. Electric will create a fresh replication slot on the new DB (the abandoned slot on Neon can be ignored — you'll decommission Neon shortly). Clients re-snapshot any shapes from the new Postgres on next page load.

7. **Resume traffic.** Once `curl https://<your-app>/api/electric/...` returns shapes again, lift maintenance mode.

8. **Decommission Neon.** Once you've watched the new setup for a day or two, delete the Neon project and remove its URL from your secrets store. Bills stop.

## Accessing the host

```bash
ssh node1
```

The user has `node1` configured in `~/.ssh/config` (Hetzner box). Useful one-liners once you're in:

```bash
# Stack health
docker service ls --filter name=electric_

# Live logs
docker service logs -f electric_postgres
docker service logs -f electric_electric
docker service logs -f electric_nginx

# Active nginx config name (matches the SHA12 prefix of nginx.conf)
docker config ls --filter name=electric_nginx_

# Hit the Electric health endpoint via the proxy
curl -sI http://127.0.0.1:3001/v1/health

# Verify gzip on a shape response
SECRET=$(grep ELECTRIC_SECRET ~/electric-deploy/.env | cut -d= -f2)
curl -sI -H 'Accept-Encoding: gzip' \
  "http://127.0.0.1:3001/v1/shape?table=transactions&offset=-1&secret=$SECRET" \
  | grep -iE 'content-encoding|vary'

# Open a psql shell into postgres
docker exec -it "$(docker ps -q -f name=electric_postgres -n 1)" \
  psql -U money -d money_lending

# Confirm logical replication is configured
docker exec -it "$(docker ps -q -f name=electric_postgres -n 1)" \
  psql -U money -d money_lending -c "SHOW wal_level; SELECT * FROM pg_replication_slots;"
```

## Backups (not yet automated)

The `postgres_data` volume on **node2** is the only copy of production data. If node2's disk dies, data is gone — there's no PITR like Neon had. Minimum viable backup until this is wired up:

```bash
# Run from your Mac, schedule via cron or launchd
DUMP=~/backups/money-$(date +%Y%m%d).pgcustom
docker run --rm postgres:17 pg_dump -Fc --no-owner --no-acl \
  "postgresql://money:PASSWORD@node1-host:5432/money_lending?sslmode=require" \
  > "$DUMP"
```

A future iteration should push these to S3/Backblaze on a daily cron.

`~/electric-deploy/` on `node1` holds the deployed copy of `docker-stack.yml` and `nginx.conf` plus a manually-managed `.env` file. The CI workflow overwrites the two stack files on every deploy but does NOT touch `.env` — those secrets are sourced from GitHub Actions secrets at deploy time, not from the on-disk `.env` (the `.env` is for manual `./deploy.sh` runs only).

## Manual rollback

If a deploy goes wrong:

```bash
ssh node1
cd ~/electric-deploy
git -C ~/repo log --oneline -- deploy/electric/nginx.conf  # find a good commit
# … manually edit nginx.conf back to the previous version, or:
docker service update --rollback electric_nginx
docker service update --rollback electric_electric
```

Or just push a revert commit — the CI re-runs the same flow.

## Bandwidth tuning (current state)

The nginx layer compresses JSON shape responses (~75–90% reduction; verified 83% on the `transactions` snapshot). Live long-polls (`?live=true`) bypass the cache entirely (Electric returns `Cache-Control: no-store`) and have empty bodies on timeout, so compression overhead is nil for the chatty path.

If bandwidth becomes an issue again, see the conversation history that produced this README, or look at:

- Number of Electric collections actively mounted per route (`src/collections/`)
- HTTP/2 between Vercel ↔ node1 (currently HTTP/1.1)
- Upstream keepalive between nginx ↔ Electric (currently per-request connect, ~free over loopback)
