#!/usr/bin/env bash
# Runs a command against a throwaway Neon branch of `main`, then deletes the branch.
#
#   bash scripts/with-neon-branch.sh pnpm test:integration
#   bash scripts/with-neon-branch.sh pnpm db:check-rls
#
# 1. creates branch it-<epoch> from main (inherits main's schema and migration table);
# 2. applies pending migrations to it with `pnpm db:migrate`;
# 3. gives paranaga_app and paranaga_import random passwords ON THE BRANCH ONLY
#    (migrations keep both roles NOLOGIN);
# 4. runs the command with TEST_OWNER_DATABASE_URL, TEST_APP_DATABASE_URL (pooled),
#    TEST_IMPORT_DATABASE_URL, and DATABASE_URL_UNPOOLED / DATABASE_URL /
#    PARANAGA_DATABASE_URL all pointing at the branch, so nothing reaches main
#    (environment variables take precedence over .env.local in `tsx --env-file`);
# 5. always deletes the branch (trap EXIT).
#
# Connection strings and passwords live only in shell variables; every line of output
# passes through a filter that redacts postgres URLs.
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: bash scripts/with-neon-branch.sh <command> [args...]" >&2
  exit 2
fi

PROJECT="${NEON_PROJECT_ID:-green-field-06467324}"
PARENT="main"
BRANCH="it-$(date +%s)"
NEON=(npx --yes neonctl@8.4.4)
cd "$(dirname "$0")/.."

redact() { sed -E 's#postgres(ql)?://[^[:space:]]+#<redacted-url>#g'; }

created=0
cleanup() {
  if [ "$created" = 1 ]; then
    if "${NEON[@]}" branches delete "$BRANCH" --project-id "$PROJECT" >/dev/null 2>&1; then
      echo "deleted branch $BRANCH"
    else
      echo "WARNING: could not delete branch $BRANCH; delete it manually" >&2
    fi
  fi
}
trap cleanup EXIT

"${NEON[@]}" branches create --project-id "$PROJECT" --name "$BRANCH" --parent "$PARENT" --output json >/dev/null
created=1
echo "created branch $BRANCH from $PARENT"

OWNER_URL=$("${NEON[@]}" connection-string "$BRANCH" --project-id "$PROJECT" \
  --database-name neondb --role-name neondb_owner 2>/dev/null)
case "$OWNER_URL" in
  postgres://*|postgresql://*) ;;
  *) echo "could not get the branch connection string" >&2; exit 1 ;;
esac

set +e
DATABASE_URL_UNPOOLED="$OWNER_URL" pnpm --silent db:migrate 2>&1 | redact
status=${PIPESTATUS[0]}
set -e
[ "$status" = 0 ] || { echo "migration failed on $BRANCH" >&2; exit "$status"; }

APP_PW=$(node -e "process.stdout.write(require('crypto').randomBytes(24).toString('hex'))")
IMPORT_PW=$(node -e "process.stdout.write(require('crypto').randomBytes(24).toString('hex'))")

OWNER_URL="$OWNER_URL" APP_PW="$APP_PW" IMPORT_PW="$IMPORT_PW" NODE_NO_WARNINGS=1 node -e "
const pg = require('pg');
(async () => {
  const c = new pg.Client({ connectionString: process.env.OWNER_URL });
  await c.connect();
  const lit = (s) => \"'\" + s.replace(/'/g, \"''\") + \"'\";
  await c.query('alter role paranaga_app with login password ' + lit(process.env.APP_PW));
  await c.query('alter role paranaga_import with login password ' + lit(process.env.IMPORT_PW));
  await c.end();
  console.log('paranaga_app and paranaga_import can log in on the test branch');
})().catch((e) => { console.error('role setup failed: ' + e.message); process.exit(1); });
" 2>&1 | redact

role_url() { # role password pooled(0|1)
  OWNER_URL="$OWNER_URL" R="$1" P="$2" POOLED="$3" node -e "
const u = new URL(process.env.OWNER_URL);
u.username = process.env.R; u.password = process.env.P;
if (process.env.POOLED === '1') u.hostname = u.hostname.replace(/^([^.]+)/, '\$1-pooler');
process.stdout.write(u.toString());"
}
APP_URL=$(role_url paranaga_app "$APP_PW" 1)
IMPORT_URL=$(role_url paranaga_import "$IMPORT_PW" 0)

set +e
TEST_OWNER_DATABASE_URL="$OWNER_URL" \
TEST_APP_DATABASE_URL="$APP_URL" \
TEST_IMPORT_DATABASE_URL="$IMPORT_URL" \
DATABASE_URL_UNPOOLED="$OWNER_URL" \
DATABASE_URL="$OWNER_URL" \
PARANAGA_DATABASE_URL="$APP_URL" \
NODE_NO_WARNINGS=1 \
  "$@" 2>&1 | redact
status=${PIPESTATUS[0]}
set -e
exit "$status"
