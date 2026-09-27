#!/bin/sh
# Runs once, when Postgres initializes an empty data volume (compose.production.yaml). The app connects as
# `app`, which owns the database but is not a superuser; the timeouts sit on the role, where they hold for every
# connection, pooled or not (docs/operations.md, "Connection poolers"). The migrator turns them off for itself.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set app_password="$APP_DB_PASSWORD" --set database="$POSTGRES_DB" <<'SQL'
CREATE ROLE app LOGIN PASSWORD :'app_password';
ALTER ROLE app SET statement_timeout = '15s';
ALTER ROLE app SET idle_in_transaction_session_timeout = '30s';
ALTER DATABASE :"database" OWNER TO app;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
SQL
