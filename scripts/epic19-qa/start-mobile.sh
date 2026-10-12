#!/usr/bin/env bash
# Run the member app (apps/mobile) against the LOCAL Supabase stack, reachable from a real phone.
#
# Your phone cannot reach 127.0.0.1 inside this devcontainer, so two throwaway Cloudflare quick
# tunnels are opened: one for the Supabase API gateway (:54321) and one for Metro (:8081). The app
# is started with EXPO_PUBLIC_SUPABASE_URL pointing at the first. Sentry and PostHog are blanked so
# QA noise never reaches the real projects. LOCAL ONLY -- throwaway data, tunnels die with the script.
#
#   scripts/epic19-qa/start-mobile.sh             # Expo Go on the phone (Expo Go app, same SDK 57)
#   MODE=dev-client scripts/epic19-qa/start-mobile.sh   # if you have a GymOS development build installed
#
# Prereqs: local Supabase up; `node scripts/epic19-qa/seed.mjs`; `scripts/epic19-qa/start-edge-functions.sh`
# (+ `node scripts/epic19-qa/fake-tara.mjs`, started here if not already running).
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT=$PWD
LOG=${QA_LOG_DIR:-/tmp/epic19-qa}; mkdir -p "$LOG"
CF=${CLOUDFLARED:-$HOME/.local/share/cloudflared-bin/cloudflared}
[ -x "$CF" ] || CF=$(command -v cloudflared || true)
[ -n "$CF" ] || { echo "cloudflared not found. Download the linux-amd64 binary from github.com/cloudflare/cloudflared/releases to ~/.local/share/cloudflared-bin/cloudflared"; exit 1; }

env_val() { grep "^$1=" apps/dashboard/.env.local | cut -d= -f2; }
ANON="$(env_val NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)"
[[ "$(env_val NEXT_PUBLIC_SUPABASE_URL)" == *127.0.0.1* ]] || { echo "dashboard .env.local is not local"; exit 1; }
curl -fsS -m 5 -o /dev/null -H "apikey: $ANON" http://127.0.0.1:54321/auth/v1/health || { echo "local Supabase is not up on :54321"; exit 1; }

PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

# fake Tara (so the in-app "pay by Tara Money" flow completes locally)
if ! curl -fs -m 2 -o /dev/null http://127.0.0.1:4010/txns; then
  node scripts/epic19-qa/fake-tara.mjs >"$LOG/fake-tara.log" 2>&1 &
  PIDS+=($!)
  sleep 1
fi

# Sets TUNNEL_URL (not a command substitution: the background process must stay in this shell's PIDS).
tunnel() {
  local name=$1 target=$2 log="$LOG/tunnel-$1.log"
  : >"$log"
  (cd /tmp && exec "$CF" tunnel --no-autoupdate --url "$target") >"$log" 2>&1 </dev/null &
  PIDS+=($!)
  TUNNEL_URL=""
  for _ in $(seq 1 90); do
    TUNNEL_URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$log" | grep -v '^https://api\.' | head -1 || true)
    [ -n "$TUNNEL_URL" ] && return 0
    sleep 1
  done
  echo "tunnel $name did not come up; see $log" >&2; exit 1
}
tunnel api http://127.0.0.1:54321;  API_URL=$TUNNEL_URL
tunnel metro http://127.0.0.1:8081; METRO_URL=$TUNNEL_URL
curl -fsS -m 15 -o /dev/null -H "apikey: $ANON" "$API_URL/auth/v1/health" || echo "warning: API tunnel not answering yet (DNS can take a few seconds)"

echo
echo "  Supabase API tunnel : $API_URL"
echo "  Metro tunnel        : $METRO_URL"
echo "  Phone members       : +237699000001 and +237670000001  (OTP 123456)"
echo "  Open on the phone   : exps://${METRO_URL#https://}   (Expo Go: Enter URL manually, or scan the QR below)"
echo

cd apps/mobile
export EXPO_PUBLIC_SUPABASE_URL="$API_URL"
export EXPO_PUBLIC_SUPABASE_ANON_KEY="$ANON"
export EXPO_PUBLIC_SENTRY_DSN="" EXPO_PUBLIC_POSTHOG_KEY="" EXPO_PUBLIC_APP_ENV=development
export EXPO_PACKAGER_PROXY_URL="$METRO_URL"
export QA_EXPO_GO=1   # stubs expo-notifications (breaks Expo Go on Android); see apps/mobile/metro.config.js
# On the device the app's .env.local (a stale tunnel) beat the shell variables above, so the same values
# are also written to .env.development.local, which Expo loads with higher priority. Removed on exit.
QA_ENV=.env.development.local
[ -e "$QA_ENV" ] && { echo "$QA_ENV already exists in apps/mobile; move it away first"; exit 1; }
cat >"$QA_ENV" <<ENVEOF
EXPO_PUBLIC_SUPABASE_URL=$API_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY=$ANON
EXPO_PUBLIC_SENTRY_DSN=
EXPO_PUBLIC_POSTHOG_KEY=
EXPO_PUBLIC_APP_ENV=development
ENVEOF
cleanup() { rm -f "$ROOT/apps/mobile/$QA_ENV"; for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM
FLAG="--go"; [ "${MODE:-go}" = "dev-client" ] && FLAG="--dev-client"
npx expo start $FLAG --port 8081 --clear
