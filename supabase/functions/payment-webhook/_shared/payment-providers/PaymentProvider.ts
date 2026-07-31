// Gateway-agnostic call contract, mirroring OtpDeliveryProvider's shape
// (send-sms-hook/_shared/otp-providers/OtpDeliveryProvider.ts) — entity
// shapes that touch the DB stay the generated `packages/types` type
// (architecture.md Service Boundaries); this interface owns the wire
// contract only.

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
}

export type InitiatePaymentResult =
  | {
      success: true;
      /** Maps to payments.provider_transaction_ref. */
      providerTransactionRef: string;
      /** Present if the provider requires a redirect/USSD-prompt step. */
      authorizationUrl?: string;
    }
  | { success: false; error: string };

export interface WebhookVerificationResult {
  valid: boolean;
  /** Only present if valid. */
  event?: NormalizedPaymentEvent;
}

export interface NormalizedPaymentEvent {
  providerTransactionRef: string;
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
   * The mobile-money network that processed the payment (e.g. "orange_money",
   * "mtn_momo"), when the provider's webhook makes it derivable. Confirmed
   * derivable for TaraMoney via its real Task 9 spike delivery (2026-07-31,
   * `mobileOperator: "ORANGE_CAMEROON"`) — absent means the caller falls back
   * to a default rather than guessing.
   */
  vendor?: "mtn_momo" | "orange_money";
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
  verifyWebhookSignature(payload: string, headers: Record<string, string>): WebhookVerificationResult;
}
