export type DeliveryResult =
  | { success: true; channel?: string }
  | {
      success: false;
      error: string;
      /** Underlying provider HTTP status, when known — lets the hook map 429/503 to a retryable response. */
      status?: number;
      /** Provider's own Retry-After value, when present. */
      retryAfter?: string;
    };

export interface OtpDeliveryProvider {
  /**
   * @param phone Guaranteed E.164 with a leading "+" (e.g. "+237680811041") — callers normalize
   * this before invoking any provider. GoTrue's own Send SMS Hook payload does NOT include the
   * leading "+" (confirmed during the Story 2.1 spike); do not re-add your own prefixing/stripping
   * in a new implementation, the guarantee already holds by the time `send` is called.
   */
  send(phone: string, code: string, locale: "en" | "fr"): Promise<DeliveryResult>;
}
