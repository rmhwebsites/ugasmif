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

# The ballot suite gets its own database, upgraded the way production is:
# migrations up to 0005, a vote already open with plain yes/no ballots, then
# 0006 onward. It checks itself and stops at the first wrong answer.
BALLOT_DB="${DB}_ballots"
echo
echo "==> Ballot suite: recreating $BALLOT_DB"
run_psql -q -c "drop database if exists $BALLOT_DB" -d postgres
run_psql -q -c "create database $BALLOT_DB" -d postgres
run_psql -q -v ON_ERROR_STOP=1 -d "$BALLOT_DB" -f "$HERE/shim.sql" || exit 1
seeded=0
for migration in "$MIGRATIONS"/*.sql; do
  if [ "$seeded" = 0 ] && [[ "$(basename "$migration")" > "0006" ]]; then
    run_psql -q -v ON_ERROR_STOP=1 -d "$BALLOT_DB" -f "$HERE/ballots_before.sql" || exit 1
    seeded=1
  fi
  run_psql -q -v ON_ERROR_STOP=1 -d "$BALLOT_DB" -f "$migration" >/dev/null || exit 1
done
run_psql -q -d "$BALLOT_DB" -f "$HERE/ballots.sql" || { echo "==> Ballot suite FAILED"; exit 1; }

echo
echo "==> Done. Read the policy output above: each check states its expectation."
