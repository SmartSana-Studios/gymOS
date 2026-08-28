"use client";

import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

// Story 4.12 (Task 2, AC #1): the async wait-for-confirmation UX for the new
// automated Mobile Money initiation path. `initiatePayment()` inserts a
// `processing` payments row and returns immediately -- the real Tara Money
// USSD confirmation arrives later via the webhook (`complete_verified_payment()`).
// Mirrors `lib/realtime/frontDeskAlerts.ts`'s established Realtime-with-
// polling-degrade pattern (AD-20, Story 4.6) exactly, decided as this
// story's approach (user direction, 2026-08-17) -- scoped to a single
// `payments.id` row rather than a gym-wide feed, since RenewalModal only
// ever watches the one payment it just initiated.
export type WatchedPaymentStatus = "processing" | "verified" | "flagged";

export interface PaymentStatusRow {
  id: string;
  status: WatchedPaymentStatus;
}

/**
 * Realtime security is RLS-driven, not filter-driven, matching
 * `subscribeToFrontDeskAlerts`'s own established precedent: the `id=eq.`
 * filter below is an efficiency optimization only -- `gym_staff_read_own_payments`
 * (0030_payment_initiation_and_renewal.sql) is the real gate Realtime
 * evaluates per subscribing client before ever delivering a row.
 */
export function subscribeToPaymentStatus(
  paymentId: string,
  onUpdate: (row: PaymentStatusRow) => void,
  onStatusChange: (status: string) => void,
): RealtimeChannel {
  const supabase = createClient();
  const channel = supabase
    .channel(`payment:${paymentId}:status`)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "payments", filter: `id=eq.${paymentId}` },
      (payload) => onUpdate(payload.new as PaymentStatusRow),
    )
    .subscribe((status) => onStatusChange(status));

  return channel;
}

/** The polling-degrade path's fetch -- a direct, browser-native read of the
 * one watched payment row, mirroring `fetchActiveFrontDeskAlerts`'s role for
 * the front-desk panel's own degrade path. Returns `null` on any error
 * (RLS-denied, stale id) rather than throwing -- unlike
 * `fetchActiveFrontDeskAlerts` (a TanStack Query `queryFn` that must throw to
 * preserve cached data), this is a plain polled read with no cache to
 * protect; the caller simply tries again on the next interval tick. */
export async function fetchPaymentStatus(paymentId: string): Promise<PaymentStatusRow | null> {
  const supabase = createClient();
  const { data, error } = await supabase.from("payments").select("id, status").eq("id", paymentId).maybeSingle();

  if (error || !data) {
    return null;
  }
  return data as PaymentStatusRow;
}

/**
 * Story 11.3 (Task 6): Flow B's own pending-payment watch, for the Billing
 * section's "Pay Now" button. `saas_billing_payments` is not (yet) added to
 * the `supabase_realtime` publication `payments` already has
 * (0051_payments_realtime_publication.sql) -- a deliberate scope decision,
 * not an oversight (see this story's Dev Notes) -- so this is polling-only,
 * no `subscribeToSaasBillingPaymentStatus` realtime counterpart. AD-20's
 * own polling-degrade path still applies: this function is exactly what
 * `fetchPaymentStatus` above would be doing anyway if Realtime were
 * unavailable, just without ever attempting the fast path first.
 */
export async function fetchSaasBillingPaymentStatus(paymentId: string): Promise<PaymentStatusRow | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("saas_billing_payments")
    .select("id, status")
    .eq("id", paymentId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }
  return data as PaymentStatusRow;
}
