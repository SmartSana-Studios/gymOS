// Story 19.11: pure resolvers for the per-visit paid-session UX. No
// react-native/expo imports so vitest can run it under plain node.

export type SessionSubscriptionStatus = 'active' | 'expiring_soon' | 'grace_period' | 'expired' | 'none';

/** What the client knows about the caller's charging situation. Members
 * cannot read `session_attempts` or `platform_session_config`, so the refusal
 * reason is inferred from this (Story 19.11 decision, no migration). */
export interface ChargingContext {
  chargingEnabled: boolean;
  planType: string | null;
  planPrice: number | null;
  planCurrency: string | null;
  subscriptionStatus: SessionSubscriptionStatus | null;
  /** IANA zone of the gym, used to bucket "today". */
  timezone: string | null;
}

/** The unused-session lapse window shown as caption copy (constant 7, not
 * read from platform config -- members cannot read it). */
export const SESSION_LAPSE_DAYS = 7;

/** Flag on, latest plan pay-per-session, price > 0. Anything else is exempt
 * and sees Home and check-in exactly as before. */
export function isChargedMember(ctx: ChargingContext | null): boolean {
  if (!ctx) return false;
  return ctx.chargingEnabled && ctx.planType === 'pay_per_session' && (ctx.planPrice ?? 0) > 0;
}

export type RefusalOutcome = 'session_required' | 'expired';

/** A refused scan (check_in returned null) at a charging gym, for a member
 * whose subscription is not expired/none, means a session is required. */
export function resolveRefusal(ctx: ChargingContext | null): RefusalOutcome {
  if (!isChargedMember(ctx)) return 'expired';
  if (ctx!.subscriptionStatus === null || ctx!.subscriptionStatus === 'expired' || ctx!.subscriptionStatus === 'none') {
    return 'expired';
  }
  return 'session_required';
}

/** Offline scan: show the "will be verified" info state only for a charged
 * member who is not already known to be expired. Otherwise unchanged. */
export function shouldShowOfflineVerify(ctx: ChargingContext | null): boolean {
  return resolveRefusal(ctx) === 'session_required';
}

/** A null sync result is only a missing-session denial for a charged,
 * non-expired member; for anyone else it keeps its shipped (silent) meaning. */
export function isSessionDenial(ctx: ChargingContext | null): boolean {
  return resolveRefusal(ctx) === 'session_required';
}

export interface GuestSessionRow {
  usableUntil: string;
  consumedAt: string | null;
  coveredDay: string | null;
  voidedAt: string | null;
}

export type SessionsLineTone = 'success' | 'neutral' | 'info';

export interface SessionsLine {
  tone: SessionsLineTone;
  /** Unused, unexpired paid sessions. */
  usableCount: number;
  /** Soonest `usable_until` among usable rows, or null. */
  soonestUsableUntil: string | null;
  coveredToday: boolean;
}

/** Gym-local calendar day (YYYY-MM-DD) for an instant. Falls back to UTC when
 * the zone is missing or invalid. */
export function gymLocalDay(at: Date, timezone: string | null): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone ?? 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** Sessions line on the status card. Counts use each row's own
 * `usable_until`; "covered today" is a consumed row whose covered_day is the
 * gym-local day. Tones: covered today = success, usable sessions = neutral,
 * none = info (story 19.11 UX-DR19). */
export function resolveSessionsLine(rows: GuestSessionRow[], timezone: string | null, now: Date = new Date()): SessionsLine {
  const today = gymLocalDay(now, timezone);
  const live = rows.filter((r) => r.voidedAt === null);
  const coveredToday = live.some((r) => r.consumedAt !== null && r.coveredDay === today);
  const usable = live
    .filter((r) => r.consumedAt === null && new Date(r.usableUntil).getTime() > now.getTime())
    .sort((a, b) => new Date(a.usableUntil).getTime() - new Date(b.usableUntil).getTime());
  const soonest = usable.length > 0 ? usable[0].usableUntil : null;

  const tone: SessionsLineTone = coveredToday ? 'success' : usable.length > 0 ? 'neutral' : 'info';
  return { tone, usableCount: usable.length, soonestUsableUntil: soonest, coveredToday };
}

export interface SyncDenial {
  scanId: string;
  scannedAt: string;
}

export interface CollapsedDenials {
  latest: SyncDenial;
  more: number;
}

/** One notice for any number of denials: names the latest, "+N more". */
export function collapseDenials(denials: SyncDenial[]): CollapsedDenials | null {
  if (denials.length === 0) return null;
  const latest = denials.reduce((a, b) => (new Date(b.scannedAt).getTime() >= new Date(a.scannedAt).getTime() ? b : a));
  return { latest, more: denials.length - 1 };
}

/** Appends new denials, de-duplicated by scan id (a re-synced scan must not
 * be counted twice). */
export function mergeDenials(existing: SyncDenial[], incoming: SyncDenial[]): SyncDenial[] {
  const seen = new Set(existing.map((d) => d.scanId));
  const merged = [...existing];
  for (const d of incoming) {
    if (!seen.has(d.scanId)) {
      seen.add(d.scanId);
      merged.push(d);
    }
  }
  return merged;
}

/** PostgREST `or` filter for the member's own `guest_sessions` on Home: rows
 * usable right now, plus the one that covers the gym-local day. Applied
 * server-side so old history cannot push them out of the row limit. */
export function homeSessionsOrFilter(now: Date, timezone: string | null): string {
  return `and(consumed_at.is.null,usable_until.gt.${now.toISOString()}),covered_day.eq.${gymLocalDay(now, timezone)}`;
}

/** A session payment is a Home activity event only once verified; an
 * unconfirmed or flagged one is shown in history (Processing/Failed), never
 * as a recorded payment. Non-session payments always count. */
export function isHomeActivityPayment(payment: { purpose: string; status: string }): boolean {
  return payment.purpose !== 'session' || payment.status === 'verified';
}

export interface ReceiptSessionRow {
  usable_until: string;
  consumed_at: string | null;
  covered_day: string | null;
  voided_at: string | null;
}

/** Receipt dates for a session payment's `guest_sessions` row: "use by" while
 * unused, "used on" (gym-local covered day) once consumed. A voided session
 * shows neither. */
export function resolveReceiptSessionDates(row: ReceiptSessionRow | null): {
  usableUntil: string | null;
  coveredDay: string | null;
} {
  if (!row || row.voided_at) return { usableUntil: null, coveredDay: null };
  return {
    usableUntil: row.usable_until,
    coveredDay: row.consumed_at ? (row.covered_day ?? row.consumed_at) : null,
  };
}
