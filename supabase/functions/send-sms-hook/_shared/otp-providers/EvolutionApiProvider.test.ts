// Deno test suite for EvolutionApiProvider (Story 2.9, Task 1).
//
// EvolutionApiProvider.ts creates its supabase-js client at module scope (a null client if
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are unset — send() then returns a clean failure, per a
// code-review fix; the module never throws at import time). This file still sets them before the
// dynamic import so send() has a working client for the tests below that exercise real behavior
// past that check (a static top-level import would in any case be hoisted ahead of the
// Deno.env.set calls).
//
// Run: deno test --allow-env supabase/functions/send-sms-hook/_shared/otp-providers/EvolutionApiProvider.test.ts

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");

const { EvolutionApiProvider } = await import("./EvolutionApiProvider.ts");

const PHONE = "+237680811041";
const CODE = "123456";

/** Routes the global fetch to canned responses based on URL shape, and records every call. */
function stubFetch(opts: {
  instanceRow?: { instance_id: string | null } | null;
  /** Cycled through in order on successive messaging_provider_config calls, one row per call — proves a
   * changed value is actually picked up rather than just that the DB is hit more than once. Falls back to
   * `instanceRow`/the default once exhausted. */
  instanceRowSequence?: Array<{ instance_id: string | null } | null>;
  instanceStatus?: number;
  sendStatus?: number;
  sendBody?: string;
}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const original = globalThis.fetch;
  let instanceCallCount = 0;

  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    calls.push({ url: href, init });

    if (href.includes("messaging_provider_config")) {
      const status = opts.instanceStatus ?? 200;
      const row = opts.instanceRowSequence?.[instanceCallCount] ?? opts.instanceRow ?? { instance_id: "souna2" };
      instanceCallCount++;
      const body = row === null ? JSON.stringify({ message: "no rows", code: "PGRST116" }) : JSON.stringify(row);
      return Promise.resolve(
        new Response(body, { status, headers: { "content-type": "application/json" } }),
      );
    }

    if (href.includes("/message/sendText/")) {
      return Promise.resolve(
        new Response(opts.sendBody ?? JSON.stringify({ key: {}, message: {} }), {
          status: opts.sendStatus ?? 201,
          headers: { "content-type": "application/json" },
        }),
      );
    }

    throw new Error(`stubFetch: unexpected URL ${href}`);
  }) as typeof fetch;

  return { calls, restore: () => (globalThis.fetch = original) };
}

function withEnv(vars: Record<string, string>, fn: () => Promise<void> | void) {
  const previous = new Map<string, string | undefined>();
  for (const [k, v] of Object.entries(vars)) {
    previous.set(k, Deno.env.get(k));
    Deno.env.set(k, v);
  }
  return (async () => {
    try {
      await fn();
    } finally {
      for (const [k, v] of previous) {
        if (v === undefined) Deno.env.delete(k);
        else Deno.env.set(k, v);
      }
    }
  })();
}

Deno.test("EvolutionApiProvider.send: missing EVOLUTION_API_BASE_URL/KEY returns a clean failure, never throws", async () => {
  // Deleted vars are restored in `finally` (code review fix) — the previous version deleted them
  // directly inside a withEnv({}, ...) callback, whose restore loop only covers keys passed into
  // `vars`, so an empty object meant these two were never restored if either was already set in
  // the ambient environment.
  const previousBaseUrl = Deno.env.get("EVOLUTION_API_BASE_URL");
  const previousApiKey = Deno.env.get("EVOLUTION_API_KEY");
  try {
    Deno.env.delete("EVOLUTION_API_BASE_URL");
    Deno.env.delete("EVOLUTION_API_KEY");
    const result = await new EvolutionApiProvider().send(PHONE, CODE, "en");
    assertEquals(result.success, false);
    if (!result.success) assertStringIncludes(result.error, "not configured");
  } finally {
    if (previousBaseUrl === undefined) Deno.env.delete("EVOLUTION_API_BASE_URL");
    else Deno.env.set("EVOLUTION_API_BASE_URL", previousBaseUrl);
    if (previousApiKey === undefined) Deno.env.delete("EVOLUTION_API_KEY");
    else Deno.env.set("EVOLUTION_API_KEY", previousApiKey);
  }
});

Deno.test("EvolutionApiProvider.send: missing instance_id (Story 1.13's 'not yet configured' state) fails cleanly, not a thrown exception", async () => {
  await withEnv({ EVOLUTION_API_BASE_URL: "https://evo.example.com", EVOLUTION_API_KEY: "key" }, async () => {
    const { restore } = stubFetch({ instanceRow: { instance_id: null } });
    try {
      const result = await new EvolutionApiProvider().send(PHONE, CODE, "en");
      assertEquals(result.success, false);
      if (!result.success) assertStringIncludes(result.error, "not configured");
    } finally {
      restore();
    }
  });
});

Deno.test("EvolutionApiProvider.send: a DB error (no row found) fails cleanly rather than throwing — this is AC #3's fall-through precondition", async () => {
  await withEnv({ EVOLUTION_API_BASE_URL: "https://evo.example.com", EVOLUTION_API_KEY: "key" }, async () => {
    const { restore } = stubFetch({ instanceRow: null, instanceStatus: 406 });
    try {
      const result = await new EvolutionApiProvider().send(PHONE, CODE, "en");
      assertEquals(result.success, false);
    } finally {
      restore();
    }
  });
});

Deno.test("EvolutionApiProvider.send: a real connector disconnect (non-2xx sendText) maps to a DeliveryResult failure with the provider's status", async () => {
  await withEnv({ EVOLUTION_API_BASE_URL: "https://evo.example.com", EVOLUTION_API_KEY: "key" }, async () => {
    const { restore } = stubFetch({
      sendStatus: 500,
      sendBody: JSON.stringify({ status: 500, error: "Internal Server Error", response: { message: "Connection Closed" } }),
    });
    try {
      const result = await new EvolutionApiProvider().send(PHONE, CODE, "en");
      assertEquals(result.success, false);
      if (!result.success) {
        assertEquals(result.status, 500);
        assertStringIncludes(result.error, "Evolution API 500");
        assertStringIncludes(result.error, "Connection Closed");
      }
    } finally {
      restore();
    }
  });
});

Deno.test("EvolutionApiProvider.send: a 2xx sendText response is treated as success on the whatsapp channel", async () => {
  await withEnv({ EVOLUTION_API_BASE_URL: "https://evo.example.com", EVOLUTION_API_KEY: "key" }, async () => {
    const { restore } = stubFetch({ sendStatus: 201 });
    try {
      const result = await new EvolutionApiProvider().send(PHONE, CODE, "en");
      assertEquals(result, { success: true, channel: "whatsapp" });
    } finally {
      restore();
    }
  });
});

Deno.test("EvolutionApiProvider.send: strips the leading '+' from the phone and sends the bare-digits 'number' field, per the live-verified contract", async () => {
  await withEnv({ EVOLUTION_API_BASE_URL: "https://evo.example.com", EVOLUTION_API_KEY: "key" }, async () => {
    const { calls, restore } = stubFetch({ sendStatus: 201 });
    try {
      await new EvolutionApiProvider().send(PHONE, CODE, "en");
      const sendCall = calls.find((c) => c.url.includes("/message/sendText/"));
      assert(sendCall, "expected a call to /message/sendText/{instance}");
      assertStringIncludes(sendCall!.url, "/message/sendText/souna2");
      const body = JSON.parse(sendCall!.init!.body as string);
      assertEquals(body.number, "237680811041");
      assertStringIncludes(body.text, CODE);
    } finally {
      restore();
    }
  });
});

Deno.test("EvolutionApiProvider.send: uses the locale-appropriate plain-text message (no template), bold-wrapped code", async () => {
  await withEnv({ EVOLUTION_API_BASE_URL: "https://evo.example.com", EVOLUTION_API_KEY: "key" }, async () => {
    const { calls, restore } = stubFetch({ sendStatus: 201 });
    try {
      await new EvolutionApiProvider().send(PHONE, CODE, "fr");
      const body = JSON.parse(calls.find((c) => c.url.includes("/message/sendText/"))!.init!.body as string);
      assertStringIncludes(body.text, "Votre code GymOS est");
      assertStringIncludes(body.text, `*${CODE}*`);
    } finally {
      restore();
    }
  });
});

Deno.test("EvolutionApiProvider.send: reads instance_id per-request, not cached — a changed instance between sends is actually picked up", async () => {
  await withEnv({ EVOLUTION_API_BASE_URL: "https://evo.example.com", EVOLUTION_API_KEY: "key" }, async () => {
    // Two distinct rows (code review fix) — a static single row across both calls only proved the
    // DB was hit twice, not that a Super Admin's mid-flight instance_id change actually reaches the
    // second sendText call, which is the property AC #2's "no redeploy" guarantee depends on.
    const { calls, restore } = stubFetch({
      instanceRowSequence: [{ instance_id: "souna2" }, { instance_id: "changed-instance" }],
      sendStatus: 201,
    });
    try {
      const provider = new EvolutionApiProvider();
      await provider.send(PHONE, CODE, "en");
      await provider.send(PHONE, CODE, "en");
      const configCalls = calls.filter((c) => c.url.includes("messaging_provider_config"));
      assertEquals(configCalls.length, 2, "instance_id must be read fresh on every send(), not hoisted");
      const sendCalls = calls.filter((c) => c.url.includes("/message/sendText/"));
      assertStringIncludes(sendCalls[0].url, "/message/sendText/souna2");
      assertStringIncludes(sendCalls[1].url, "/message/sendText/changed-instance");
    } finally {
      restore();
    }
  });
});
