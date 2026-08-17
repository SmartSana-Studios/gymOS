// Deno test suite for TaraMoneyProvider's webhook signature verification (Story 4.11, Tasks 3-4).
//
// verifyWebhookSignature() and normalizeTaraMoneyWebhook() are pure functions (no network/DB
// access) — this file needs only TARAMONEY_WEBHOOK_SECRET set before import, following
// send-sms-hook/_shared/otp-providers/EvolutionApiProvider.test.ts's pattern of setting env vars
// ahead of a dynamic import (a static top-level import would in any case be hoisted ahead of the
// Deno.env.set calls).
//
// Run: deno test --allow-env supabase/functions/payment-webhook/_shared/payment-providers/TaraMoneyProvider.test.ts

import { assertEquals } from "jsr:@std/assert@^1";

const SECRET = "test-taramoney-webhook-secret";
Deno.env.set("TARAMONEY_WEBHOOK_SECRET", SECRET);

const { TaraMoneyProvider, normalizeTaraMoneyWebhook } = await import("./TaraMoneyProvider.ts");

function headers(secret: string | undefined): Record<string, string> {
  return secret === undefined ? {} : { "tara-webhook-secret": secret };
}

const provider = new TaraMoneyProvider();

// --- Task 3: signature verification correctness (AC #1, #2) ---------------------------------

Deno.test("verifyWebhookSignature: valid header + valid payload returns valid:true with correctly normalized fields", () => {
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

  const result = provider.verifyWebhookSignature(payload, headers(SECRET));

  assertEquals(result, {
    valid: true,
    event: {
      providerTransactionRef: "pay1",
      status: "verified",
      amount: 100,
      currency: "XAF",
      reference: "ref1",
      vendor: "mtn_momo",
      feeAmount: 10,
    },
  });
});

Deno.test("verifyWebhookSignature: missing tara-webhook-secret header entirely returns valid:false", () => {
  const payload = JSON.stringify({ businessId: "biz1", paymentId: "pay1", status: "SUCCESS" });
  const result = provider.verifyWebhookSignature(payload, headers(undefined));
  assertEquals(result, { valid: false });
});

Deno.test("verifyWebhookSignature: wrong-value tara-webhook-secret header (present but incorrect) returns valid:false", () => {
  const payload = JSON.stringify({ businessId: "biz1", paymentId: "pay1", status: "SUCCESS" });
  const result = provider.verifyWebhookSignature(payload, headers("not-the-real-secret"));
  assertEquals(result, { valid: false });
});

// The other wrong-value tests all use a header shorter than SECRET, so constantTimeEqual()'s
// length check (TaraMoneyProvider.ts:103) short-circuits before its byte-comparison loop ever
// runs. An equal-length wrong secret is needed to actually exercise that loop — the real guard
// against timing-based secret recovery.
Deno.test("verifyWebhookSignature: equal-length wrong-value header still returns valid:false (exercises constantTimeEqual's byte loop)", () => {
  const payload = JSON.stringify({ businessId: "biz1", paymentId: "pay1", status: "SUCCESS" });
  const wrongSameLength = "x".repeat(SECRET.length);
  const result = provider.verifyWebhookSignature(payload, headers(wrongSameLength));
  assertEquals(result, { valid: false });
});

// TARAMONEY_WEBHOOK_SECRET missing/empty in the deployment env (the `!expected` branch) is a
// real misconfiguration scenario, not just a bad-request scenario — must still fail closed.
Deno.test("verifyWebhookSignature: unset TARAMONEY_WEBHOOK_SECRET (misconfigured deployment) returns valid:false", () => {
  const payload = JSON.stringify({ businessId: "biz1", paymentId: "pay1", status: "SUCCESS" });
  Deno.env.delete("TARAMONEY_WEBHOOK_SECRET");
  try {
    const result = provider.verifyWebhookSignature(payload, headers(SECRET));
    assertEquals(result, { valid: false });
  } finally {
    Deno.env.set("TARAMONEY_WEBHOOK_SECRET", SECRET);
  }
});

Deno.test("verifyWebhookSignature: malformed JSON body returns valid:false even with a correct header", () => {
  const result = provider.verifyWebhookSignature("{not valid json", headers(SECRET));
  assertEquals(result, { valid: false });
});

Deno.test("verifyWebhookSignature: structurally invalid payload (missing businessId) returns valid:false", () => {
  const payload = JSON.stringify({ paymentId: "pay1", status: "SUCCESS" });
  const result = provider.verifyWebhookSignature(payload, headers(SECRET));
  assertEquals(result, { valid: false });
});

Deno.test("verifyWebhookSignature: structurally invalid payload (missing paymentId) returns valid:false", () => {
  const payload = JSON.stringify({ businessId: "biz1", status: "SUCCESS" });
  const result = provider.verifyWebhookSignature(payload, headers(SECRET));
  assertEquals(result, { valid: false });
});

Deno.test("verifyWebhookSignature: structurally invalid payload (missing status) returns valid:false", () => {
  const payload = JSON.stringify({ businessId: "biz1", paymentId: "pay1" });
  const result = provider.verifyWebhookSignature(payload, headers(SECRET));
  assertEquals(result, { valid: false });
});

Deno.test("verifyWebhookSignature: status outside {SUCCESS, FAILURE} returns valid:false", () => {
  const payload = JSON.stringify({ businessId: "biz1", paymentId: "pay1", status: "PENDING" });
  const result = provider.verifyWebhookSignature(payload, headers(SECRET));
  assertEquals(result, { valid: false });
});

Deno.test("verifyWebhookSignature: negative amount fails closed, returns valid:false", () => {
  const payload = JSON.stringify({ businessId: "biz1", paymentId: "pay1", status: "SUCCESS", amount: "-5" });
  const result = provider.verifyWebhookSignature(payload, headers(SECRET));
  assertEquals(result, { valid: false });
});

Deno.test("verifyWebhookSignature: unparseable (non-numeric) amount fails closed, returns valid:false", () => {
  const payload = JSON.stringify({ businessId: "biz1", paymentId: "pay1", status: "SUCCESS", amount: "not-a-number" });
  const result = provider.verifyWebhookSignature(payload, headers(SECRET));
  assertEquals(result, { valid: false });
});

Deno.test("verifyWebhookSignature: amount entirely absent defaults to 0 and still verifies", () => {
  const payload = JSON.stringify({ businessId: "biz1", paymentId: "pay1", status: "SUCCESS" });
  const result = provider.verifyWebhookSignature(payload, headers(SECRET));
  assertEquals(result, {
    valid: true,
    event: {
      providerTransactionRef: "pay1",
      status: "verified",
      amount: 0,
      currency: "XAF",
      reference: undefined,
      vendor: undefined,
      feeAmount: undefined,
    },
  });
});

Deno.test("verifyWebhookSignature: status FAILURE normalizes to event.status 'flagged'", () => {
  const payload = JSON.stringify({ businessId: "biz1", paymentId: "pay1", status: "FAILURE", amount: "100" });
  const result = provider.verifyWebhookSignature(payload, headers(SECRET));
  assertEquals(result, {
    valid: true,
    event: {
      providerTransactionRef: "pay1",
      status: "flagged",
      amount: 100,
      currency: "XAF",
      reference: undefined,
      vendor: undefined,
      feeAmount: undefined,
    },
  });
});

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

// normalizeTaraMoneyWebhook's own contract: a negative/unparseable `originalAmount` does NOT
// invalidate the whole event (only `amount` is fail-closed) — it just leaves `feeAmount`
// undefined rather than persisting a garbage fee (TaraMoneyProvider.ts:238-247). Verified
// directly here since Task 3's "negative or unparseable amount/originalAmount" wording could be
// misread as both fields failing closed the same way.
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
    status: "verified",
    amount: 100,
    currency: "XAF",
    reference: undefined,
    vendor: undefined,
    feeAmount: undefined,
  });
});

// A negative-but-parseable originalAmount (distinct from the unparseable case above) hits the
// same "not derivable" branch (TaraMoneyProvider.ts:241's parsedOriginal >= 0 guard) — the event
// still verifies, just without a feeAmount.
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

// originalAmount greater than amount would derive a negative fee (the provider crediting more
// than the member paid, which should never happen) -- TaraMoneyProvider.ts:243's derivedFee >= 0
// guard treats this the same as "not derivable" rather than persisting a negative fee.
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

// --- Task 4: sandbox and real webhook deliveries (AC #3) -------------------------------------

// Real captured payload shape from docs/decisions.md's 2026-07-31 "Real payment orchestration"
// entry (Story 4.2, lines 397-415 — same Temporal stand-in business account as the Story 4.1
// Task 9 entry, but a distinct delivery with its own paymentId/amount/transactionId). The real
// phoneNumber is NOT copied verbatim per the story's Dev Notes — replaced with an obviously-fake
// placeholder of the same format, and not reproduced in this comment either.
Deno.test("verifyWebhookSignature: parses the real 2026-07-31 stand-in-account webhook shape (docs/decisions.md)", () => {
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

  const result = provider.verifyWebhookSignature(payload, headers(SECRET));

  assertEquals(result, {
    valid: true,
    event: {
      providerTransactionRef: "643539724",
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
// GYM OS business account 9FmIZg9GBB). That entry's phoneNumber is already redacted in
// decisions.md; a placeholder of the same format is used here regardless.
Deno.test("verifyWebhookSignature: parses the real 2026-08-13 real-account webhook shape (docs/decisions.md)", () => {
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

  const result = provider.verifyWebhookSignature(payload, headers(SECRET));

  assertEquals(result, {
    valid: true,
    event: {
      providerTransactionRef: "165126343",
      status: "verified",
      amount: 100,
      currency: "XAF",
      reference: "story-4-10-reverify-1786656261",
      vendor: "orange_money",
      feeAmount: 3,
    },
  });
});

// Cross-tenant mismatch (Story 4.10's review finding, feeding Story 4.13's per-gym-credential
// design, AD-15): verifyWebhookSignature() has no businessId-to-secret binding today — the
// secret is a single global env var, not per-account. A valid header paired with a businessId
// belonging to a *different* account than the header's secret still verifies successfully. This
// documents the current single-account behavior; per-gym businessId validation is Story 4.13's
// scope, not a gap fixed here.
Deno.test("verifyWebhookSignature: a valid header with a mismatched businessId (cross-tenant) still verifies — no per-account binding today (Story 4.13 scope)", () => {
  const payload = JSON.stringify({
    businessId: "some-other-gyms-business-id",
    paymentId: "pay-cross-tenant",
    status: "SUCCESS",
    amount: "100",
  });

  const result = provider.verifyWebhookSignature(payload, headers(SECRET));

  assertEquals(result.valid, true);
  assertEquals(result.event?.providerTransactionRef, "pay-cross-tenant");
});
