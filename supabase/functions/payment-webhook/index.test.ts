// Deno test suite for payment-webhook's receive route — signature-verification-before-DB-write
// invariant (Story 4.11, Task 3's last bullet — AC #1's "before any DB write" clause, AD-17).
//
// Story 4.14: verification now resolves a per-gym secret via a businessId lookup RPC -- a
// legitimate DB *read* for any well-formed payload, before the header is even compared. The
// invariant these tests protect is unchanged (no DB *write* before a successful verification);
// what changed is that "no DB call at all" is no longer the right assertion for a well-formed
// payload -- these tests now stub fetch to serve that one expected read and assert no *write*
// endpoint (payment_webhook_events/payments) is ever hit, instead of asserting zero calls.
//
// index.ts's static import graph pulls in TaraMoneyProvider.ts and @supabase/supabase-js, which
// creates a real client at module scope from SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY — this file
// sets fake values before the dynamic import so the module loads cleanly (a static top-level
// import would in any case be hoisted ahead of the Deno.env.set calls), following
// send-sms-hook/index.test.ts's precedent.
//
// Run: deno test --allow-env supabase/functions/payment-webhook/index.test.ts

import { assertEquals } from "jsr:@std/assert@^1";

const SECRET = "test-taramoney-webhook-secret";
Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");

const handler = (await import("./index.ts")).default;

const GYM_A_ROW = { gym_id: "gym-a", api_key: "key-a", business_id: "biz1", webhook_secret: SECRET };

/**
 * Serves `get_gym_payment_credentials_by_business_id` with `lookupResponse` (an array of rows,
 * PostgREST's own RPC response shape) and records every call made; any other fetch (in
 * particular a write to payment_webhook_events/payments) throws, failing the test loudly.
 */
function stubFetchServingBusinessIdLookupOnly(lookupResponse: unknown[]) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request) => {
    const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    calls.push(href);
    if (href.includes("/rest/v1/rpc/get_gym_payment_credentials_by_business_id")) {
      return Promise.resolve(
        new Response(JSON.stringify(lookupResponse), { status: 200, headers: { "Content-Type": "application/json" } }),
      );
    }
    throw new Error(`stubFetch: unexpected DB access ${href}`);
  }) as typeof fetch;
  return {
    calls,
    writeCallsCount: () => calls.filter((c) => !c.includes("/rest/v1/rpc/get_gym_payment_credentials_by_business_id")).length,
    restore: () => (globalThis.fetch = original),
  };
}

/**
 * Serves a full receive-route flow past signature verification: the businessId lookup RPC, a
 * `payments` select returning `paymentRow`, and a `payment_webhook_events` upsert -- then records
 * whether `complete_verified_payment` (the completion RPC) was ever called. Used by the
 * cross-tenant-completion-guard test below (review finding), which must reach this far and then
 * stop short of calling it.
 */
function stubFetchFullFlow(lookupResponse: unknown[], paymentRow: { id: string; gym_id: string } | null) {
  const calls: string[] = [];
  let completeVerifiedPaymentCalled = false;
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request) => {
    const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    calls.push(href);
    if (href.includes("/rest/v1/rpc/get_gym_payment_credentials_by_business_id")) {
      return Promise.resolve(
        new Response(JSON.stringify(lookupResponse), { status: 200, headers: { "Content-Type": "application/json" } }),
      );
    }
    if (href.includes("/rest/v1/payments?")) {
      return Promise.resolve(
        new Response(JSON.stringify(paymentRow), { status: 200, headers: { "Content-Type": "application/json" } }),
      );
    }
    if (href.includes("/rest/v1/payment_webhook_events")) {
      return Promise.resolve(new Response(null, { status: 201 }));
    }
    if (href.includes("/rest/v1/rpc/complete_verified_payment")) {
      completeVerifiedPaymentCalled = true;
      return Promise.resolve(new Response(null, { status: 200 }));
    }
    throw new Error(`stubFetch: unexpected DB access ${href}`);
  }) as typeof fetch;
  return {
    calls,
    completeVerifiedPaymentCalled: () => completeVerifiedPaymentCalled,
    restore: () => (globalThis.fetch = original),
  };
}

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

Deno.test("payment-webhook taramoney receive route: wrong-value signature (businessId resolves, header wrong) returns 401 and makes no DB write", async () => {
  const stub = stubFetchServingBusinessIdLookupOnly([GYM_A_ROW]);
  try {
    const req = receiveRequest({ "tara-webhook-secret": "wrong-secret" }, {
      businessId: "biz1",
      paymentId: "pay1",
      status: "SUCCESS",
    });
    const res = await handler.fetch(req);
    assertEquals(res.status, 401);
    assertEquals(stub.writeCallsCount(), 0, "signature verification must fail before any DB write");
  } finally {
    stub.restore();
  }
});

Deno.test("payment-webhook taramoney receive route: equal-length wrong-value signature returns 401 and makes no DB write", async () => {
  const stub = stubFetchServingBusinessIdLookupOnly([GYM_A_ROW]);
  try {
    const req = receiveRequest({ "tara-webhook-secret": "x".repeat(SECRET.length) }, {
      businessId: "biz1",
      paymentId: "pay1",
      status: "SUCCESS",
    });
    const res = await handler.fetch(req);
    assertEquals(res.status, 401);
    assertEquals(stub.writeCallsCount(), 0, "signature verification must fail before any DB write");
  } finally {
    stub.restore();
  }
});

Deno.test("payment-webhook taramoney receive route: missing signature header returns 401 and makes no DB write", async () => {
  const stub = stubFetchServingBusinessIdLookupOnly([GYM_A_ROW]);
  try {
    const req = receiveRequest({}, { businessId: "biz1", paymentId: "pay1", status: "SUCCESS" });
    const res = await handler.fetch(req);
    assertEquals(res.status, 401);
    assertEquals(stub.writeCallsCount(), 0, "signature verification must fail before any DB write");
  } finally {
    stub.restore();
  }
});

Deno.test("payment-webhook taramoney receive route: malformed JSON body with a correct header returns 401 and makes no DB call at all (not even the businessId lookup -- can't parse a businessId out of it)", async () => {
  const { calls, restore } = stubFetchNoCallsExpected();
  try {
    const req = new Request("https://example.com/functions/v1/payment-webhook/taramoney", {
      method: "POST",
      headers: { "tara-webhook-secret": SECRET },
      body: "{not valid json",
    });
    const res = await handler.fetch(req);
    assertEquals(res.status, 401);
    assertEquals(calls.length, 0, "a malformed payload must fail before any DB access, including the businessId lookup");
  } finally {
    restore();
  }
});

Deno.test("payment-webhook taramoney receive route: a correctly-signed delivery resolved to gym A never completes a matched payment that actually belongs to gym B (review finding -- synchronous cross-tenant guard)", async () => {
  const stub = stubFetchFullFlow([GYM_A_ROW], { id: "payment-1", gym_id: "gym-b" });
  try {
    const req = receiveRequest({ "tara-webhook-secret": SECRET }, {
      businessId: "biz1",
      paymentId: "pay1",
      status: "SUCCESS",
      amount: "5000",
    });
    const res = await handler.fetch(req);
    assertEquals(res.status, 200);
    assertEquals(
      stub.completeVerifiedPaymentCalled(),
      false,
      "a signature-verified delivery for gym A must never complete a payment matched to a different gym",
    );
  } finally {
    stub.restore();
  }
});

Deno.test("payment-webhook taramoney receive route: a correctly-signed delivery resolved to gym A completes a matched payment that also belongs to gym A", async () => {
  const stub = stubFetchFullFlow([GYM_A_ROW], { id: "payment-1", gym_id: "gym-a" });
  try {
    const req = receiveRequest({ "tara-webhook-secret": SECRET }, {
      businessId: "biz1",
      paymentId: "pay1",
      status: "SUCCESS",
      amount: "5000",
    });
    const res = await handler.fetch(req);
    assertEquals(res.status, 200);
    assertEquals(
      stub.completeVerifiedPaymentCalled(),
      true,
      "a signature-verified delivery must still complete a payment matched to the same gym it resolved to",
    );
  } finally {
    stub.restore();
  }
});

Deno.test("payment-webhook taramoney receive route: unrecognized businessId (zero rows from the lookup) returns 401 and makes no DB write", async () => {
  const stub = stubFetchServingBusinessIdLookupOnly([]);
  try {
    const req = receiveRequest({ "tara-webhook-secret": SECRET }, {
      businessId: "unknown-business-id",
      paymentId: "pay1",
      status: "SUCCESS",
    });
    const res = await handler.fetch(req);
    assertEquals(res.status, 401);
    assertEquals(stub.writeCallsCount(), 0, "an unresolvable businessId must fail before any DB write");
  } finally {
    stub.restore();
  }
});

// --- payment-webhook receive route: platform path (Story 11.1, Flow B, Task 3) ----------------

const PLATFORM_BUSINESS_ID = "platform-biz-id";
const PLATFORM_SECRET = "test-taramoney-platform-webhook-secret";

// Mirrors TaraMoneyProvider.test.ts's own withPlatformEnv -- awaits fn()
// before restoring the env vars, since fn()'s real work happens after its
// first `await` (the gym-lookup RPC call).
async function withPlatformEnv<T>(fn: () => Promise<T>): Promise<T> {
  const priorBusinessId = Deno.env.get("TARAMONEY_BUSINESS_ID");
  const priorSecret = Deno.env.get("TARAMONEY_WEBHOOK_SECRET");
  Deno.env.set("TARAMONEY_BUSINESS_ID", PLATFORM_BUSINESS_ID);
  Deno.env.set("TARAMONEY_WEBHOOK_SECRET", PLATFORM_SECRET);
  try {
    return await fn();
  } finally {
    if (priorBusinessId === undefined) Deno.env.delete("TARAMONEY_BUSINESS_ID");
    else Deno.env.set("TARAMONEY_BUSINESS_ID", priorBusinessId);
    if (priorSecret === undefined) Deno.env.delete("TARAMONEY_WEBHOOK_SECRET");
    else Deno.env.set("TARAMONEY_WEBHOOK_SECRET", priorSecret);
  }
}

/**
 * Serves a full platform-path receive-route flow past signature verification: the gym-lookup RPC
 * (zero rows -- forces the platform-match branch), a `saas_billing_payments` select returning
 * `saasPaymentRow`, and a `payment_webhook_events` upsert -- then records whether
 * `complete_verified_saas_billing_payment`/`complete_flagged_saas_billing_payment` were called,
 * and captures the payment_webhook_events upsert body so a test can assert
 * matched_saas_billing_payment_id (not matched_payment_id) was written.
 */
function stubFetchPlatformFullFlow(saasPaymentRow: { id: string } | null) {
  const calls: string[] = [];
  let completeVerifiedCalled = false;
  let completeFlaggedCalled = false;
  let eventLogBody: Record<string, unknown> | undefined;
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    calls.push(href);
    if (href.includes("/rest/v1/rpc/get_gym_payment_credentials_by_business_id")) {
      return Promise.resolve(
        new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } }),
      );
    }
    if (href.includes("/rest/v1/saas_billing_payments?")) {
      return Promise.resolve(
        new Response(JSON.stringify(saasPaymentRow), { status: 200, headers: { "Content-Type": "application/json" } }),
      );
    }
    if (href.includes("/rest/v1/payment_webhook_events")) {
      eventLogBody = init?.body ? JSON.parse(init.body as string) : undefined;
      return Promise.resolve(new Response(null, { status: 201 }));
    }
    if (href.includes("/rest/v1/rpc/complete_verified_saas_billing_payment")) {
      completeVerifiedCalled = true;
      return Promise.resolve(new Response(null, { status: 200 }));
    }
    if (href.includes("/rest/v1/rpc/complete_flagged_saas_billing_payment")) {
      completeFlaggedCalled = true;
      return Promise.resolve(new Response(null, { status: 200 }));
    }
    throw new Error(`stubFetch: unexpected DB access ${href}`);
  }) as typeof fetch;
  return {
    calls,
    completeVerifiedPaymentCalled: () => completeVerifiedCalled,
    completeFlaggedPaymentCalled: () => completeFlaggedCalled,
    eventLogBody: () => eventLogBody,
    restore: () => (globalThis.fetch = original),
  };
}

Deno.test("payment-webhook taramoney receive route: platform path -- a signature-verified platform webhook resolves against saas_billing_payments, logs matched_saas_billing_payment_id, and completes via complete_verified_saas_billing_payment", async () => {
  await withPlatformEnv(async () => {
    const stub = stubFetchPlatformFullFlow({ id: "saas-payment-1" });
    try {
      const req = receiveRequest({ "tara-webhook-secret": PLATFORM_SECRET }, {
        businessId: PLATFORM_BUSINESS_ID,
        paymentId: "pay-platform-1",
        status: "SUCCESS",
        amount: "5000000",
      });
      const res = await handler.fetch(req);
      assertEquals(res.status, 200);
      assertEquals(stub.completeVerifiedPaymentCalled(), true);
      assertEquals(stub.completeFlaggedPaymentCalled(), false);
      assertEquals(stub.eventLogBody()?.matched_saas_billing_payment_id, "saas-payment-1");
      assertEquals(stub.eventLogBody()?.matched_payment_id, undefined, "the platform path must never write matched_payment_id");
    } finally {
      stub.restore();
    }
  });
});

Deno.test("payment-webhook taramoney receive route: platform path -- a status:FAILURE platform webhook calls complete_flagged_saas_billing_payment instead of completing", async () => {
  await withPlatformEnv(async () => {
    const stub = stubFetchPlatformFullFlow({ id: "saas-payment-2" });
    try {
      const req = receiveRequest({ "tara-webhook-secret": PLATFORM_SECRET }, {
        businessId: PLATFORM_BUSINESS_ID,
        paymentId: "pay-platform-2",
        status: "FAILURE",
      });
      const res = await handler.fetch(req);
      assertEquals(res.status, 200);
      assertEquals(stub.completeFlaggedPaymentCalled(), true);
      assertEquals(stub.completeVerifiedPaymentCalled(), false);
    } finally {
      stub.restore();
    }
  });
});

Deno.test("payment-webhook taramoney receive route: platform path -- AC #3(b) analogue -- a verified platform webhook matched no saas_billing_payments row completes nothing and still returns 200", async () => {
  await withPlatformEnv(async () => {
    const stub = stubFetchPlatformFullFlow(null);
    try {
      const req = receiveRequest({ "tara-webhook-secret": PLATFORM_SECRET }, {
        businessId: PLATFORM_BUSINESS_ID,
        paymentId: "pay-platform-3",
        status: "SUCCESS",
        amount: "100",
      });
      const res = await handler.fetch(req);
      assertEquals(res.status, 200);
      assertEquals(stub.completeVerifiedPaymentCalled(), false);
      assertEquals(stub.completeFlaggedPaymentCalled(), false);
      assertEquals(stub.eventLogBody()?.matched_saas_billing_payment_id, null);
    } finally {
      stub.restore();
    }
  });
});

// Story 4.15 Task 3: handleInitiate()'s new kill-switch check. Scoped
// strictly to that check's own short-circuit behavior -- a full
// happy-path/DB-write route-level test suite for handleInitiate() is a
// pre-existing, already-flagged gap (deferred-work.md, Story 4.11 review),
// not something this story is scoped to close.

const INITIATE_PAYMENT_ROW = {
  id: "pay1",
  status: "processing",
  provider_transaction_ref: null,
  amount: 5000,
  currency: "XAF",
  gym_id: "gym-a",
};

function initiateRequest(body: unknown) {
  return new Request("https://example.com/functions/v1/payment-webhook/initiate/taramoney", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Serves the eligibility-check `payments` GET plus the DELETE the
 * kill-switch short-circuit issues to clean up the row it never charged --
 * any other DB access (in particular a call into the provider) throws,
 * failing the test loudly. */
function stubFetchServingPaymentRowOnly(paymentRow: unknown) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    const method = init?.method ?? "GET";
    calls.push(`${method} ${href}`);
    if (href.includes("/rest/v1/payments?") && method === "GET") {
      return Promise.resolve(
        new Response(JSON.stringify(paymentRow), { status: 200, headers: { "Content-Type": "application/json" } }),
      );
    }
    if (href.includes("/rest/v1/payments?") && method === "DELETE") {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    throw new Error(`stubFetch: unexpected DB access ${method} ${href}`);
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

/**
 * Serves the eligibility-check `payments` GET plus everything
 * TaraMoneyProvider.initiate()'s gym-credential-lookup branch touches when
 * the gym has no connected credentials (an empty `get_gym_payment_credentials_for_service`
 * result) -- used to prove the enabled path actually reaches the provider,
 * rather than stubbing a full real Tara Money API call.
 */
function stubFetchEnabledPathReachesProvider(paymentRow: unknown) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    const method = init?.method ?? "GET";
    calls.push(`${method} ${href}`);
    if (href.includes("/rest/v1/payments?") && method === "GET") {
      return Promise.resolve(
        new Response(JSON.stringify(paymentRow), { status: 200, headers: { "Content-Type": "application/json" } }),
      );
    }
    if (href.includes("/rest/v1/payments?") && method === "DELETE") {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (href.includes("/rest/v1/rpc/get_gym_payment_credentials_for_service")) {
      return Promise.resolve(
        new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } }),
      );
    }
    if (href.includes("/rest/v1/rpc/mark_gym_payment_credentials_needs_attention")) {
      return Promise.resolve(new Response(null, { status: 200 }));
    }
    throw new Error(`stubFetch: unexpected DB access ${method} ${href}`);
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

Deno.test("payment-webhook taramoney initiate route: TARAMONEY_INITIATION_ENABLED=false short-circuits before the provider is ever called, and cleans up the payment row (review finding)", async () => {
  Deno.env.set("TARAMONEY_INITIATION_ENABLED", "false");
  const stub = stubFetchServingPaymentRowOnly(INITIATE_PAYMENT_ROW);
  try {
    const req = initiateRequest({ paymentId: "pay1", phoneNumber: "237600000000" });
    const res = await handler.fetch(req);
    assertEquals(res.status, 502);
    const body = await res.json();
    assertEquals(body.code, "mobile_money_disabled");
    assertEquals(
      stub.calls.some((c) => c.startsWith("DELETE") && c.includes("/rest/v1/payments?")),
      true,
      "the disabled short-circuit must delete the payment row, same as every other rejection branch",
    );
  } finally {
    stub.restore();
    Deno.env.delete("TARAMONEY_INITIATION_ENABLED");
  }
});

Deno.test("payment-webhook taramoney initiate route: TARAMONEY_INITIATION_ENABLED unset reaches the provider -- the kill switch does not block the default-enabled path", async () => {
  const stub = stubFetchEnabledPathReachesProvider(INITIATE_PAYMENT_ROW);
  try {
    const req = initiateRequest({ paymentId: "pay1", phoneNumber: "237600000000" });
    const res = await handler.fetch(req);
    assertEquals(res.status, 502);
    const body = await res.json();
    assertEquals(
      body.code,
      "gym_credentials_unavailable",
      "an unset kill switch must reach the provider, not short-circuit as mobile_money_disabled",
    );
  } finally {
    stub.restore();
  }
});

// --- payment-webhook initiate route: Flow B fallback (Story 11.3, Task 5) ----------------------

const INITIATE_SAAS_PAYMENT_ROW = {
  id: "saas-pay1",
  status: "processing",
  provider_transaction_ref: null,
  amount: 8000,
  currency: "XAF",
};

/**
 * Serves a `payments` lookup that finds nothing (the fallback trigger),
 * then a `saas_billing_payments` lookup returning `saasPaymentRow`, then
 * whatever TaraMoneyProvider.initiate()'s platform branch touches --
 * TARAMONEY_API_KEY/BUSINESS_ID are asserted unset by the caller, so
 * initiate() never makes a further DB/RPC call, returning
 * `credentials_not_connected` directly. Also serves the
 * `saas_billing_payments` DELETE the failed-initiate cleanup issues, and
 * would throw on a `mark_gym_payment_credentials_needs_attention` call --
 * that RPC is gym-only and must never be reached for a platform payment.
 */
function stubFetchSaasFallbackFlow(saasPaymentRow: unknown) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    const method = init?.method ?? "GET";
    calls.push(`${method} ${href}`);
    if (href.includes("/rest/v1/payments?") && method === "GET") {
      return Promise.resolve(new Response(JSON.stringify(null), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (href.includes("/rest/v1/saas_billing_payments?") && method === "GET") {
      return Promise.resolve(
        new Response(JSON.stringify(saasPaymentRow), { status: 200, headers: { "Content-Type": "application/json" } }),
      );
    }
    if (href.includes("/rest/v1/saas_billing_payments?") && method === "DELETE") {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    throw new Error(`stubFetch: unexpected DB access ${method} ${href}`);
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

Deno.test("payment-webhook taramoney initiate route: a saas_billing_payments-only paymentId (no matching payments row) resolves via the fallback and constructs the platform routing context", async () => {
  const priorApiKey = Deno.env.get("TARAMONEY_API_KEY");
  const priorBusinessId = Deno.env.get("TARAMONEY_BUSINESS_ID");
  Deno.env.delete("TARAMONEY_API_KEY");
  Deno.env.delete("TARAMONEY_BUSINESS_ID");
  const stub = stubFetchSaasFallbackFlow(INITIATE_SAAS_PAYMENT_ROW);
  try {
    const req = initiateRequest({ paymentId: "saas-pay1", phoneNumber: "237600000000" });
    const res = await handler.fetch(req);
    assertEquals(res.status, 502);
    const body = await res.json();
    // No `code` field -- the platform branch's own credentials_not_connected
    // never maps to gym_credentials_unavailable (that mapping, and its
    // mark_gym_payment_credentials_needs_attention RPC call, is gym-only;
    // stubFetchSaasFallbackFlow would have thrown if that RPC were reached).
    assertEquals(body.code, undefined);
    assertEquals(
      stub.calls.some((c) => c.startsWith("GET") && c.includes("/rest/v1/payments?")),
      true,
      "the payments table must still be tried first",
    );
    assertEquals(
      stub.calls.some((c) => c.startsWith("GET") && c.includes("/rest/v1/saas_billing_payments?")),
      true,
      "the saas_billing_payments fallback lookup must be attempted after the payments miss",
    );
    assertEquals(
      stub.calls.some((c) => c.startsWith("DELETE") && c.includes("/rest/v1/saas_billing_payments?")),
      true,
      "cleanup on a failed initiate must delete from the table the row was actually found in (saas_billing_payments), not payments",
    );
    assertEquals(
      stub.calls.some((c) => c.startsWith("DELETE") && c.includes("/rest/v1/payments?")),
      false,
      "cleanup must never delete from payments for a row that was never found there",
    );
  } finally {
    stub.restore();
    if (priorApiKey === undefined) Deno.env.delete("TARAMONEY_API_KEY");
    else Deno.env.set("TARAMONEY_API_KEY", priorApiKey);
    if (priorBusinessId === undefined) Deno.env.delete("TARAMONEY_BUSINESS_ID");
    else Deno.env.set("TARAMONEY_BUSINESS_ID", priorBusinessId);
  }
});

Deno.test("payment-webhook taramoney initiate route: regression -- a payments row found on the first lookup never attempts the saas_billing_payments fallback", async () => {
  const stub = stubFetchEnabledPathReachesProvider(INITIATE_PAYMENT_ROW);
  try {
    const req = initiateRequest({ paymentId: "pay1", phoneNumber: "237600000000" });
    const res = await handler.fetch(req);
    assertEquals(res.status, 502);
    const body = await res.json();
    assertEquals(body.code, "gym_credentials_unavailable", "the existing gym-routing path is completely unchanged");
    assertEquals(
      stub.calls.some((c) => c.includes("/rest/v1/saas_billing_payments?")),
      false,
      "a payments-table hit on the first lookup must never attempt the saas_billing_payments fallback lookup",
    );
  } finally {
    stub.restore();
  }
});

// --- payment-webhook initiate-link route (Story 11.7, AC #3) -----------------------------------

const INITIATE_LINK_SAAS_PAYMENT_ROW = {
  id: "saas-pay-link-1",
  status: "processing",
  provider_transaction_ref: null,
  amount: 8000,
  currency: "XAF",
  gym_id: null,
};

function initiateLinkRequest(body: unknown) {
  return new Request("https://example.com/functions/v1/payment-webhook/initiate-link/taramoney", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function stubFetchInitiateLinkFlow(paymentsRow: unknown, saasRow: unknown) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    const method = init?.method ?? "GET";
    calls.push(`${method} ${href}`);
    if (href.includes("/rest/v1/payments?") && method === "GET") {
      return Promise.resolve(
        new Response(JSON.stringify(paymentsRow), { status: 200, headers: { "Content-Type": "application/json" } }),
      );
    }
    if (href.includes("/rest/v1/saas_billing_payments?") && method === "GET") {
      return Promise.resolve(
        new Response(JSON.stringify(saasRow), { status: 200, headers: { "Content-Type": "application/json" } }),
      );
    }
    throw new Error(`stubFetch: unexpected DB access ${method} ${href}`);
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

Deno.test("payment-webhook taramoney initiate-link route: a processing saas_billing_payments row succeeds, returns checkoutUrl, no phoneNumber required, never writes provider_transaction_ref", async () => {
  await withPlatformEnv(async () => {
    const stub = stubFetchInitiateLinkFlow(null, INITIATE_LINK_SAAS_PAYMENT_ROW);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
      const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      if (href.includes("dklo.co")) {
        return Promise.resolve(
          new Response(JSON.stringify({ generalLink: "https://pay.taramoney.com/link/xyz" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return (originalFetch as typeof fetch)(url as never, init);
    }) as typeof fetch;

    try {
      const req = initiateLinkRequest({ paymentId: "saas-pay-link-1" });
      const res = await handler.fetch(req);
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.checkoutUrl, "https://pay.taramoney.com/link/xyz");
      assertEquals(
        stub.calls.some((c) => c.startsWith("PATCH") || (c.startsWith("PUT") && c.includes("provider_transaction_ref"))),
        false,
        "initiate-link never persists provider_transaction_ref up front -- no transaction exists yet",
      );
    } finally {
      globalThis.fetch = originalFetch;
      stub.restore();
    }
  });
});

Deno.test("payment-webhook taramoney initiate-link route: a non-processing payment is rejected with 400, no provider call attempted", async () => {
  const stub = stubFetchInitiateLinkFlow(null, { ...INITIATE_LINK_SAAS_PAYMENT_ROW, status: "verified" });
  try {
    const req = initiateLinkRequest({ paymentId: "saas-pay-link-1" });
    const res = await handler.fetch(req);
    assertEquals(res.status, 400);
  } finally {
    stub.restore();
  }
});

Deno.test("payment-webhook taramoney initiate-link route: a missing paymentId is rejected with 400 before any DB call", async () => {
  const stub = stubFetchNoCallsExpected();
  try {
    const req = initiateLinkRequest({});
    const res = await handler.fetch(req);
    assertEquals(res.status, 400);
    assertEquals(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

// --- payment-webhook receive route: platform path, payment-link id fallback (Story 11.7) -------
//
// CONFIRMED live against the real 9FmIZg9GBB account (2026-08-30, a real
// WhatsApp-completed payment-link payment). The real captured webhook body
// was: {"businessId":"9FmIZg9GBB","paymentId":"<our own createHostedCheckoutLink()
// productId>","collectionId":"<Tara's own numeric order id>","creationDate":"...",
// "changeDate":"...","status":"SUCCESS"} -- no `productId` field at all (an
// earlier version of this fallback matched on `event.reference`, which reads
// `rawPayload.productId` and would therefore never have fired for this real
// shape), no `amount`/`phoneNumber`/`mobileOperator` either. The webhook's
// own `paymentId` -- already mapped to `event.providerTransactionRef` by
// `normalizeTaraMoneyWebhook()` -- directly echoes back whatever *we* sent
// as `productId` (the payment's own `saas_billing_payments.id`), so the
// fallback matches by `id`, not by a separate `reference` field.

/**
 * A payment-link-originated row has provider_transaction_ref = null at
 * webhook time -- the primary lookup (by provider_transaction_ref) always
 * misses for it. Serves: primary lookup (0 rows), fallback lookup by id
 * (the row), the PATCH that persists the now-learned
 * provider_transaction_ref, the payment_webhook_events upsert, and the
 * completion RPC.
 */
function stubFetchPlatformLinkFallbackFlow(linkRow: { id: string } | null) {
  const calls: string[] = [];
  let completeVerifiedCalled = false;
  let patchedRefTo: string | undefined;
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    const method = init?.method ?? "GET";
    calls.push(`${method} ${href}`);
    if (href.includes("/rest/v1/rpc/get_gym_payment_credentials_by_business_id")) {
      return Promise.resolve(
        new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } }),
      );
    }
    if (href.includes("/rest/v1/saas_billing_payments?") && href.includes("provider_transaction_ref=eq.") && method === "GET") {
      // Primary lookup -- always a miss for a link-originated payment.
      return Promise.resolve(new Response(JSON.stringify(null), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (href.includes("/rest/v1/saas_billing_payments?") && href.includes("id=eq.") && method === "GET") {
      // Fallback lookup by id, provider_transaction_ref is.null.
      return Promise.resolve(
        new Response(JSON.stringify(linkRow), { status: 200, headers: { "Content-Type": "application/json" } }),
      );
    }
    if (href.includes("/rest/v1/saas_billing_payments?") && method === "PATCH") {
      patchedRefTo = init?.body ? (JSON.parse(init.body as string).provider_transaction_ref as string) : undefined;
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (href.includes("/rest/v1/payment_webhook_events")) {
      return Promise.resolve(new Response(null, { status: 201 }));
    }
    if (href.includes("/rest/v1/rpc/complete_verified_saas_billing_payment")) {
      completeVerifiedCalled = true;
      return Promise.resolve(new Response(null, { status: 200 }));
    }
    throw new Error(`stubFetch: unexpected DB access ${method} ${href}`);
  }) as typeof fetch;
  return {
    calls,
    completeVerifiedPaymentCalled: () => completeVerifiedCalled,
    patchedRefTo: () => patchedRefTo,
    restore: () => (globalThis.fetch = original),
  };
}

Deno.test("payment-webhook taramoney receive route: platform path -- the real payment-link webhook shape (no productId field, paymentId IS our own reference) is matched via the id fallback and completes", async () => {
  await withPlatformEnv(async () => {
    const stub = stubFetchPlatformLinkFallbackFlow({ id: "saas-pay-link-1" });
    try {
      // Exact shape of the real 2026-08-30 captured webhook (see the
      // header comment above), with paymentId/collectionId swapped to this
      // test's own fixture id -- no productId, no amount, no phoneNumber.
      const req = receiveRequest({ "tara-webhook-secret": PLATFORM_SECRET }, {
        businessId: PLATFORM_BUSINESS_ID,
        paymentId: "saas-pay-link-1",
        collectionId: "589124990",
        creationDate: "2026-08-30T21:34:37.514-03:00",
        changeDate: "2026-08-30T21:34:37.514-03:00",
        status: "SUCCESS",
      });
      const res = await handler.fetch(req);
      assertEquals(res.status, 200);
      assertEquals(stub.completeVerifiedPaymentCalled(), true);
      assertEquals(stub.patchedRefTo(), "saas-pay-link-1", "provider_transaction_ref is persisted to the same value as the row's own id");
    } finally {
      stub.restore();
    }
  });
});

Deno.test("payment-webhook taramoney receive route: platform path -- a genuine miss (both primary and fallback lookups empty) completes nothing, still returns 200", async () => {
  await withPlatformEnv(async () => {
    const stub = stubFetchPlatformLinkFallbackFlow(null);
    try {
      const req = receiveRequest({ "tara-webhook-secret": PLATFORM_SECRET }, {
        businessId: PLATFORM_BUSINESS_ID,
        paymentId: "no-such-payment-anywhere",
        status: "SUCCESS",
      });
      const res = await handler.fetch(req);
      assertEquals(res.status, 200);
      assertEquals(stub.completeVerifiedPaymentCalled(), false);
      assertEquals(
        stub.calls.filter((c) => c.includes("/rest/v1/saas_billing_payments?") && !c.startsWith("PATCH")).length,
        2,
        "both the primary and the id-fallback lookup are attempted unconditionally when the primary misses",
      );
    } finally {
      stub.restore();
    }
  });
});

Deno.test("payment-webhook taramoney receive route: platform path -- a direct mobile-money webhook's own numeric providerTransactionRef never spuriously matches the id fallback", async () => {
  await withPlatformEnv(async () => {
    // stubFetchPlatformFullFlow serves the primary lookup with a real hit
    // (a direct mobile-money-flow payment, matched by provider_transaction_ref)
    // -- the id fallback must never even be attempted once the primary
    // lookup already succeeds.
    const stub = stubFetchPlatformFullFlow({ id: "saas-payment-direct-1" });
    try {
      const req = receiveRequest({ "tara-webhook-secret": PLATFORM_SECRET }, {
        businessId: PLATFORM_BUSINESS_ID,
        paymentId: "165126343",
        status: "SUCCESS",
        amount: "8000",
      });
      const res = await handler.fetch(req);
      assertEquals(res.status, 200);
      assertEquals(stub.completeVerifiedPaymentCalled(), true);
      assertEquals(
        stub.calls.filter((c) => c.includes("/rest/v1/saas_billing_payments?")).length,
        1,
        "a primary-lookup hit never attempts the id fallback",
      );
    } finally {
      stub.restore();
    }
  });
});
