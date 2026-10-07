import { assertEquals } from "jsr:@std/assert@1";

import { buildCallbackUrl } from "./callbackUrl.ts";

Deno.test("hosted: rebuilds the receive route from the request (prefix preserved)", () => {
  const url = new URL("https://proj.supabase.co/functions/v1/payment-webhook/initiate/taramoney");
  assertEquals(
    buildCallbackUrl(url, ["functions", "v1", "payment-webhook", "initiate", "taramoney"], "taramoney", undefined),
    "https://proj.supabase.co/functions/v1/payment-webhook/taramoney",
  );
});

Deno.test("local: a pinned public base wins over the internal origin", () => {
  const url = new URL("http://supabase_edge_runtime_gym_os:8081/payment-webhook/initiate/taramoney");
  assertEquals(
    buildCallbackUrl(url, ["payment-webhook", "initiate", "taramoney"], "taramoney", "https://t.example.com/functions/v1/payment-webhook/"),
    "https://t.example.com/functions/v1/payment-webhook/taramoney",
  );
});

Deno.test("a blank override is ignored", () => {
  const url = new URL("https://proj.supabase.co/functions/v1/payment-webhook/initiate/taramoney");
  assertEquals(
    buildCallbackUrl(url, ["functions", "v1", "payment-webhook", "initiate", "taramoney"], "taramoney", "  "),
    "https://proj.supabase.co/functions/v1/payment-webhook/taramoney",
  );
});
