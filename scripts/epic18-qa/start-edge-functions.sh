#!/usr/bin/env bash
# Serve supabase/functions (payment-webhook etc.) to the LOCAL Supabase stack.
#
# Why this exists: `supabase functions serve` fails in this devcontainer
# ("failed to determine entrypoint" -- the CLI bind-mounts a host path that
# does not exist on the Docker host). This copies the functions into a named
# volume and runs the edge-runtime image with a tiny router instead. Kong
# already routes /functions/v1/* to supabase_edge_runtime_gym_os:8081.
#
# Re-run after editing anything under supabase/functions. LOCAL ONLY.
#
# Usage: ./scripts/epic18-qa/start-edge-functions.sh [https://<tunnel-host>]
# The optional tunnel host is pinned as PAYMENT_WEBHOOK_PUBLIC_BASE_URL so provider
# callbacks (Tara requires https) point at the tunnel, not at Kong's internal address.
set -euo pipefail
cd "$(dirname "$0")/../.."
TUNNEL="${1:-}"
PUBLIC_ENV=()
[ -n "$TUNNEL" ] && PUBLIC_ENV=(-e "PAYMENT_WEBHOOK_PUBLIC_BASE_URL=${TUNNEL%/}/functions/v1/payment-webhook")

IMG=public.ecr.aws/supabase/edge-runtime:v1.76.2
NET=supabase_network_gym_os
env_val() { grep "^$1=" apps/dashboard/.env.local | cut -d= -f2; }
SRK="$(env_val SUPABASE_SERVICE_ROLE_KEY)"; ANON="$(env_val NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)"
MAIN="$(mktemp -d)"
cat > "$MAIN/index.ts" <<'TS'
Deno.serve(async (req: Request) => {
  const name = new URL(req.url).pathname.split("/")[1];
  if (!name) return new Response(JSON.stringify({ error: "missing function name" }), { status: 400 });
  try {
    // deno-lint-ignore no-explicit-any
    const worker = await (globalThis as any).EdgeRuntime.userWorkers.create({
      servicePath: `/home/deno/functions/${name}`, memoryLimitMb: 256, workerTimeoutMs: 150000,
      noModuleCache: false, importMapPath: null, envVars: Object.entries(Deno.env.toObject()),
      forceCreate: false, netAccessDisabled: false, cpuTimeSoftLimitMs: 10000, cpuTimeHardLimitMs: 20000,
    });
    return await worker.fetch(req);
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
TS

docker rm -f supabase_edge_runtime_gym_os qa_edge_copy >/dev/null 2>&1 || true
docker volume rm qa_edge_functions >/dev/null 2>&1 || true
docker volume create qa_edge_functions >/dev/null
docker create --name qa_edge_copy -v qa_edge_functions:/dst "$IMG" >/dev/null
docker cp supabase/functions/. qa_edge_copy:/dst/
docker cp "$MAIN" qa_edge_copy:/dst/main
docker rm qa_edge_copy >/dev/null

docker run -d --name supabase_edge_runtime_gym_os --network "$NET" --restart unless-stopped \
  -v qa_edge_functions:/home/deno/functions -v supabase_edge_runtime_gym_os:/root/.cache/deno \
  -e SUPABASE_URL=http://supabase_kong_gym_os:8000 -e SUPABASE_SERVICE_ROLE_KEY="$SRK" -e SUPABASE_ANON_KEY="$ANON" \
  -e DENO_DIR=/root/.cache/deno "${PUBLIC_ENV[@]}" "$IMG" start --main-service /home/deno/functions/main -p 8081 >/dev/null
sleep 5
curl -s -m 60 -X POST http://127.0.0.1:54321/functions/v1/payment-webhook/initiate/taramoney \
  -H "apikey: $ANON" -H 'content-type: application/json' -d '{}' ; echo
echo "(expected: {\"error\":\"paymentId and phoneNumber are required\"})"
