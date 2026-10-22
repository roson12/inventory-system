#!/bin/sh
set -e

echo "[entrypoint] waiting for database..."
ATTEMPTS=0
until node -e "
const { Client } = require('pg');
const c = new Client({ connectionString: process.env.DATABASE_URL });
c.connect().then(() => c.end()).then(() => process.exit(0)).catch(() => process.exit(1));
"; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [ "$ATTEMPTS" -ge 60 ]; then
    echo "[entrypoint] database did not become ready in time" >&2
    exit 1
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
