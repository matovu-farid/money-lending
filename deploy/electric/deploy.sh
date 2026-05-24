#!/usr/bin/env bash
set -euo pipefail

# Deploy ElectricSQL to Docker Swarm on node1.
# Usage: ./deploy.sh [--env-file .env]
#
# Prerequisites:
#   1. Enable logical replication in Neon Console (Settings → Logical Replication)
#   2. Get the DIRECT (non-pooled) connection URL from Neon Console
#   3. Set ELECTRIC_DATABASE_URL and ELECTRIC_SECRET in .env

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${1:-.env}"

if [ ! -f "$SCRIPT_DIR/$ENV_FILE" ]; then
  echo "Error: $SCRIPT_DIR/$ENV_FILE not found. Copy .env.example to .env and fill in values."
  exit 1
fi

# Source env vars
set -a
source "$SCRIPT_DIR/$ENV_FILE"
set +a

# Validate required vars
if [ -z "${ELECTRIC_DATABASE_URL:-}" ]; then
  echo "Error: ELECTRIC_DATABASE_URL is not set"
  exit 1
fi

if [ -z "${ELECTRIC_SECRET:-}" ]; then
  echo "Error: ELECTRIC_SECRET is not set"
  exit 1
fi

if [ -z "${PG_PASSWORD:-}" ]; then
  echo "Error: PG_PASSWORD is not set (required by the postgres service in the stack)"
  exit 1
fi

# Warn if pooler URL is being used
if echo "$ELECTRIC_DATABASE_URL" | grep -q "pooler"; then
  echo "WARNING: DATABASE_URL appears to be a pooler URL."
  echo "Electric requires a DIRECT connection for logical replication."
  echo "Remove '-pooler' from the hostname in your Neon connection string."
  exit 1
fi

# Hash nginx.conf content so the swarm config name auto-rotates on content
# changes (swarm configs are immutable; only the name can carry new content).
export NGINX_CONF_HASH=$(sha256sum "$SCRIPT_DIR/nginx.conf" | cut -c1-12)
echo "nginx.conf hash: $NGINX_CONF_HASH"

echo "Deploying ElectricSQL stack..."
docker stack deploy \
  -c "$SCRIPT_DIR/docker-stack.yml" \
  electric \
  --with-registry-auth

echo ""
echo "Waiting for Electric + nginx to become healthy..."
for i in $(seq 1 30); do
  ELECTRIC_STATUS=$(docker service ps electric_electric --format '{{.CurrentState}}' 2>/dev/null | head -1)
  NGINX_STATUS=$(docker service ps electric_nginx --format '{{.CurrentState}}' 2>/dev/null | head -1)
  if echo "$ELECTRIC_STATUS" | grep -q "Running" && echo "$NGINX_STATUS" | grep -q "Running"; then
    echo "Electric: $ELECTRIC_STATUS"
    echo "nginx:    $NGINX_STATUS"
    # Health endpoint is served by nginx (cache-bypassed) and proxied to Electric.
    sleep 2
    if curl -sf http://127.0.0.1:3001/v1/health > /dev/null 2>&1; then
      echo "Health check passed (via nginx)!"
      curl -s -D /tmp/electric-headers.txt http://127.0.0.1:3001/v1/health \
        | python3 -m json.tool 2>/dev/null || true
      echo "--- response headers ---"
      cat /tmp/electric-headers.txt
      rm -f /tmp/electric-headers.txt
      exit 0
    fi
  fi
  echo "  Attempt $i/30: electric=$ELECTRIC_STATUS | nginx=$NGINX_STATUS"
  sleep 3
done

echo "WARNING: Stack may not be fully healthy yet. Check with:"
echo "  docker service logs electric_electric"
echo "  docker service logs electric_nginx"
