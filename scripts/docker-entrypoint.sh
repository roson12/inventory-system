#!/bin/sh
set -e

if [ -z "${DATABASE_URL}" ]; then
  echo "[entrypoint] DATABASE_URL is not set. Link the PostgreSQL database to this service." >&2
  exit 1
fi

echo "[entrypoint] waiting for database..."
ATTEMPTS=0
while true; do
  if DB_ERROR=$(node -e "
const { Client } = require('pg');
const c = new Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 3000,
});
c.connect()
  .then(() => c.end())
  .then(() => process.exit(0))
  .catch((error) => { console.error(error.message); process.exit(1); });
" 2>&1); then
    echo "[entrypoint] database is ready"
    break
  fi

  ATTEMPTS=$((ATTEMPTS + 1))
  if [ "$ATTEMPTS" -ge 60 ]; then
    echo "[entrypoint] database did not become ready in time" >&2
    echo "[entrypoint] last error: ${DB_ERROR}" >&2
    exit 1
  fi
  # Log the first failure and then every tenth attempt, without flooding logs.
  if [ "$ATTEMPTS" -eq 1 ] || [ $((ATTEMPTS % 10)) -eq 0 ]; then
    echo "[entrypoint] database not ready (attempt ${ATTEMPTS}/60): ${DB_ERROR}" >&2
  fi
  sleep 2
done

echo "[entrypoint] applying Prisma migrations..."
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma

if [ "${SEED_ON_START}" = "true" ]; then
  echo "[entrypoint] seeding database..."
  npm run db:seed --workspace apps/api
fi

echo "[entrypoint] starting API..."
exec "$@"
