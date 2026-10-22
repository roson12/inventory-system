#!/usr/bin/env bash
# Starts the full stack, applies pending migrations, prints access URLs,
# and stops the services when this script is interrupted (Ctrl+C).
set -euo pipefail

cd "$(dirname "$0")"

COMPOSE="docker compose"
WEB_PORT="${WEB_PORT:-8080}"
API_PORT="${API_PORT:-4000}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required but was not found in PATH." >&2
  exit 1
fi

if [ ! -f .env ]; then
  echo "No .env found; creating one from .env.example."
  cp .env.example .env
  if command -v openssl >/dev/null 2>&1; then
    SECRET="$(openssl rand -hex 48)"
    # Portable in-place edit without assuming GNU sed.
    awk -v secret="$SECRET" '{ sub(/^SESSION_SECRET=.*/, "SESSION_SECRET=" secret); print }' .env > .env.tmp
    mv .env.tmp .env
  fi
  echo "Review .env before using this in production (database password, Super Admin bootstrap)."
fi

cleanup() {
  echo
  echo "Stopping services..."
  $COMPOSE stop
  echo "Services stopped. Data volumes are preserved."
}
trap cleanup INT TERM

echo "Building and starting containers..."
$COMPOSE up -d --build

echo "Waiting for the API health check..."
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${WEB_PORT}/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

if ! curl -fsS "http://127.0.0.1:${WEB_PORT}/api/health" >/dev/null 2>&1; then
  echo "API did not become healthy. Recent logs:" >&2
  $COMPOSE logs api --tail=80 >&2
  $COMPOSE stop >/dev/null
  exit 1
fi

echo "Applying pending Prisma migrations..."
$COMPOSE exec -T api npx prisma migrate deploy --schema apps/api/prisma/schema.prisma

$COMPOSE ps

cat <<EOF

Inventory Management System is running.

  Web application : http://localhost:${WEB_PORT}
  API health      : http://localhost:${WEB_PORT}/api/health
  API docs        : http://localhost:${WEB_PORT}/api/docs
  API (dev port)  : http://localhost:${API_PORT} (only with compose.dev.yaml)

Create the initial Super Admin once (prompts for the password):
  docker compose exec -it api node apps/api/dist/scripts/create-super-admin.js \\
    --email you@example.com --name "Super Admin"

Demo accounts (only after seeding):
  Admin       : admin@example.com / Admin123!Pass
  Staff       : staff@example.com / Staff123!Pass
  Customer    : customer@example.com / Customer123!Pass

Seed data is applied only when SEED_ON_START=true or by running:
  docker compose exec api npm run db:seed --workspace apps/api

Press Ctrl+C to stop all services.
EOF

$COMPOSE logs -f
