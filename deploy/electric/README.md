# Self-hosted ElectricSQL + nginx proxy

This directory contains the production deployment for **our own ElectricSQL instance** and a **caching nginx reverse proxy**, run as a Docker Swarm stack on a single node (`node1`).

We run ElectricSQL ourselves rather than using the hosted ElectricSQL Cloud because:

1. **Cost** — at our scale a tiny Hetzner box is far cheaper.
2. **Logical replication** — Electric needs a direct (non-pooled) connection to Neon Postgres. We control that here.
3. **Caching** — nginx in front does request collapsing across tabs/users; without it, every browser pulls its own copy of each shape.

## What's in here

| File | Purpose |
|---|---|
| `docker-stack.yml` | Two-service swarm stack: `electric` (ElectricSQL) + `nginx` (cache + reverse proxy) |
| `nginx.conf` | nginx config: long-poll-aware caching, gzip, live-bypass, request collapsing |
| `deploy.sh` | Manual deploy script (mostly superseded by CI; useful for local debugging) |
| `.env.example` | Required env vars: `ELECTRIC_DATABASE_URL` (direct Neon URL), `ELECTRIC_SECRET` |

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
browser
   │
   │ HTTPS (Vercel edge)
   ▼
Next.js app (Vercel)
   │
   │ /api/electric/<table>?... (auth check + secret injection)
   │ src/app/api/electric/[...table]/route.ts
   ▼
nginx (node1:3001) ← THIS STACK
   │
   │ proxy_cache + gzip + request-collapsing
   ▼
ElectricSQL (node1, internal docker network)
   │
   │ logical replication
   ▼
Neon Postgres (direct, non-pooled URL)
```

The Next.js proxy authenticates the request (better-auth session cookie), whitelists the table, attaches `ELECTRIC_SECRET`, and forwards to nginx. nginx caches and forwards to Electric. Electric tails Neon's WAL.

## Accessing the host

```bash
ssh node1
```

The user has `node1` configured in `~/.ssh/config` (Hetzner box). Useful one-liners once you're in:

```bash
# Stack health
docker service ls --filter name=electric_

# Live nginx logs
docker service logs -f electric_nginx

# Live Electric logs
docker service logs -f electric_electric

# Active nginx config name (matches the SHA12 prefix of nginx.conf)
docker config ls --filter name=electric_nginx_

# Hit the health endpoint via the proxy
curl -sI http://127.0.0.1:3001/v1/health

# Verify gzip on a shape response
SECRET=$(grep ELECTRIC_SECRET ~/electric-deploy/.env | cut -d= -f2)
curl -sI -H 'Accept-Encoding: gzip' \
  "http://127.0.0.1:3001/v1/shape?table=transactions&offset=-1&secret=$SECRET" \
  | grep -iE 'content-encoding|vary'
```

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
