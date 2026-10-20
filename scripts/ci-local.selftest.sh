#!/usr/bin/env bash
# Self-test for scripts/ci-local.sh (Epic 22 retro items 75 and 77: a merge gate must be shown capable of failing).
#
# On 2026-10-17 the pgtap, unit and e2e stages relied on `set -e`, which is ignored when run_stage calls a stage in an `if`,
# so a failing pgTAP file was reported PASS and several "green" runs were wrong. This test keeps that from coming back:
#   1. LINT:   every command line inside a stage_* function ends in `|| return` (so a failure fails the stage);
#   2. BEHAVE: run_stage, fed a stage whose FIRST command fails and whose last succeeds, reports FAIL (the known-bad input),
#              and reports PASS when nothing fails (so the test cannot pass by failing everything);
#   3. WIRED:  every stage_* function is actually run by a run_stage line.
#
#   bash scripts/ci-local.selftest.sh [path-to-ci-local.sh]      (default: scripts/ci-local.sh)
set -uo pipefail
cd "$(dirname "$0")/.."
CI="${1:-scripts/ci-local.sh}"
fail=0
ok() { echo "ok   $1"; }
no() { echo "FAIL $1"; fail=1; }

# ---- 1. lint ------------------------------------------------------------------------------------------------------------------
bad=$(awk '
  /^stage_[a-z0-9_]+\(\) \{/ { infn = 1; fn = $1; next }
  infn && /^\}/ { infn = 0; next }
  infn {
    line = $0; sub(/^[ \t]+/, "", line)
    if (line == "" || line ~ /^#/ || line ~ /^(local|if|fi|then|else|echo|return|export|\[) / || line ~ /^(fi|then|else)$/) next
    # a plain assignment (VAR=value, VAR="..." or VAR=$(...)) runs no command of its own
    if (line ~ /^[A-Za-z_][A-Za-z0-9_]*=([^[:space:]"]+|"[^"]*"|\$\([^)]*\))$/) next
    if (line ~ /\|\| return( [0-9$?]+)?$/) next
    printf "%s:%d: %s\n", fn, NR, line
  }' "$CI")
if [ -z "$bad" ]; then ok "every command in a stage can fail the stage (ends in || return)"; else no "commands that cannot fail their stage:"; echo "$bad" | sed 's/^/       /'; fi

# ---- 2. behaviour of run_stage --------------------------------------------------------------------------------------------------
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
sed -n '/^run_stage()/,/^}/p' "$CI" > "$T/run_stage.sh"
if [ ! -s "$T/run_stage.sh" ]; then no "run_stage not found in $CI"; else
  # shellcheck disable=SC1090
  . "$T/run_stage.sh"; LOG_DIR="$T"
  stage_known_bad()  { false || return 1; true; }          # first command fails, last succeeds: must be red
  stage_known_good() { true || return 1; true; }
  stage_swallowed()  { false; true; }                      # the OLD pattern: documents WHY the lint exists (this one passes falsely)
  run_stage known_bad stage_known_bad >/dev/null 2>&1;   [ "$(cut -d' ' -f1 "$T/known_bad.status")" = FAIL ] && ok "run_stage reports FAIL for a stage whose first command fails" || no "run_stage reported PASS for a failing stage"
  run_stage known_good stage_known_good >/dev/null 2>&1; [ "$(cut -d' ' -f1 "$T/known_good.status")" = PASS ] && ok "run_stage reports PASS when nothing fails" || no "run_stage reported FAIL for a passing stage"
  run_stage swallowed stage_swallowed >/dev/null 2>&1;   [ "$(cut -d' ' -f1 "$T/swallowed.status")" = PASS ] && ok "(documented) a failing command without || return is swallowed: the lint above is what stops it" || no "unexpected: the errexit-in-if pitfall no longer reproduces; revisit the lint"
fi

# ---- 3. every stage is run ------------------------------------------------------------------------------------------------------
unwired=""
for fn in $(grep -oE '^stage_[a-z0-9_]+' "$CI" | sort -u); do
  grep -qE "run_stage [a-z0-9_]+ +$fn( |&|;|\$)" "$CI" || unwired="$unwired $fn"
done
if [ -z "$unwired" ]; then ok "every stage_* function is run by a run_stage line"; else no "stage functions never run:$unwired"; fi

[ "$fail" = 0 ] && echo "ci-local self-test: all passed" || { echo "ci-local self-test: FAILED"; exit 1; }
