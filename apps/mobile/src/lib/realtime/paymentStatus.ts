import type { RealtimeChannel } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

// Story 4.15: ported from apps/dashboard/lib/realtime/paymentStatus.ts
// (Story 4.12) -- confirmed portable, no DOM/browser API used there. This
// app has a single `supabase` singleton (no per-request client factory,
// unlike the dashboard's server/client split), so this port calls it
// directly rather than a fresh createClient() per subscription. Same
// channel convention (`payment:<paymentId>:status`), same `postgres_changes`
// UPDATE filter, same polling-degrade fallback shape (AD-20) -- the Renew
// screen reuses the exact same POLL_INTERVAL_MS/STILL_WAITING_MS values
// RenewalModal.tsx defines, not re-derived here.
export type WatchedPaymentStatus = 'processing' | 'verified' | 'flagged';

export interface PaymentStatusRow {
  id: string;
  status: WatchedPaymentStatus;
}

/**
 * Realtime security is RLS-driven, not filter-driven, matching the
 * dashboard's own established precedent: the `id=eq.` filter below is an
 * efficiency optimization only -- `member_read_own_payments`
 * (0038_*.sql) is the real gate Realtime evaluates per subscribing client
 * before ever delivering a row.
 */
export function subscribeToPaymentStatus(
  paymentId: string,
  onUpdate: (row: PaymentStatusRow) => void,
  onStatusChange: (status: string) => void,
): RealtimeChannel {
  const channel = supabase
    .channel(`payment:${paymentId}:status`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'payments', filter: `id=eq.${paymentId}` },
      (payload) => onUpdate(payload.new as PaymentStatusRow),
    )
    .subscribe((status) => onStatusChange(status));

  return channel;
}

/** The polling-degrade path's fetch -- mirrors `fetchPaymentStatus`'s role on
 * the dashboard. Returns `null` on any error (RLS-denied, stale id) rather
 * than throwing -- the caller simply tries again on the next interval tick. */
export async function fetchPaymentStatus(paymentId: string): Promise<PaymentStatusRow | null> {
  const { data, error } = await supabase.from('payments').select('id, status').eq('id', paymentId).maybeSingle();

  if (error || !data) {
    return null;
  }
  return data as PaymentStatusRow;
}
