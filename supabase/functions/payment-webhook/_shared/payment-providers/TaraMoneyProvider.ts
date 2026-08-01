import type {
  InitiatePaymentParams,
  InitiatePaymentResult,
  NormalizedPaymentEvent,
  PaymentProvider,
  WebhookVerificationResult,
} from "./PaymentProvider.ts";
import { errorResult, postJsonWithTimeout } from "./httpHelpers.ts";

// Real API reference: <local path to TaraMoney-supplied API reference docs, redacted>, supplied
// by the user 2026-07-31 (Story 4.1 Task 1). Auth is a plain apiKey+businessId
// pair inside the JSON body — not a bearer token / signed-request scheme.
const MOBILEPAY_URL = "https://www.dklo.co/api/tara/mobilepay";

interface TaraMoneyInitiateResponse {
  message: string;
  status: "SUCCESS" | "FAILURE";
  vendor?: string;
  /** Only present for Wave payments (Senegal/Burkina Faso/Ivory Coast) — not relevant to Cameroon MTN/Orange, kept for completeness. */
  authUrl?: string;
  /**
   * Real transaction reference, confirmed present on a real SUCCESS response
   * (Task 9 spike, 2026-07-31: `"transactionId":"719152650"`) — this is the
   * same value the later webhook echoes back as `paymentId`/`collectionId`,
   * making it the real correlatable provider reference. The story's earlier
   * assumption that no reference exists on initiate was wrong; kept optional
   * since a FAILURE response has no transaction to reference.
   */
  transactionId?: string;
  /** USSD code the payer must dial to confirm a mobile-money collection (e.g. "#150*50#"). Not needed for correlation — informational only. */
  ussdCode?: string;
}

function isTaraMoneyInitiateResponse(value: unknown): value is TaraMoneyInitiateResponse {
  const v = value as Partial<TaraMoneyInitiateResponse> | null | undefined;
  return (
    typeof v?.message === "string" &&
    (v?.status === "SUCCESS" || v?.status === "FAILURE")
  );
}

// Real payload shape, confirmed via Task 9's real spike delivery (2026-07-31,
// Temporal business account) — superseding the real API reference's
// internally-inconsistent docs (Mobile Payments API vs Webhooks API). Real
// example: { businessId, paymentId, amount: "100", originalAmount: "97",
// mobileOperator: "ORANGE_CAMEROON", collectionId, phoneNumber, creationDate,
// changeDate, status: "SUCCESS", productId, invoiceUrl, transactionId }.
// productId and amount ARE both present — the doc ambiguity is resolved in
// favor of the richer (Webhooks Api.pdf) shape. `transactionId` here is a
// distinct value from the initiate response's `transactionId` (that one
// equals this payload's `paymentId`/`collectionId` instead).
interface TaraMoneyWebhookPayload {
  businessId: string;
  paymentId: string;
  productId?: string;
  amount?: string;
  /** Amount actually credited to the gym, net of TaraMoney's fee deduction (FR-039 fee-passthrough relevance) — e.g. amount "100" (member paid) vs originalAmount "97" (gym credited), a fee of 3. */
  originalAmount?: string;
  mobileOperator?: string;
  collectionId?: string;
  phoneNumber: string;
  creationDate: string;
  changeDate: string;
  status: "SUCCESS" | "FAILURE";
  invoiceUrl?: string;
  transactionId?: string;
}

/**
 * Maps TaraMoney's real `mobileOperator`/`vendor` string to this app's own
 * `payments.method` label. Cameroon's two known operators keep their
 * existing exact labels (matching this app's pre-0036 values, so existing
 * rows/copy stay consistent); any other operator TaraMoney reports (e.g.
 * Wave, used in Senegal/Burkina Faso/Ivory Coast) is normalized to a
 * lowercase snake_case token instead of being silently dropped to
 * `undefined` — widened for 0036_open_payment_method.sql, since
 * `payments.method` is open `text` now, not a closed 2-value enum. Returns
 * undefined only when TaraMoney's payload carries no operator at all; the
 * caller falls back to a default rather than guessing at that point.
 */
function mapTaraMoneyVendor(vendor: string | undefined): string | undefined {
  if (!vendor) return undefined;
  const upper = vendor.toUpperCase();
  if (upper.includes("ORANGE")) return "orange_money";
  if (upper.includes("MTN")) return "mtn_momo";
  // A vendor string with no alphanumeric characters (e.g. "---") normalizes
  // to "" here -- fall back to undefined rather than persisting an empty
  // method, matching this function's own documented undefined-fallback
  // contract (review finding).
  const token = vendor
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return token || undefined;
}

// Constant-time comparison so a wrong-guess webhook secret can't be brute-forced
// via response-time measurement -- length is checked first (a length mismatch
// is not secret-dependent), then every byte is compared regardless of an
// earlier mismatch.
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function isTaraMoneyWebhookPayload(value: unknown): value is TaraMoneyWebhookPayload {
  const v = value as Partial<TaraMoneyWebhookPayload> | null | undefined;
  return (
    typeof v?.businessId === "string" &&
    typeof v?.paymentId === "string" &&
    (v?.status === "SUCCESS" || v?.status === "FAILURE")
  );
}

export class TaraMoneyProvider implements PaymentProvider {
  readonly providerKey = "taramoney";

  async initiate(params: InitiatePaymentParams): Promise<InitiatePaymentResult> {
    const apiKey = Deno.env.get("TARAMONEY_API_KEY");
    const businessId = Deno.env.get("TARAMONEY_BUSINESS_ID");
    if (!apiKey || !businessId) {
      return { success: false, error: "TaraMoney credentials are not configured" };
    }
    if (!params.phoneNumber) {
      return { success: false, error: "TaraMoney requires the payer's phoneNumber" };
    }

    const result = await postJsonWithTimeout("TaraMoney", MOBILEPAY_URL, {
      apiKey,
      businessId,
      productId: params.reference,
      productName: params.description ?? params.memberName ?? "GymOS payment",
      network: "",
      productPrice: params.amount,
      phoneNumber: params.phoneNumber,
      webHookUrl: params.callbackUrl,
    });

    if (!(result instanceof Response)) {
      return result;
    }

    if (!result.ok) {
      return errorResult("TaraMoney", result);
    }

    let rawBody: unknown;
    try {
      rawBody = await result.json();
    } catch {
      return { success: false, error: "TaraMoney returned a non-JSON response" };
    }

    if (!isTaraMoneyInitiateResponse(rawBody)) {
      return { success: false, error: "TaraMoney returned an unrecognized response shape" };
    }
    const body = rawBody;

    if (body.status !== "SUCCESS") {
      return { success: false, error: body.message ?? "TaraMoney initiation failed" };
    }

    // Confirmed via Task 9's real spike (2026-07-31): a SUCCESS response
    // carries a real transactionId that the later webhook echoes back as
    // paymentId/collectionId -- use it as the real provider reference.
    // Falls back to our own reference only if a future response shape ever
    // omits it (never observed in the real spike, kept defensive).
    return {
      success: true,
      providerTransactionRef: body.transactionId ?? params.reference,
      authorizationUrl: body.authUrl,
    };
  }

  verifyWebhookSignature(payload: string, headers: Record<string, string>): WebhookVerificationResult {
    // Confirmed via Task 9's real spike (2026-07-31): TaraMoney's "Webhook
    // Secret" is sent verbatim as the `tara-webhook-secret` request header
    // -- a shared-secret header match, not an HMAC-of-body signature scheme.
    // Real delivery evidence: header `tara-webhook-secret` equaled this
    // project's configured TARAMONEY_WEBHOOK_SECRET exactly. See
    // docs/decisions.md for the full captured request.
    const expected = Deno.env.get("TARAMONEY_WEBHOOK_SECRET");
    const received = headers["tara-webhook-secret"];
    if (!expected || !received || !constantTimeEqual(received, expected)) {
      return { valid: false };
    }

    let rawPayload: unknown;
    try {
      rawPayload = JSON.parse(payload);
    } catch {
      return { valid: false };
    }

    const event = normalizeTaraMoneyWebhook(rawPayload);
    if (!event) {
      return { valid: false };
    }

    return { valid: true, event };
  }
}

/**
 * Normalizes a raw, already-signature-verified TaraMoney webhook body into
 * NormalizedPaymentEvent. Kept as a standalone export (not inlined into
 * verifyWebhookSignature) so index.ts and tests can exercise payload parsing
 * independently of the still-unconfirmed signature step.
 */
export function normalizeTaraMoneyWebhook(rawPayload: unknown): NormalizedPaymentEvent | null {
  if (!isTaraMoneyWebhookPayload(rawPayload)) {
    return null;
  }

  // A present-but-unparseable amount (non-numeric, negative, or NaN) is treated
  // as a malformed webhook rather than silently coerced to 0/NaN and persisted
  // -- payments.amount is NOT NULL, so an unparseable value must fail the
  // webhook (401 via the signature/parsing path), not surface as an opaque 500.
  let amount = 0;
  if (rawPayload.amount !== undefined) {
    const parsed = Number(rawPayload.amount);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return null;
    }
    amount = parsed;
  }

  // originalAmount is what the gym is actually credited, net of TaraMoney's
  // fee (Story 4.2, AC #6). Same defensive numeric guard as `amount` above
  // -- an unparseable/negative value or a resulting negative fee (the
  // provider crediting more than the member paid, which should never
  // happen) is treated as "not derivable" rather than persisted as garbage.
  let feeAmount: number | undefined;
  if (rawPayload.originalAmount !== undefined) {
    const parsedOriginal = Number(rawPayload.originalAmount);
    if (Number.isFinite(parsedOriginal) && parsedOriginal >= 0) {
      const derivedFee = amount - parsedOriginal;
      if (derivedFee >= 0) {
        feeAmount = derivedFee;
      }
    }
  }

  return {
    providerTransactionRef: rawPayload.paymentId,
    status: rawPayload.status === "SUCCESS" ? "verified" : "flagged",
    amount,
    currency: "XAF",
    reference: rawPayload.productId,
    vendor: mapTaraMoneyVendor(rawPayload.mobileOperator),
    feeAmount,
  };
}
