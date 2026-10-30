#!/usr/bin/env bash
# Disposable local PostgreSQL for the integration tests (no Docker needed).
#
#   test/scripts/local-postgres.sh start   # prints the TEST_DATABASE_URL to export
#   test/scripts/local-postgres.sh stop    # stops the server and deletes its data
#   test/scripts/local-postgres.sh url
#
# Env: TEST_PG_DIR (data dir, default $TMPDIR/evolution-api-test-pg), TEST_PG_PORT (default 55439),
#      PG_BIN (directory with initdb/pg_ctl; default: pg_config --bindir or the newest /usr/lib/postgresql/*/bin).
# When run as root the server runs as the `postgres` user, which must be able to reach TEST_PG_DIR.
#
# Alternative with Docker:
#   docker run --rm -d --name evolution-test-pg -e POSTGRES_PASSWORD=postgres -p 55439:5432 postgres:16
#   export TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55439/postgres
set -euo pipefail

DIR="${TEST_PG_DIR:-${TMPDIR:-/tmp}/evolution-api-test-pg}"
PORT="${TEST_PG_PORT:-55439}"
DB="evolution_test"

if [ -z "${PG_BIN:-}" ]; then
  if command -v pg_config >/dev/null 2>&1 && [ -x "$(pg_config --bindir)/initdb" ]; then
    PG_BIN="$(pg_config --bindir)"
  else
    PG_BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
  fi
fi

if [ ! -x "${PG_BIN:-}/initdb" ]; then
  echo "initdb not found (set PG_BIN). Install PostgreSQL or use the Docker alternative above." >&2
  exit 1
fi

as_owner() {
  if [ "$(id -u)" = "0" ]; then
    runuser -u postgres -- "$@"
  else
    "$@"
  fi
}

url() {
  echo "postgresql://postgres@127.0.0.1:${PORT}/${DB}?schema=public"
}

case "${1:-}" in
  start)
    mkdir -p "$DIR"
    [ "$(id -u)" = "0" ] && chown postgres "$DIR"
    if [ ! -f "$DIR/data/PG_VERSION" ]; then
      as_owner "$PG_BIN/initdb" -D "$DIR/data" -U postgres -A trust --no-sync >"$DIR/initdb.log"
    fi
    if ! as_owner "$PG_BIN/pg_ctl" -D "$DIR/data" status >/dev/null 2>&1; then
      as_owner "$PG_BIN/pg_ctl" -D "$DIR/data" -l "$DIR/server.log" -w \
        -o "-p $PORT -c unix_socket_directories='' -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off" start >/dev/null
    fi
    as_owner "$PG_BIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -tAc \
      "SELECT 1 FROM pg_database WHERE datname='${DB}'" | grep -q 1 ||
      as_owner "$PG_BIN/createdb" -h 127.0.0.1 -p "$PORT" -U postgres "$DB"
    echo "export TEST_DATABASE_URL='$(url)'"
    ;;
  stop)
    if [ -f "$DIR/data/PG_VERSION" ]; then
      as_owner "$PG_BIN/pg_ctl" -D "$DIR/data" -m fast stop >/dev/null 2>&1 || true
    fi
    rm -rf "$DIR"
    echo "stopped"
    ;;
  url)
    url
    ;;
  *)
    echo "usage: $0 start|stop|url" >&2
    exit 1
    ;;
esac
