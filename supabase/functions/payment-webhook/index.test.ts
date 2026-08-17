// Deno test suite for payment-webhook's receive route — signature-verification-before-DB-write
// invariant (Story 4.11, Task 3's last bullet — AC #1's "before any DB write" clause, AD-17).
//
// index.ts's static import graph pulls in TaraMoneyProvider.ts and @supabase/supabase-js, which
// creates a real client at module scope from SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY — this file
// sets fake values before the dynamic import so the module loads cleanly (a static top-level
// import would in any case be hoisted ahead of the Deno.env.set calls), following
// send-sms-hook/index.test.ts's precedent. globalThis.fetch is stubbed to throw on any call so an
// unexpected DB access fails the test loudly rather than silently succeeding against a fake
// client.
//
// Run: deno test --allow-env supabase/functions/payment-webhook/index.test.ts

import { assertEquals } from "jsr:@std/assert@^1";

const SECRET = "test-taramoney-webhook-secret";
Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
Deno.env.set("TARAMONEY_WEBHOOK_SECRET", SECRET);

const handler = (await import("./index.ts")).default;

function stubFetchNoCallsExpected() {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request) => {
    const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    calls.push(href);
    throw new Error(`stubFetch: unexpected DB access ${href}`);
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

function receiveRequest(headers: Record<string, string>, body: unknown) {
  return new Request("https://example.com/functions/v1/payment-webhook/taramoney", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

Deno.test("payment-webhook taramoney receive route: wrong-value signature returns 401 and makes no DB call", async () => {
  const { calls, restore } = stubFetchNoCallsExpected();
  try {
    const req = receiveRequest({ "tara-webhook-secret": "wrong-secret" }, {
      businessId: "biz1",
      paymentId: "pay1",
      status: "SUCCESS",
    });
    const res = await handler.fetch(req);
    assertEquals(res.status, 401);
    assertEquals(calls.length, 0, "signature verification must fail before any DB access");
  } finally {
    restore();
  }
});

Deno.test("payment-webhook taramoney receive route: equal-length wrong-value signature returns 401 and makes no DB call", async () => {
  const { calls, restore } = stubFetchNoCallsExpected();
  try {
    const req = receiveRequest({ "tara-webhook-secret": "x".repeat(SECRET.length) }, {
      businessId: "biz1",
      paymentId: "pay1",
      status: "SUCCESS",
    });
    const res = await handler.fetch(req);
    assertEquals(res.status, 401);
    assertEquals(calls.length, 0, "signature verification must fail before any DB access");
  } finally {
    restore();
  }
});

Deno.test("payment-webhook taramoney receive route: missing signature header returns 401 and makes no DB call", async () => {
  const { calls, restore } = stubFetchNoCallsExpected();
  try {
    const req = receiveRequest({}, { businessId: "biz1", paymentId: "pay1", status: "SUCCESS" });
    const res = await handler.fetch(req);
    assertEquals(res.status, 401);
    assertEquals(calls.length, 0, "signature verification must fail before any DB access");
  } finally {
    restore();
  }
});

Deno.test("payment-webhook taramoney receive route: malformed JSON body with a correct header returns 401 and makes no DB call", async () => {
  const { calls, restore } = stubFetchNoCallsExpected();
  try {
    const req = new Request("https://example.com/functions/v1/payment-webhook/taramoney", {
      method: "POST",
      headers: { "tara-webhook-secret": SECRET },
      body: "{not valid json",
    });
    const res = await handler.fetch(req);
    assertEquals(res.status, 401);
    assertEquals(calls.length, 0, "signature verification must fail before any DB access");
  } finally {
    restore();
  }
});
