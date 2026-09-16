#!/usr/bin/env bash
# Applies the migrations to a throwaway local database and runs the RLS and
# database-function suite against it. Needs a local PostgreSQL 15+ and the
# ability to run psql as a superuser.
#
#   ./supabase/tests/run.sh
#
# Every check prints its expectation next to the result. An ERROR under a
# heading that says "expect ERROR" is a pass.

set -uo pipefail

DB="${SMIF_TEST_DB:-smif_policy_test}"
PSQL_USER="${SMIF_TEST_SUPERUSER:-postgres}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="$HERE/../migrations"

# psql as the superuser. Locally that usually means `su postgres`; if you can
# already reach the cluster as a superuser, set SMIF_TEST_DIRECT=1.
run_psql() {
  if [ "${SMIF_TEST_DIRECT:-0}" = "1" ]; then
    psql "$@"
  else
    su "$PSQL_USER" -c "psql $(printf '%q ' "$@")"
  fi
}

echo "==> Recreating $DB"
run_psql -q -c "drop database if exists $DB" -d postgres
run_psql -q -c "create database $DB" -d postgres

echo "==> Supabase shims"
run_psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/shim.sql" || exit 1

for migration in "$MIGRATIONS"/*.sql; do
  echo "==> $(basename "$migration")"
  run_psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$migration" || exit 1
done

echo "==> Policy suite"
run_psql -q -d "$DB" -f "$HERE/policies.sql"

echo
echo "==> Done. Read the output above: each check states its expectation."
