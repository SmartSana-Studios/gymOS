#!/usr/bin/env bash
# Story 24.12: the whole landing-page gate against the LOCAL stack, in one command.
#
#   bash scripts/landing-gate/run-local.sh              # check-http, lcp, load; prints a summary; exit 0 when http and load pass and lcp ran. The LCP
#                                                       # baseline is RECORDED, not enforced (the 3 s target is an [ASSUMPTION]): over target still exits 0
#                                                       # and the summary says "OVER TARGET (recorded, not enforced)"; GATE_LCP_ENFORCE=1 makes it fail
#   bash scripts/landing-gate/run-local.sh http lcp     # a subset (names: http lcp load)
#   bash scripts/landing-gate/run-local.sh serve        # fixtures and servers only, until Ctrl-C (to try a page by hand, e.g. http://gate-grace.localhost:3200/)
#
# What it does: seeds five throwaway gyms (published, unpublished, taken down, suspended, renamed) and one core-product probe gym into the
# local database, starts a stand-in for the storage origin, the landing server (`next start`; the landing app is built here every run) and the dashboard
# (probe target), runs the checks, and ALWAYS removes the fixtures and stops the servers again (a leftover published page would fail the
# reader privilege suite). Needs the local Supabase stack, Chromium (`npx playwright install chromium`), Node 22 and the workspace installed.
#
# Staging is NOT this script: staging pages come from the owner. See scripts/landing-gate/README.md (BASE_URL, ROOT_DOMAIN, GATE_*).
#
# Environment: GATE_LANDING_PORT (3200), GATE_DASHBOARD_PORT (3101), GATE_MEDIA_PORT (3911), GATE_LCP_RUNS (20), GATE_LOAD_*, GATE_REBUILD=1
# (rebuild the dashboard even when a build exists; the landing app is always rebuilt), GATE_RESULTS_DIR (default $TMPDIR/landing-gate-results).
set -uo pipefail
cd "$(dirname "$0")/../.."
ROOT=$PWD
GATE="$ROOT/scripts/landing-gate"
SUPABASE="$ROOT/node_modules/.bin/supabase"
LANDING_PORT=${GATE_LANDING_PORT:-3200}
DASH_PORT=${GATE_DASHBOARD_PORT:-3101}
MEDIA_PORT=${GATE_MEDIA_PORT:-3911}
RESULTS=${GATE_RESULTS_DIR:-${TMPDIR:-/tmp}/landing-gate-results}
READER_PASSWORD=${GATE_READER_PASSWORD:-gate-reader-local-only}
mkdir -p "$RESULTS"

WANT=("$@"); [ ${#WANT[@]} -gt 0 ] || WANT=(http lcp load)
for w in "${WANT[@]}"; do case "$w" in http|lcp|load|serve) ;; *) echo "run-local: unknown check $w (http lcp load serve)" >&2; exit 2;; esac; done
want() { local w; for w in "${WANT[@]}"; do [ "$w" = "$1" ] && return 0; done; return 1; }

pids=()
cleanup() {
  local rc=$?
  trap - EXIT INT TERM
  for p in "${pids[@]:-}"; do [ -n "$p" ] && kill -- "-$p" 2>/dev/null; done
  node "$GATE/seed.mjs" down >/dev/null 2>&1 || echo "WARNING: could not remove the gate fixtures; run: node scripts/landing-gate/seed.mjs down" >&2
  if [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
    node "$GATE/core-fixture.mjs" down >/dev/null 2>&1 || echo "WARNING: could not remove the core probe fixture; run: node scripts/landing-gate/core-fixture.mjs down" >&2
  fi
  exit $rc
}
trap cleanup EXIT INT TERM

docker ps --format '{{.Names}}' | grep -qx supabase_db_gym_os || { echo "run-local: the local Supabase stack is not running (supabase start)" >&2; exit 2; }
eval "$("$SUPABASE" status -o env 2>/dev/null)" || exit 2
: "${API_URL:?supabase status did not export API_URL}"
export SUPABASE_API_URL=$API_URL SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
export GATE_ADMIN_DB_URL=${GATE_ADMIN_DB_URL:-$DB_URL}
export GATE_READER_PASSWORD=$READER_PASSWORD

start() { # start <name> <command...>   (own process group, so the whole tree can be stopped)
  local name=$1; shift
  setsid "$@" >"$RESULTS/$name.log" 2>&1 &
  pids+=($!)
}
wait_for() { # wait_for <url> <seconds> [host header]
  local i
  for ((i = 0; i < $2; i++)); do
    if [ -n "${3:-}" ]; then curl -s --max-time 5 -o /dev/null -H "Host: $3" "$1" && return 0; else curl -s --max-time 5 -o /dev/null "$1" && return 0; fi
    sleep 1
  done
  return 1
}

# a server left over from an earlier run would answer in place of the one started here (and hide that this one failed to bind)
for port in "$LANDING_PORT" "$MEDIA_PORT" $(want load && echo "$DASH_PORT"); do
  if [ -n "$(ss -ltnH "sport = :$port" 2>/dev/null)" ]; then echo "run-local: port $port is already in use (a server from an earlier run?); stop it first" >&2; trap - EXIT INT TERM; exit 2; fi
done

echo "run-local: fixtures"
node "$GATE/seed.mjs" down >/dev/null 2>&1
node "$GATE/seed.mjs" up || exit 1
if want load; then
  node "$GATE/core-fixture.mjs" up >"$RESULTS/core.env" || { echo "run-local: could not create the core probe fixture" >&2; exit 1; }
  # shellcheck disable=SC1091
  . "$RESULTS/core.env"
  export GATE_CORE_ANON_KEY=$PUBLISHABLE_KEY GATE_CORE_DASHBOARD_URL=http://127.0.0.1:$DASH_PORT
fi

echo "run-local: servers"
start media node "$GATE/lib/media-stub.mjs" "$MEDIA_PORT"
export GATE_MEDIA_ORIGIN=http://127.0.0.1:$MEDIA_PORT

# always built (about 10 s): a stale build would measure code that is no longer in the tree
echo "run-local: building apps/landing"
(cd apps/landing && pnpm build >"$RESULTS/landing-build.log" 2>&1) || { echo "run-local: landing build failed, see $RESULTS/landing-build.log" >&2; exit 1; }
# exec, so the recorded PID is the server's own (and, via setsid, its process group): cleanup stops exactly this tree
(
  cd apps/landing || exit 1
  export PUBLIC_SITE_ROOT_DOMAIN=localhost PUBLIC_SITE_MEDIA_ORIGIN=$GATE_MEDIA_ORIGIN PUBLIC_SITE_REPORT_KEY=gate-report-key-0123456789
  export PUBLIC_SITE_READER_HOST=127.0.0.1 PUBLIC_SITE_READER_PORT=54322 PUBLIC_SITE_READER_DATABASE=postgres
  export PUBLIC_SITE_READER_USER=public_site_reader PUBLIC_SITE_READER_PASSWORD=$READER_PASSWORD
  exec setsid ./node_modules/.bin/next start --port "$LANDING_PORT" >"$RESULTS/landing.log" 2>&1
) &
pids+=($!)

if want load; then
  if [ ! -f apps/dashboard/.next/BUILD_ID ] || [ "${GATE_REBUILD:-}" = 1 ]; then
    echo "run-local: building apps/dashboard"
    (cd apps/dashboard && NEXT_PUBLIC_SUPABASE_URL=$API_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$PUBLISHABLE_KEY pnpm build >"$RESULTS/dashboard-build.log" 2>&1) || { echo "run-local: dashboard build failed, see $RESULTS/dashboard-build.log" >&2; exit 1; }
  fi
  (cd apps/dashboard || exit 1; exec setsid ./node_modules/.bin/next start --port "$DASH_PORT" >"$RESULTS/dashboard.log" 2>&1) &
  pids+=($!)
fi

wait_for "http://127.0.0.1:$MEDIA_PORT/" 20 || { echo "run-local: the media stub did not start; see $RESULTS/media.log" >&2; exit 1; }
wait_for "http://127.0.0.1:$LANDING_PORT/" 60 gate-grace.localhost || { echo "run-local: the landing server did not start; see $RESULTS/landing.log" >&2; exit 1; }
if want load; then wait_for "http://127.0.0.1:$DASH_PORT/auth/login" 90 || { echo "run-local: the dashboard did not start; see $RESULTS/dashboard.log" >&2; exit 1; }; fi

if want serve; then
  echo "run-local: serving. Pages: http://gate-grace.localhost:$LANDING_PORT/ (published), gate-draft, gate-down, gate-paused, gate-grace-old (301). Ctrl-C to stop and remove the fixtures."
  while true; do sleep 3600 & wait $!; done
fi

export BASE_URL=http://127.0.0.1:$LANDING_PORT ROOT_DOMAIN=localhost GATE_ENV_LABEL="lab, local"
declare -A RES
fail=0
for check in http lcp load; do
  want "$check" || continue
  script="$GATE/check-http.mjs"; [ "$check" = lcp ] && script="$GATE/lcp.mjs"; [ "$check" = load ] && script="$GATE/load.mjs"
  echo
  echo "================ $check ================"
  node "$script" 2>&1 | tee "$RESULTS/$check.out"
  rc=${PIPESTATUS[0]}
  RES[$check]=$rc
  [ "$rc" = 0 ] || fail=1
done

echo
echo "================ summary (lab, local) ================"
for check in http lcp load; do
  want "$check" || continue
  if [ "${RES[$check]}" != 0 ]; then verdict="FAIL (exit ${RES[$check]})"
  elif [ "$check" = lcp ]; then verdict=$(grep -o 'BASELINE RECORDED.*' "$RESULTS/lcp.out" | head -1 | sed 's/(not enforced.*//') # a baseline is recorded, not passed: the 3 s target is an [ASSUMPTION]
    if printf '%s' "$verdict" | grep -q ': OVER '; then verdict="$verdict -- OVER TARGET (recorded, not enforced)"; fi
  else verdict=PASS; fi
  printf '  %-5s %s\n' "$check" "$verdict"
done
echo "  full output: $RESULTS/*.out"
exit $fail
