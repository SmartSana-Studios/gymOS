// Story 19.10: pure types and URL-param parsing shared by the Overview card
// (client), the /guest-sessions page (server) and the guestSessions service.
// No server imports -- the client components import this file too.

export const GUEST_SESSIONS_PERIODS = ["today", "month"] as const;
export type GuestSessionsPeriod = (typeof GUEST_SESSIONS_PERIODS)[number];

export const GUEST_SESSIONS_TABS = ["paid", "blocked", "free"] as const;
export type GuestSessionsTab = (typeof GUEST_SESSIONS_TABS)[number];

export const GUEST_SESSIONS_PAGE_SIZE = 50;

/** An unknown period falls back to today (a hand-edited URL, a stale link). */
export function parseGuestSessionsPeriod(value: string | null | undefined): GuestSessionsPeriod {
  return value === "month" ? "month" : "today";
}

/** An unknown tab falls back to paid. */
export function parseGuestSessionsTab(value: string | null | undefined): GuestSessionsTab {
  return value === "blocked" || value === "free" ? value : "paid";
}

export function guestSessionsHref(tab: GuestSessionsTab, period: GuestSessionsPeriod): string {
  return `/guest-sessions?tab=${tab}&period=${period}`;
}

export interface GuestSessionsSummary {
  paid: number;
  blocked: number;
  blockedMembers: number;
  free: number;
}

export type GuestSessionRefundState = "refunded" | "refunded_after_use" | "none";
export type GuestSessionRecorderKind = "staff" | "tara" | "unknown";

export interface PaidGuestSessionRow {
  paymentId: string;
  memberId: string;
  memberName: string;
  amount: number;
  method: string;
  createdAt: string;
  consumedAt: string | null;
  refundState: GuestSessionRefundState;
  recorderId: string | null;
  recorderName: string | null;
  recorderKind: GuestSessionRecorderKind;
  /** Full-period window totals of the row's recorder group; null when ungrouped. */
  groupSessions: number | null;
  groupTotal: number | null;
}

export interface BlockedAttemptRow {
  id: string;
  memberId: string;
  memberName: string;
  source: "check_in" | "class";
  className: string | null;
  /** Scan time for an offline scan, otherwise server receipt. */
  time: string;
  /** Set only for an offline scan that was verified on sync. */
  scannedAt: string | null;
  /** Server receipt time: the "synced" time of an offline scan. */
  syncedAt: string;
}

export type FreeGuestSessionStatus = "available" | "used" | "lapsed" | "voided";

export interface FreeGuestSessionRow {
  id: string;
  memberId: string;
  memberName: string;
  earnedAt: string;
  usableUntil: string;
  status: FreeGuestSessionStatus;
}
