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

# Warn if pooler URL is being used
if echo "$ELECTRIC_DATABASE_URL" | grep -q "pooler"; then
  echo "WARNING: DATABASE_URL appears to be a pooler URL."
  echo "Electric requires a DIRECT connection for logical replication."
  echo "Remove '-pooler' from the hostname in your Neon connection string."
  exit 1
fi

echo "Deploying ElectricSQL stack..."
docker stack deploy \
  -c "$SCRIPT_DIR/docker-stack.yml" \
  electric \
  --with-registry-auth

echo ""
echo "Waiting for Electric to become healthy..."
for i in $(seq 1 30); do
  STATUS=$(docker service ps electric_electric --format '{{.CurrentState}}' 2>/dev/null | head -1)
  if echo "$STATUS" | grep -q "Running"; then
    echo "Electric is running: $STATUS"
    # Check health endpoint
    sleep 2
    if curl -sf http://127.0.0.1:3001/v1/health > /dev/null 2>&1; then
      echo "Health check passed!"
      curl -s http://127.0.0.1:3001/v1/health | python3 -m json.tool 2>/dev/null || true
      exit 0
    fi
  fi
  echo "  Attempt $i/30: $STATUS"
  sleep 3
done

echo "WARNING: Electric may not be fully healthy yet. Check with:"
echo "  docker service logs electric_electric"
