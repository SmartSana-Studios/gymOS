// Deno test suite for TaraMoneyProvider (Story 4.11's webhook signature
// verification tests, restructured for Story 4.14's per-gym credential
// routing).
//
// Story 4.14: verifyWebhookSignature() and initiate() are no longer pure --
// both need a DB round-trip via the injected Supabase client (Task 2's new
// service-role-only RPCs) to resolve a gym's credentials. This file injects
// a small mock client (`rpc()` only, matching the two RPCs this provider
// actually calls) instead of setting TARAMONEY_WEBHOOK_SECRET/
// TARAMONEY_API_KEY env vars the way Story 4.11's version of this file did
// -- those env vars now only back the unused {type:"platform"} branch.
//
// Run: deno test --allow-env supabase/functions/payment-webhook/_shared/payment-providers/TaraMoneyProvider.test.ts

import { assertEquals, assertRejects } from "jsr:@std/assert@^1";
import type { SupabaseClient } from "@supabase/supabase-js";

import { TaraMoneyProvider, normalizeTaraMoneyWebhook } from "./TaraMoneyProvider.ts";

const SECRET = "test-taramoney-webhook-secret";

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

interface RpcResponse {
  data: unknown;
  error: { message: string } | null;
}

/**
 * A minimal mock Supabase client exposing only `rpc()` -- the sole surface
 * TaraMoneyProvider actually calls. `responses` maps RPC function name to a
 * canned response; a call to an unconfigured function name fails loudly
 * (rather than silently returning undefined) so a test that forgets to mock
 * a call it actually exercises fails clearly instead of masking a bug.
 */
function makeMockSupabase(responses: Record<string, RpcResponse>): { supabase: SupabaseClient; calls: RpcCall[] } {
  const calls: RpcCall[] = [];
  const supabase = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      const response = responses[fn];
      if (!response) {
        return Promise.resolve({ data: null, error: { message: `no mock response configured for rpc "${fn}"` } });
      }
      return Promise.resolve(response);
    },
  } as unknown as SupabaseClient;
  return { supabase, calls };
}

function headers(secret: string | undefined): Record<string, string> {
  return secret === undefined ? {} : { "tara-webhook-secret": secret };
}

const GYM_A_ROW = { gym_id: "gym-a", api_key: "key-a", business_id: "biz1", webhook_secret: SECRET };

function providerWithByBusinessIdResponse(response: RpcResponse) {
  const { supabase, calls } = makeMockSupabase({ get_gym_payment_credentials_by_business_id: response });
  return { provider: new TaraMoneyProvider(supabase), calls };
}

// --- verifyWebhookSignature: correctness with a resolved gym secret (AC #1, #2) --------------

Deno.test("verifyWebhookSignature: valid header + valid payload + matching gym row returns valid:true with correctly normalized fields", async () => {
  const { provider } = providerWithByBusinessIdResponse({ data: [GYM_A_ROW], error: null });
  const payload = JSON.stringify({
    businessId: "biz1",
    paymentId: "pay1",
    amount: "100",
    originalAmount: "90",
    mobileOperator: "MTN_CAMEROON",
    collectionId: "pay1",
    phoneNumber: "237600000000",
    creationDate: "2026-08-17T00:00:00.000-03:00",
    changeDate: "2026-08-17T00:00:00.000-03:00",
    status: "SUCCESS",
    productId: "ref1",
    transactionId: "MP-TEST-1",
  });

  const result = await provider.verifyWebhookSignature(payload, headers(SECRET));

  assertEquals(result, {
    valid: true,
    event: {
      providerTransactionRef: "pay1",
      businessId: "biz1",
      resolvedGymId: "gym-a",
      status: "verified",
      amount: 100,
      currency: "XAF",
      reference: "ref1",
      vendor: "mtn_momo",
      feeAmount: 10,
    },
  });
});

Deno.test("verifyWebhookSignature: missing tara-webhook-secret header entirely (gym resolved, header absent) returns valid:false", async () => {
  const { provider } = providerWithByBusinessIdResponse({ data: [GYM_A_ROW], error: null });
  const payload = JSON.stringify({ businessId: "biz1", paymentId: "pay1", status: "SUCCESS" });
  const result = await provider.verifyWebhookSignature(payload, headers(undefined));
  assertEquals(result, { valid: false });
});

Deno.test("verifyWebhookSignature: wrong-value tara-webhook-secret header (gym resolved, header incorrect) returns valid:false", async () => {
  const { provider } = providerWithByBusinessIdResponse({ data: [GYM_A_ROW], error: null });
  const payload = JSON.stringify({ businessId: "biz1", paymentId: "pay1", status: "SUCCESS" });
  const result = await provider.verifyWebhookSignature(payload, headers("not-the-real-secret"));
  assertEquals(result, { valid: false });
});

// The other wrong-value tests all use a header shorter than SECRET, so constantTimeEqual()'s
// length check short-circuits before its byte-comparison loop ever runs. An equal-length wrong
// secret is needed to actually exercise that loop -- the real guard against timing-based secret
// recovery.
Deno.test("verifyWebhookSignature: equal-length wrong-value header still returns valid:false (exercises constantTimeEqual's byte loop)", async () => {
  const { provider } = providerWithByBusinessIdResponse({ data: [GYM_A_ROW], error: null });
  const payload = JSON.stringify({ businessId: "biz1", paymentId: "pay1", status: "SUCCESS" });
  const wrongSameLength = "x".repeat(SECRET.length);
  const result = await provider.verifyWebhookSignature(payload, headers(wrongSameLength));
  assertEquals(result, { valid: false });
});

// --- verifyWebhookSignature: businessId resolution (Story 4.14's new design) ------------------

Deno.test("verifyWebhookSignature: unrecognized businessId (zero rows from the lookup RPC) returns valid:false, no header comparison attempted", async () => {
  const { provider, calls } = providerWithByBusinessIdResponse({ data: [], error: null });
  const payload = JSON.stringify({ businessId: "unknown-business-id", paymentId: "pay1", status: "SUCCESS" });

  const result = await provider.verifyWebhookSignature(payload, headers(SECRET));

  assertEquals(result, { valid: false });
  assertEquals(calls.length, 1, "the businessId lookup itself is a legitimate read, expected once");
  assertEquals(calls[0], {
    fn: "get_gym_payment_credentials_by_business_id",
    args: { p_business_id: "unknown-business-id", p_provider_key: "taramoney" },
  });
});

Deno.test("verifyWebhookSignature: a lookup RPC error (fail closed) returns valid:false", async () => {
  const { provider } = providerWithByBusinessIdResponse({ data: null, error: { message: "db unreachable" } });
  const payload = JSON.stringify({ businessId: "biz1", paymentId: "pay1", status: "SUCCESS" });
  const result = await provider.verifyWebhookSignature(payload, headers(SECRET));
  assertEquals(result, { valid: false });
});

// The true cross-tenant forgery case (Story 4.10's review finding, closed by this story's design):
// a header carrying gym A's real secret, replayed against gym B's businessId. Under the old
// single-global-secret design this verified successfully (see Story 4.11's version of this file);
// under this story's per-gym design, the businessId lookup resolves gym B's own secret, which the
// header (gym A's) does not match.
Deno.test("verifyWebhookSignature: a valid header for one gym replayed against a different gym's businessId is rejected (cross-tenant forgery closed)", async () => {
  const GYM_B_ROW = { gym_id: "gym-b", api_key: "key-b", business_id: "some-other-gyms-business-id", webhook_secret: "gym-b-secret" };
  const { provider } = providerWithByBusinessIdResponse({ data: [GYM_B_ROW], error: null });
  const payload = JSON.stringify({
    businessId: "some-other-gyms-business-id",
    paymentId: "pay-cross-tenant",
    status: "SUCCESS",
    amount: "100",
  });

  // SECRET is gym A's real secret -- a forged/replayed header, not gym B's own secret.
  const result = await provider.verifyWebhookSignature(payload, headers(SECRET));

  assertEquals(result, { valid: false });
});

// --- verifyWebhookSignature: malformed/structurally invalid payloads (no DB call at all) ------

Deno.test("verifyWebhookSignature: malformed JSON body returns valid:false and never calls the lookup RPC", async () => {
  const { provider, calls } = providerWithByBusinessIdResponse({ data: [GYM_A_ROW], error: null });
  const result = await provider.verifyWebhookSignature("{not valid json", headers(SECRET));
  assertEquals(result, { valid: false });
  assertEquals(calls.length, 0, "a malformed payload must fail before any DB read");
});

Deno.test("verifyWebhookSignature: structurally invalid payload (missing businessId) returns valid:false and never calls the lookup RPC", async () => {
  const { provider, calls } = providerWithByBusinessIdResponse({ data: [GYM_A_ROW], error: null });
  const payload = JSON.stringify({ paymentId: "pay1", status: "SUCCESS" });
  const result = await provider.verifyWebhookSignature(payload, headers(SECRET));
  assertEquals(result, { valid: false });
  assertEquals(calls.length, 0);
});

Deno.test("verifyWebhookSignature: structurally invalid payload (missing paymentId) returns valid:false and never calls the lookup RPC", async () => {
  const { provider, calls } = providerWithByBusinessIdResponse({ data: [GYM_A_ROW], error: null });
  const payload = JSON.stringify({ businessId: "biz1", status: "SUCCESS" });
  const result = await provider.verifyWebhookSignature(payload, headers(SECRET));
  assertEquals(result, { valid: false });
  assertEquals(calls.length, 0);
});

Deno.test("verifyWebhookSignature: structurally invalid payload (missing status) returns valid:false and never calls the lookup RPC", async () => {
  const { provider, calls } = providerWithByBusinessIdResponse({ data: [GYM_A_ROW], error: null });
  const payload = JSON.stringify({ businessId: "biz1", paymentId: "pay1" });
  const result = await provider.verifyWebhookSignature(payload, headers(SECRET));
  assertEquals(result, { valid: false });
  assertEquals(calls.length, 0);
});

Deno.test("verifyWebhookSignature: status outside {SUCCESS, FAILURE} returns valid:false and never calls the lookup RPC", async () => {
  const { provider, calls } = providerWithByBusinessIdResponse({ data: [GYM_A_ROW], error: null });
  const payload = JSON.stringify({ businessId: "biz1", paymentId: "pay1", status: "PENDING" });
  const result = await provider.verifyWebhookSignature(payload, headers(SECRET));
  assertEquals(result, { valid: false });
  assertEquals(calls.length, 0);
});

// --- verifyWebhookSignature: amount parsing (gym resolved, header correct) --------------------

Deno.test("verifyWebhookSignature: negative amount fails closed, returns valid:false", async () => {
  const { provider } = providerWithByBusinessIdResponse({ data: [GYM_A_ROW], error: null });
  const payload = JSON.stringify({ businessId: "biz1", paymentId: "pay1", status: "SUCCESS", amount: "-5" });
  const result = await provider.verifyWebhookSignature(payload, headers(SECRET));
  assertEquals(result, { valid: false });
});

Deno.test("verifyWebhookSignature: unparseable (non-numeric) amount fails closed, returns valid:false", async () => {
  const { provider } = providerWithByBusinessIdResponse({ data: [GYM_A_ROW], error: null });
  const payload = JSON.stringify({ businessId: "biz1", paymentId: "pay1", status: "SUCCESS", amount: "not-a-number" });
  const result = await provider.verifyWebhookSignature(payload, headers(SECRET));
  assertEquals(result, { valid: false });
});

Deno.test("verifyWebhookSignature: amount entirely absent defaults to 0 and still verifies", async () => {
  const { provider } = providerWithByBusinessIdResponse({ data: [GYM_A_ROW], error: null });
  const payload = JSON.stringify({ businessId: "biz1", paymentId: "pay1", status: "SUCCESS" });
  const result = await provider.verifyWebhookSignature(payload, headers(SECRET));
  assertEquals(result, {
    valid: true,
    event: {
      providerTransactionRef: "pay1",
      businessId: "biz1",
      resolvedGymId: "gym-a",
      status: "verified",
      amount: 0,
      currency: "XAF",
      reference: undefined,
      vendor: undefined,
      feeAmount: undefined,
    },
  });
});

Deno.test("verifyWebhookSignature: status FAILURE normalizes to event.status 'flagged'", async () => {
  const { provider } = providerWithByBusinessIdResponse({ data: [GYM_A_ROW], error: null });
  const payload = JSON.stringify({ businessId: "biz1", paymentId: "pay1", status: "FAILURE", amount: "100" });
  const result = await provider.verifyWebhookSignature(payload, headers(SECRET));
  assertEquals(result, {
    valid: true,
    event: {
      providerTransactionRef: "pay1",
      businessId: "biz1",
      resolvedGymId: "gym-a",
      status: "flagged",
      amount: 100,
      currency: "XAF",
      reference: undefined,
      vendor: undefined,
      feeAmount: undefined,
    },
  });
});

// --- normalizeTaraMoneyWebhook: pure-function coverage, unaffected by the RPC redesign --------

Deno.test("normalizeTaraMoneyWebhook: mobileOperator that is neither ORANGE nor MTN normalizes to a snake_case vendor token", () => {
  const event = normalizeTaraMoneyWebhook({
    businessId: "biz1",
    paymentId: "pay1",
    status: "SUCCESS",
    mobileOperator: "WAVE Senegal",
  });
  assertEquals(event?.vendor, "wave_senegal");
});

Deno.test("normalizeTaraMoneyWebhook: mobileOperator with no alphanumeric characters normalizes to undefined vendor, not an empty string", () => {
  const event = normalizeTaraMoneyWebhook({
    businessId: "biz1",
    paymentId: "pay1",
    status: "SUCCESS",
    mobileOperator: "---",
  });
  assertEquals(event?.vendor, undefined);
});

Deno.test("normalizeTaraMoneyWebhook: unparseable originalAmount leaves the event valid with feeAmount undefined, not invalid", () => {
  const event = normalizeTaraMoneyWebhook({
    businessId: "biz1",
    paymentId: "pay1",
    status: "SUCCESS",
    amount: "100",
    originalAmount: "not-a-number",
  });
  assertEquals(event, {
    providerTransactionRef: "pay1",
    businessId: "biz1",
    status: "verified",
    amount: 100,
    currency: "XAF",
    reference: undefined,
    vendor: undefined,
    feeAmount: undefined,
  });
});

Deno.test("normalizeTaraMoneyWebhook: negative (but parseable) originalAmount leaves the event valid with feeAmount undefined", () => {
  const event = normalizeTaraMoneyWebhook({
    businessId: "biz1",
    paymentId: "pay1",
    status: "SUCCESS",
    amount: "100",
    originalAmount: "-5",
  });
  assertEquals(event?.feeAmount, undefined);
  assertEquals(event?.amount, 100);
});

Deno.test("normalizeTaraMoneyWebhook: originalAmount greater than amount leaves feeAmount undefined instead of negative", () => {
  const event = normalizeTaraMoneyWebhook({
    businessId: "biz1",
    paymentId: "pay1",
    status: "SUCCESS",
    amount: "50",
    originalAmount: "60",
  });
  assertEquals(event?.feeAmount, undefined);
  assertEquals(event?.amount, 50);
});

// --- verifyWebhookSignature: real captured webhook deliveries (AC #3) -------------------------

// Real captured payload shape from docs/decisions.md's 2026-07-31 "Real payment orchestration"
// entry (Story 4.2). The real phoneNumber is NOT copied verbatim per the story's Dev Notes --
// replaced with an obviously-fake placeholder of the same format.
Deno.test("verifyWebhookSignature: parses the real 2026-07-31 stand-in-account webhook shape (docs/decisions.md)", async () => {
  const row = { gym_id: "gym-a", api_key: "key-a", business_id: "wxND8vZv5v", webhook_secret: SECRET };
  const { provider } = providerWithByBusinessIdResponse({ data: [row], error: null });
  const payload = JSON.stringify({
    businessId: "wxND8vZv5v",
    paymentId: "643539724",
    amount: "50",
    originalAmount: "48",
    mobileOperator: "ORANGE_CAMEROON",
    collectionId: "643539724",
    phoneNumber: "237600000000",
    status: "SUCCESS",
    productId: "story-4-11-fixture-stand-in",
    transactionId: "MP260731.1244.B72917",
  });

  const result = await provider.verifyWebhookSignature(payload, headers(SECRET));

  assertEquals(result, {
    valid: true,
    event: {
      providerTransactionRef: "643539724",
      businessId: "wxND8vZv5v",
      resolvedGymId: "gym-a",
      status: "verified",
      amount: 50,
      currency: "XAF",
      reference: "story-4-11-fixture-stand-in",
      vendor: "orange_money",
      feeAmount: 2,
    },
  });
});

// Real captured payload shape from docs/decisions.md's 2026-08-13 entry (Story 4.10, real
// GYM OS business account 9FmIZg9GBB).
Deno.test("verifyWebhookSignature: parses the real 2026-08-13 real-account webhook shape (docs/decisions.md)", async () => {
  const row = { gym_id: "gym-a", api_key: "key-a", business_id: "9FmIZg9GBB", webhook_secret: SECRET };
  const { provider } = providerWithByBusinessIdResponse({ data: [row], error: null });
  const payload = JSON.stringify({
    businessId: "9FmIZg9GBB",
    paymentId: "165126343",
    amount: "100",
    originalAmount: "97",
    mobileOperator: "ORANGE_CAMEROON",
    collectionId: "165126343",
    phoneNumber: "237600000000",
    creationDate: "2026-08-13T18:25:33.212-03:00",
    changeDate: "2026-08-13T18:25:33.212-03:00",
    status: "SUCCESS",
    productId: "story-4-10-reverify-1786656261",
    invoiceUrl: "https://www.dklo.co/DkLMRsT/hUfJEgELp?PgeV=165126343",
    transactionId: "MP260813.2224.D34194",
  });

  const result = await provider.verifyWebhookSignature(payload, headers(SECRET));

  assertEquals(result, {
    valid: true,
    event: {
      providerTransactionRef: "165126343",
      businessId: "9FmIZg9GBB",
      resolvedGymId: "gym-a",
      status: "verified",
      amount: 100,
      currency: "XAF",
      reference: "story-4-10-reverify-1786656261",
      vendor: "orange_money",
      feeAmount: 3,
    },
  });
});

// --- initiate(): per-gym credential resolution (Story 4.14, Task 4) ---------------------------

function stubFetchNoCallsExpected() {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = (() => {
    called = true;
    throw new Error("stubFetch: unexpected TaraMoney HTTP call -- initiate() should have failed before reaching it");
  }) as typeof fetch;
  return { wasCalled: () => called, restore: () => (globalThis.fetch = original) };
}

Deno.test("initiate(): a gym with no connected credentials (zero rows) returns a typed credentials_not_connected failure, no HTTP call attempted", async () => {
  const { supabase } = makeMockSupabase({
    get_gym_payment_credentials_for_service: { data: [], error: null },
  });
  const provider = new TaraMoneyProvider(supabase);
  const fetchStub = stubFetchNoCallsExpected();

  try {
    const result = await provider.initiate({
      amount: 100,
      currency: "XAF",
      reference: "ref1",
      callbackUrl: "https://example.com/callback",
      phoneNumber: "237600000000",
      routingContext: { type: "gym", gymId: "gym-a" },
    });

    assertEquals(result, {
      success: false,
      error: "TaraMoney credentials are not connected for this gym",
      code: "credentials_not_connected",
    });
    assertEquals(fetchStub.wasCalled(), false);
  } finally {
    fetchStub.restore();
  }
});

// Review finding: a genuine RPC/DB error (as opposed to a real zero-row "not
// connected" result) must NOT collapse into credentials_not_connected --
// index.ts only flips needs_attention (and writes an audit event) on that
// specific typed code, and a transient infra blip has nothing to do with
// whether the gym's actual credentials are valid. No code at all here, same
// as every other transient provider-call failure this method can return.
Deno.test("initiate(): a gym credentials RPC error (transient DB failure) returns an untyped failure, distinct from credentials_not_connected, no HTTP call attempted", async () => {
  const { supabase } = makeMockSupabase({
    get_gym_payment_credentials_for_service: { data: null, error: { message: "db unreachable" } },
  });
  const provider = new TaraMoneyProvider(supabase);
  const fetchStub = stubFetchNoCallsExpected();

  try {
    const result = await provider.initiate({
      amount: 100,
      currency: "XAF",
      reference: "ref1",
      callbackUrl: "https://example.com/callback",
      phoneNumber: "237600000000",
      routingContext: { type: "gym", gymId: "gym-a" },
    });

    assertEquals(result.success, false);
    assertEquals((result as { code?: string }).code, undefined);
    assertEquals((result as { error: string }).error.includes("db unreachable"), true);
    assertEquals(fetchStub.wasCalled(), false);
  } finally {
    fetchStub.restore();
  }
});

// Review finding: a row found but missing a required credential value
// (apiKey/businessId blank) is also a real "not usable right now" state --
// must get the same typed code as zero rows, not silently proceed to call
// TaraMoney with a blank credential.
Deno.test("initiate(): a gym credentials row with a blank businessId returns a typed credentials_not_connected failure, no HTTP call attempted", async () => {
  const { supabase } = makeMockSupabase({
    get_gym_payment_credentials_for_service: {
      data: [{ api_key: "key-a", business_id: "", webhook_secret: "secret-a" }],
      error: null,
    },
  });
  const provider = new TaraMoneyProvider(supabase);
  const fetchStub = stubFetchNoCallsExpected();

  try {
    const result = await provider.initiate({
      amount: 100,
      currency: "XAF",
      reference: "ref1",
      callbackUrl: "https://example.com/callback",
      phoneNumber: "237600000000",
      routingContext: { type: "gym", gymId: "gym-a" },
    });

    assertEquals(result, {
      success: false,
      error: "TaraMoney credentials are not connected for this gym",
      code: "credentials_not_connected",
    });
    assertEquals(fetchStub.wasCalled(), false);
  } finally {
    fetchStub.restore();
  }
});

// Sanity check that assertRejects stays imported/used -- kept minimal since initiate()'s HTTP
// happy path is out of this story's scope (no prior test coverage existed for it either; only
// the two new gym-routing failure paths above are this story's concern per its own Task 7).
Deno.test("initiate(): a rejected fetch (thrown, not returned) still only happens after credentials resolve successfully", async () => {
  const { supabase } = makeMockSupabase({
    get_gym_payment_credentials_for_service: {
      data: [{ api_key: "key-a", business_id: "biz1", webhook_secret: SECRET }],
      error: null,
    },
  });
  const provider = new TaraMoneyProvider(supabase);
  const original = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("simulated network failure");
  }) as typeof fetch;

  try {
    await assertRejects(() =>
      provider.initiate({
        amount: 100,
        currency: "XAF",
        reference: "ref1",
        callbackUrl: "https://example.com/callback",
        phoneNumber: "237600000000",
        routingContext: { type: "gym", gymId: "gym-a" },
      })
    );
  } finally {
    globalThis.fetch = original;
  }
});
