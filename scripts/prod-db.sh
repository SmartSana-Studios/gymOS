# Sourced by the production deploy scripts. Runs psql / pg_dump INSIDE the local
# Supabase DB container, because this devcontainer has no host psql/pg_dump and
# the container ships PostgreSQL 17 clients (same major as the hosted project).
#
# Nothing here is deployed or run by sourcing it. Defaults point at the hosted
# project this repo is linked to; every value can be overridden, which is how the
# scripts are rehearsed against the LOCAL database:
#   PROD_HOST=localhost PROD_PORT=5432 PROD_USER=postgres PROD_PASSWORD_FILE=<file> ...
#
# The password never appears on a command line: it is read from a file into an
# exported variable and handed to docker with `-e PGPASSWORD` (no value).
PROD_HOST="${PROD_HOST:-aws-0-eu-west-1.pooler.supabase.com}"
PROD_PORT="${PROD_PORT:-5432}"
PROD_USER="${PROD_USER:-postgres.vfxezibagiznrirdwkwh}"
PROD_DB="${PROD_DB:-postgres}"
PROD_PASSWORD_FILE="${PROD_PASSWORD_FILE:-$HOME/.supabase-db-password}"
PROD_CLIENT_CONTAINER="${PROD_CLIENT_CONTAINER:-supabase_db_gym_os}"

if [ ! -r "$PROD_PASSWORD_FILE" ]; then
  echo "Database password file not found: $PROD_PASSWORD_FILE" >&2
  echo "Create it (chmod 600) with the database password, or set PROD_PASSWORD_FILE." >&2
  exit 1
fi
export PGPASSWORD
PGPASSWORD="$(cat "$PROD_PASSWORD_FILE")"

if ! docker ps --format '{{.Names}}' | grep -qx "$PROD_CLIENT_CONTAINER"; then
  echo "Client container '$PROD_CLIENT_CONTAINER' is not running (start local Supabase, or set PROD_CLIENT_CONTAINER)." >&2
  exit 1
fi

# psql with stdin passed through: prod_psql <<<'select 1'  |  prod_psql -tAc 'select 1'
prod_psql() {
  docker exec -i -e PGPASSWORD "$PROD_CLIENT_CONTAINER" \
    psql -h "$PROD_HOST" -p "$PROD_PORT" -U "$PROD_USER" -d "$PROD_DB" -v ON_ERROR_STOP=1 -q -X "$@"
}

# pg_dump streamed to stdout (redirect it to a file on the host).
prod_pg_dump() {
  docker exec -i -e PGPASSWORD "$PROD_CLIENT_CONTAINER" \
    pg_dump -h "$PROD_HOST" -p "$PROD_PORT" -U "$PROD_USER" -d "$PROD_DB" "$@"
}
