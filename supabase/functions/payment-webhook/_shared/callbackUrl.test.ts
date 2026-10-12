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

Deno.test("hosted: an http request URL is upgraded to https (Tara ONLY_HTTPS_LINKS_ALLOWED, 2026-10-12)", () => {
  const url = new URL("http://proj.supabase.co/functions/v1/payment-webhook/initiate/taramoney");
  assertEquals(
    buildCallbackUrl(url, ["functions", "v1", "payment-webhook", "initiate", "taramoney"], "taramoney", undefined),
    "https://proj.supabase.co/functions/v1/payment-webhook/taramoney",
  );
});

Deno.test("hosted: a stripped /functions/v1 prefix is restored", () => {
  const url = new URL("http://proj.supabase.co/payment-webhook/initiate/taramoney");
  assertEquals(
    buildCallbackUrl(url, ["payment-webhook", "initiate", "taramoney"], "taramoney", undefined),
    "https://proj.supabase.co/functions/v1/payment-webhook/taramoney",
  );
});

Deno.test("non-supabase hosts are left exactly as received", () => {
  const url = new URL("http://supabase_edge_runtime_gym_os:8081/payment-webhook/initiate/taramoney");
  assertEquals(
    buildCallbackUrl(url, ["payment-webhook", "initiate", "taramoney"], "taramoney", undefined),
    "http://supabase_edge_runtime_gym_os:8081/payment-webhook/taramoney",
  );
});
