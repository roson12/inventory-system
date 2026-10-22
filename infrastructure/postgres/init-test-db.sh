#!/bin/sh
set -e

if [ "${POSTGRES_DB:-ims}" != "ims_test" ]; then
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    SELECT 'CREATE DATABASE ims_test OWNER ${POSTGRES_USER}'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ims_test')\gexec
EOSQL
fi
