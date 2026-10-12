#!/usr/bin/env bash
# Serve supabase/functions to the LOCAL Supabase stack with Tara pointed at the fake provider.
#
# Same trick as epic18-qa/start-edge-functions.sh (copy the functions into a named volume and run the
# edge-runtime image with a tiny router), plus: in the COPY only, every https://www.dklo.co call is
# rewritten to the fake Tara on the host (scripts/epic19-qa/fake-tara.mjs, :4010). The repo's
# functions are never modified. LOCAL ONLY. Re-run after editing anything under supabase/functions.
#
# Usage: ./scripts/epic19-qa/start-edge-functions.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
FAKE_PORT="${FAKE_TARA_PORT:-4010}"
IMG=public.ecr.aws/supabase/edge-runtime:v1.76.2
NET=supabase_network_gym_os
env_val() { grep "^$1=" apps/dashboard/.env.local | cut -d= -f2; }
SRK="$(env_val SUPABASE_SERVICE_ROLE_KEY)"; ANON="$(env_val NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)"
[[ "$(env_val NEXT_PUBLIC_SUPABASE_URL)" == *127.0.0.1* ]] || { echo "dashboard .env.local is not local"; exit 1; }

STAGE="$(mktemp -d)"
cp -r supabase/functions/. "$STAGE/"
grep -rl "https://www.dklo.co" "$STAGE" --include=*.ts | xargs -r sed -i "s#https://www.dklo.co#http://host.docker.internal:${FAKE_PORT}#g"
mkdir -p "$STAGE/main"
cat > "$STAGE/main/index.ts" <<'TS'
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
docker cp "$STAGE/." qa_edge_copy:/dst/
docker rm qa_edge_copy >/dev/null
rm -rf "$STAGE"

docker run -d --name supabase_edge_runtime_gym_os --network "$NET" --restart unless-stopped \
  --add-host host.docker.internal:host-gateway \
  -v qa_edge_functions:/home/deno/functions -v supabase_edge_runtime_gym_os:/root/.cache/deno \
  -e SUPABASE_URL=http://supabase_kong_gym_os:8000 -e SUPABASE_SERVICE_ROLE_KEY="$SRK" -e SUPABASE_ANON_KEY="$ANON" \
  -e DENO_DIR=/root/.cache/deno "$IMG" start --main-service /home/deno/functions/main -p 8081 >/dev/null
sleep 5
curl -s -m 60 -X POST http://127.0.0.1:54321/functions/v1/payment-webhook/initiate/taramoney \
  -H "apikey: $ANON" -H 'content-type: application/json' -d '{}'; echo
echo "(expected: {\"error\":\"paymentId and phoneNumber are required\"})"
echo "Now start the fake provider:  node scripts/epic19-qa/fake-tara.mjs"
