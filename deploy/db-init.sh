#!/bin/sh
# Cria o role restrito usado pela API (sem bypass de RLS).
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argus_app') THEN
      CREATE ROLE argus_app LOGIN PASSWORD '${APP_DB_PASSWORD:-argus_app}';
    END IF;
  END
  \$\$;
SQL
