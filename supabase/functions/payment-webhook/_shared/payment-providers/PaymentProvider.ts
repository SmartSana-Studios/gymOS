// Gateway-agnostic call contract, mirroring OtpDeliveryProvider's shape
// (send-sms-hook/_shared/otp-providers/OtpDeliveryProvider.ts) — entity
// shapes that touch the DB stay the generated `packages/types` type
// (architecture.md Service Boundaries); this interface owns the wire
// contract only.

/**
 * AD-14's discriminated routing context. Flow A (Story 4.14) introduces the
 * `gym` variant — a gym's own Vault-stored Tara Money credentials, resolved
 * via a service-role-only RPC (never a client-supplied credential blob).
 * `platform` (Story 11.1) is Epic 11's SaaS billing account — GymOS's own
 * platform-level Tara Money credentials, read from env vars rather than a
 * per-gym Vault lookup.
 */
export type PaymentRoutingContext = { type: "gym"; gymId: string } | { type: "platform" };

/**
 * Distinguishes "this gym has no usable Tara Money connection right now" (an
 * expected *operational* state — never connected, or a prior connection now
 * invalid/revoked) from every other initiation failure (network error,
 * provider-side decline). AC #3 needs this to route specifically to the
 * front-desk-fallback message, not a generic error.
 */
export type PaymentInitiationErrorCode = "credentials_not_connected";

export interface InitiatePaymentParams {
  /** Integer, smallest currency unit per FR-026 — XAF has no subunit (whole francs). */
  amount: number;
  currency: string;
  /** Our own idempotency reference — distinct from the provider's own transaction ref. */
  reference: string;
  callbackUrl: string;
  memberName?: string;
  description?: string;
  /**
   * E.164-with-country-code payer phone number (e.g. "2376xxxxxxxx"), required by
   * TaraMoney's mobile-money endpoint (it triggers the USSD prompt server-side —
   * discovered from the real API reference, not part of this interface's original
   * draft shape). Optional at the interface level since a redirect/hosted-page
   * provider might collect it on its own page instead.
   */
  phoneNumber?: string;
  /** AD-14/Story 4.14: which account this payment must settle into. */
  routingContext: PaymentRoutingContext;
}

export type InitiatePaymentResult =
  | {
      success: true;
      /** Maps to payments.provider_transaction_ref. */
      providerTransactionRef: string;
      /** Present if the provider requires a redirect/USSD-prompt step. */
      authorizationUrl?: string;
    }
  | { success: false; error: string; code?: PaymentInitiationErrorCode };

export interface WebhookVerificationResult {
  valid: boolean;
  /** Only present if valid. */
  event?: NormalizedPaymentEvent;
}

export interface NormalizedPaymentEvent {
  providerTransactionRef: string;
  /**
   * The payload's own account-routing identifier (TaraMoney's `businessId`),
   * surfaced for the caller's own use (e.g. a future audit-log write) — not
   * required by the webhook-receive DB-write path, which reads it directly
   * from the stored raw_payload instead (Story 4.14 Task 2's reconciliation
   * query). Present whenever the provider's payload carries one.
   */
  businessId?: string;
  /**
   * The gym_id verifyWebhookSignature() resolved businessId against
   * (Story 4.14, review finding) — surfaced so index.ts can synchronously
   * confirm the payments row it matched by provider_transaction_ref
   * actually belongs to this same gym before completing it, instead of
   * relying solely on the nightly reconciliation job's wrong_account_settlement
   * category to catch a cross-tenant mismatch after the fact. Present
   * whenever the provider resolves gym-scoped credentials during
   * verification (every real TaraMoneyProvider webhook).
   */
  resolvedGymId?: string;
  /**
   * AD-14/Story 11.1: which account (gym or platform) verifyWebhookSignature()
   * actually resolved this delivery against — required, not optional, since
   * every code path that returns `{valid: true, event}` now knows which one
   * it resolved. index.ts (Task 3) reads this to decide whether to dispatch
   * against `payments` or `saas_billing_payments`; it must not infer routing
   * from resolvedGymId's presence/absence alone, which is also legitimately
   * absent on unrelated defensive paths.
   */
  resolvedRoutingContext: PaymentRoutingContext;
  /** Maps to the existing payment_status enum, 0001_extensions_and_enums.sql. */
  status: "processing" | "verified" | "flagged";
  amount: number;
  currency: string;
  /**
   * Our own InitiatePaymentParams.reference, echoed back by the provider's
   * webhook, when the provider's webhook payload includes it (not every
   * gateway does — TaraMoney's own real API reference is internally
   * inconsistent on this, see TaraMoneyProvider.ts). This is the only way
   * to correlate a webhook back to the payment we initiated when the
   * provider's initiate response carries no transaction reference of its
   * own; absent means the webhook handler cannot correlate and must log,
   * not guess.
   */
  reference?: string;
  /**
   * The mobile-money network/operator that processed the payment (e.g.
   * "orange_money", "mtn_momo", or any other operator/country the provider
   * reports), when the provider's webhook makes it derivable. Confirmed
   * derivable for TaraMoney via its real Task 9 spike delivery (2026-07-31,
   * `mobileOperator: "ORANGE_CAMEROON"`) — absent means the caller falls back
   * to a default rather than guessing. Open string, not a closed union
   * (0036_open_payment_method.sql) — `payments.method` is plain `text` now,
   * so this is free to carry whatever operator TaraMoney (or a future
   * provider) actually reports, not just the two Cameroon operators this
   * project started with.
   */
  vendor?: string;
  /**
   * Gym-credited amount vs. member-paid amount delta (the provider's own
   * fee, FR-039) -- e.g. TaraMoney's real webhook carries both `amount`
   * ("100") and `originalAmount` ("97"), confirmed via Story 4.1's real
   * spike. Absent when the provider's payload doesn't carry enough to
   * derive it, rather than guessing/defaulting to 0.
   */
  feeAmount?: number;
}

export interface PaymentProvider {
  /** Must match a payment_providers.provider_key row. */
  readonly providerKey: string;
  initiate(params: InitiatePaymentParams): Promise<InitiatePaymentResult>;
  /**
   * Async as of Story 4.14: per-gym webhook secrets mean the routing
   * context isn't known from the header/payload alone — the implementation
   * resolves it internally via a DB round-trip (a non-secret businessId
   * lookup, before any DB write) rather than requiring the caller to
   * supply it. See TaraMoneyProvider.ts and the story's Context section for
   * the full design rationale.
   */
  verifyWebhookSignature(payload: string, headers: Record<string, string>): Promise<WebhookVerificationResult>;
}
