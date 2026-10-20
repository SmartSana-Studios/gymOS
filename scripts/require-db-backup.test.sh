#!/usr/bin/env bash
# Tests scripts/lib/require-db-backup.py against a FAKE gh (a script in a temp dir), so it never touches GitHub or production.
#
#   bash scripts/require-db-backup.test.sh
set -uo pipefail
cd "$(dirname "$0")/.."

T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
# PYTHON_CMD lets CI (python3, no uv) run this; locally uv's Python is used because the system python3 here lacks the json module.
PY="${PYTHON_CMD:-uv run --no-project python} scripts/lib/require-db-backup.py"
FAST="--poll-seconds 0.2 --find-seconds 3 --timeout-seconds 3"

# ---- the fake gh ---------------------------------------------------------------------------------------------------------
# state: $T/runs.json (what "run list" prints), $T/triggered (count of "workflow run" calls), FAKE_END = success|failure|hang
cat > "$T/gh" <<'EOF'
#!/usr/bin/env bash
T="$(dirname "$0")"
case "$1 $2" in
  "run list")
    if [ -f "$T/trigger_time" ]; then
      n=$(( $(cat "$T/lists_since_trigger" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$T/lists_since_trigger"
      # the new run shows up as in_progress, then completes after a few listings (unless it hangs)
      if [ "$n" -ge 3 ] && [ "${FAKE_END:-success}" != "hang" ]; then st=completed; cc="${FAKE_END:-success}"; else st=in_progress; cc=null; fi
      [ "$cc" != null ] && cc="\"$cc\""
      jq --argjson id 9001 --arg st "$st" --argjson cc "$cc" --arg now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        '. + [{databaseId:$id,status:$st,conclusion:$cc,createdAt:$now,event:"workflow_dispatch"}]' "$T/runs.json"
    else
      cat "$T/runs.json"
    fi ;;
  "workflow run") echo x >> "$T/triggered"; date -u +%s > "$T/trigger_time"; [ "${FAKE_TRIGGER_FAILS:-0}" = 1 ] && { echo "HTTP 403" >&2; exit 1; }; exit 0 ;;
  *) echo "fake gh: unexpected $*" >&2; exit 9 ;;
esac
EOF
chmod +x "$T/gh"

reset() { rm -f "$T/triggered" "$T/trigger_time" "$T/lists_since_trigger"; echo "$1" > "$T/runs.json"; unset FAKE_END FAKE_TRIGGER_FAILS SKIP_DB_BACKUP; }
ago() { date -u -d "$1 minutes ago" +%Y-%m-%dT%H:%M:%SZ; }
run_json() { # $1 id $2 status $3 conclusion(or null) $4 minutes ago
  local cc="$3"; [ "$cc" != null ] && cc="\"$cc\""
  echo "{\"databaseId\":$1,\"status\":\"$2\",\"conclusion\":$cc,\"createdAt\":\"$(ago "$4")\",\"event\":\"schedule\"}"
}
triggers() { [ -f "$T/triggered" ] && wc -l < "$T/triggered" | tr -d ' ' || echo 0; }

fail=0
check() { [ "$2" = "$3" ] && echo "ok   $1" || { echo "FAIL $1: expected '$3', got '$2'"; fail=1; }; }
has() { case "$2" in *"$3"*) echo "ok   $1" ;; *) echo "FAIL $1: expected to contain '$3', got: $2"; fail=1 ;; esac; }
go() { out=$(GH_BIN="$T/gh" $PY $FAST "$@" 2>&1); rc=$?; }

# 1. a green run from 10 minutes ago is reused: nothing is triggered
reset "[$(run_json 100 completed success 10)]"
go; check "recent green run: go ahead (exit 0)" "$rc" "0"; check "  nothing triggered" "$(triggers)" "0"; has "  says it reused run 100" "$out" "using green run 100"

# 2. the only green run is 3 hours old: a new one is triggered and waited for
reset "[$(run_json 100 completed success 180)]"
FAKE_END=success go; check "stale green run: triggers and waits, then exit 0" "$rc" "0"; check "  triggered exactly once" "$(triggers)" "1"; has "  says safe to deploy" "$out" "Safe to deploy"

# 3. a recent FAILED run does not count
reset "[$(run_json 101 completed failure 5)]"
FAKE_END=success go; check "recent failed run is not accepted: triggers a new one" "$(triggers)" "1"; check "  and then exit 0" "$rc" "0"

# 4. the new run fails: refuse
reset "[$(run_json 100 completed success 180)]"
FAKE_END=failure go; check "triggered run fails: refuse (exit 1)" "$rc" "1"; has "  says NOT deploying" "$out" "NOT deploying"

# 5. the new run hangs past the timeout: refuse
reset "[$(run_json 100 completed success 180)]"
FAKE_END=hang go; check "triggered run never finishes: refuse (exit 1)" "$rc" "1"; has "  says it did not finish" "$out" "did not finish"

# 6. a run already in progress is waited for, not duplicated
reset "[$(run_json 102 in_progress null 4)]"
go --timeout-seconds 1; check "run in progress is not duplicated (nothing triggered)" "$(triggers)" "0"; check "  and a timeout while waiting refuses" "$rc" "1"

# 7. the workflow cannot be triggered (no permission): refuse
reset "[$(run_json 100 completed success 180)]"
FAKE_TRIGGER_FAILS=1 go; check "cannot trigger: refuse (exit 1)" "$rc" "1"; has "  says could not trigger" "$out" "could not trigger"

# 8. gh missing entirely: refuse, never silently pass
out=$(GH_BIN="$T/does-not-exist" $PY $FAST 2>&1); rc=$?
check "no gh CLI: refuse (exit 1)" "$rc" "1"; has "  says so" "$out" "not installed"

# 9. skipping needs a reason
reset "[$(run_json 100 completed success 180)]"
SKIP_DB_BACKUP=1 go; check "SKIP_DB_BACKUP=1 (no reason): refuse" "$rc" "1"
SKIP_DB_BACKUP="because" go; check "SKIP_DB_BACKUP with one word: refuse" "$rc" "1"
SKIP_DB_BACKUP="owner approved: nightly dump is 1h old" go; check "SKIP_DB_BACKUP with a real reason: go ahead" "$rc" "0"
has "  and it is loudly marked" "$out" "SKIPPED ON PURPOSE"; check "  and nothing is triggered" "$(triggers)" "0"

[ "$fail" = 0 ] && echo "require-db-backup: all passed" || { echo "require-db-backup: FAILED"; exit 1; }
