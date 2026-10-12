import { createClient } from "@/lib/supabase/server";
import { type AppError } from "@gymos/types";
import { mapAndLog } from "@/services/session";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import {
  GUEST_SESSIONS_PAGE_SIZE,
  type BlockedAttemptRow,
  type FreeGuestSessionRow,
  type FreeGuestSessionStatus,
  type GuestSessionsPeriod,
  type GuestSessionsSummary,
  type PaidGuestSessionRow,
} from "@/lib/guest-sessions";

/**
 * Story 19.9b: a member's guest sessions for the member modal's Sessions
 * section. `guest_sessions` has staff SELECT only (no write path from here);
 * method and recorder come from the paid session's `payments` row.
 */
export interface MemberGuestSession {
  id: string;
  /** `paid` has a payment; `free` has a loyalty grant (Epic 20). */
  source: "paid" | "free";
  createdAt: string;
  usableUntil: string;
  consumedAt: string | null;
  coveredDay: string | null;
  voidedAt: string | null;
  method: string | null;
  recordedByName: string | null;
}

interface GuestSessionRowFromDb {
  id: string;
  payment_id: string | null;
  loyalty_grant_id: string | null;
  created_at: string;
  usable_until: string;
  consumed_at: string | null;
  covered_day: string | null;
  voided_at: string | null;
  payments: { method: string; actor_id: string | null } | { method: string; actor_id: string | null }[] | null;
}

// Only recent history is shown (lapsed and voided rows disappear after 90
// days); the section is a desk aid, not a ledger.
const HISTORY_DAYS = 90;

export async function listMemberGuestSessions(
  memberId: string,
): Promise<{ data: MemberGuestSession[] | null; error: AppError | null }> {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError) {
    return { data: null, error: await mapAndLog(claimsError) };
  }
  const gymId = (claimsData?.claims as { gym_id?: string } | undefined)?.gym_id;
  if (!gymId) {
    const { t } = await getServerTranslation(await getRequestLocale());
    return { data: null, error: { code: "not_found", message: t("common.somethingWentWrong") } };
  }

  const { data, error } = await supabase
    .from("guest_sessions")
    .select(
      "id, payment_id, loyalty_grant_id, created_at, usable_until, consumed_at, covered_day, voided_at, payments(method, actor_id)",
    )
    .eq("gym_id", gymId)
    .eq("member_id", memberId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }

  const rows = (data ?? []) as unknown as GuestSessionRowFromDb[];
  const payments = rows.map((row) => (Array.isArray(row.payments) ? row.payments[0] : row.payments));

  // Recorder names: payments.actor_id is the staff user id; resolve through
  // the gym's own members rows (same approach as getMemberRegistrationFeeState).
  const actorIds = [...new Set(payments.map((p) => p?.actor_id).filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: actors } = await supabase
      .from("members")
      .select("user_id, name")
      .eq("gym_id", gymId)
      .in("user_id", actorIds);
    for (const actor of actors ?? []) {
      if (actor.user_id) names.set(actor.user_id, actor.name);
    }
  }

  const cutoff = Date.now() - HISTORY_DAYS * 86_400_000;
  const now = Date.now();
  const sessions: MemberGuestSession[] = [];
  rows.forEach((row, index) => {
    const payment = payments[index];
    const lapsed = row.consumed_at === null && row.voided_at === null && new Date(row.usable_until).getTime() < now;
    // Lapsed and voided rows age out of the list after 90 days.
    if (row.voided_at && new Date(row.voided_at).getTime() < cutoff) return;
    if (lapsed && new Date(row.usable_until).getTime() < cutoff) return;
    sessions.push({
      id: row.id,
      source: row.payment_id ? "paid" : "free",
      createdAt: row.created_at,
      usableUntil: row.usable_until,
      consumedAt: row.consumed_at,
      coveredDay: row.covered_day,
      voidedAt: row.voided_at,
      method: payment?.method ?? null,
      recordedByName: payment?.actor_id ? (names.get(payment.actor_id) ?? null) : null,
    });
  });

  return { data: sessions, error: null };
}

// ---------------------------------------------------------------------------
// Story 19.10: Overview card figures and the AD-22 drill-down lists (0114).
// All four RPCs are SECURITY INVOKER, owner/supervisor/manager only (42501
// otherwise) and aggregate in SQL; nothing here sums fetched rows.
// ---------------------------------------------------------------------------

async function callRpc<T>(
  fn: string,
  args: Record<string, unknown>,
): Promise<{ data: T[] | null; error: AppError | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    // The RPCs' own role refusal. The global denied copy, never a raw message.
    if ((error as { code?: string }).code === "42501") {
      const { t } = await getServerTranslation(await getRequestLocale());
      return { data: null, error: { code: "forbidden", message: t("guestSessions.permissionDenied") } };
    }
    return { data: null, error: await mapAndLog(error) };
  }
  return { data: (data ?? []) as T[], error: null };
}

export async function getGuestSessionsSummary(
  period: GuestSessionsPeriod,
): Promise<{ data: GuestSessionsSummary | null; error: AppError | null }> {
  const { data, error } = await callRpc<{
    paid_count: number;
    blocked_count: number;
    blocked_members: number;
    free_count: number;
  }>("guest_sessions_summary", { p_period: period });
  if (error || !data) return { data: null, error };
  const row = data[0];
  return {
    data: {
      paid: Number(row?.paid_count ?? 0),
      blocked: Number(row?.blocked_count ?? 0),
      blockedMembers: Number(row?.blocked_members ?? 0),
      free: Number(row?.free_count ?? 0),
    },
    error: null,
  };
}

interface PagedParams {
  period: GuestSessionsPeriod;
  page: number;
}

function pageArgs(page: number) {
  const safe = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  return { p_limit: GUEST_SESSIONS_PAGE_SIZE, p_offset: (safe - 1) * GUEST_SESSIONS_PAGE_SIZE };
}

export async function listPaidGuestSessions(
  params: PagedParams & { refundedAfterUseOnly?: boolean; groupByRecorder?: boolean },
): Promise<{ data: { rows: PaidGuestSessionRow[]; total: number } | null; error: AppError | null }> {
  const { data, error } = await callRpc<{
    payment_id: string;
    member_id: string;
    member_name: string;
    amount: number;
    method: string;
    created_at: string;
    consumed_at: string | null;
    refund_state: PaidGuestSessionRow["refundState"];
    recorder_id: string | null;
    recorder_name: string | null;
    recorder_kind: PaidGuestSessionRow["recorderKind"];
    group_sessions: number | null;
    group_total: number | null;
    total_count: number;
  }>("list_guest_sessions_paid", {
    p_period: params.period,
    p_refunded_after_use_only: params.refundedAfterUseOnly ?? false,
    p_group_by_recorder: params.groupByRecorder ?? true,
    ...pageArgs(params.page),
  });
  if (error || !data) return { data: null, error };
  return {
    data: {
      total: Number(data[0]?.total_count ?? 0),
      rows: data.map((r) => ({
        paymentId: r.payment_id,
        memberId: r.member_id,
        memberName: r.member_name,
        amount: Number(r.amount),
        method: r.method,
        createdAt: r.created_at,
        consumedAt: r.consumed_at,
        refundState: r.refund_state,
        recorderId: r.recorder_id,
        recorderName: r.recorder_name,
        recorderKind: r.recorder_kind,
        groupSessions: r.group_sessions == null ? null : Number(r.group_sessions),
        groupTotal: r.group_total == null ? null : Number(r.group_total),
      })),
    },
    error: null,
  };
}

export async function listBlockedSessionAttempts(
  params: PagedParams,
): Promise<{ data: { rows: BlockedAttemptRow[]; total: number } | null; error: AppError | null }> {
  const { data, error } = await callRpc<{
    attempt_id: string;
    member_id: string;
    member_name: string;
    source: "check_in" | "class";
    class_name: string | null;
    attempt_time: string;
    scanned_at: string | null;
    synced_at: string;
    total_count: number;
  }>("list_session_attempts", { p_period: params.period, ...pageArgs(params.page) });
  if (error || !data) return { data: null, error };
  return {
    data: {
      total: Number(data[0]?.total_count ?? 0),
      rows: data.map((r) => ({
        id: r.attempt_id,
        memberId: r.member_id,
        memberName: r.member_name,
        source: r.source,
        className: r.class_name,
        time: r.attempt_time,
        scannedAt: r.scanned_at,
        syncedAt: r.synced_at,
      })),
    },
    error: null,
  };
}

export async function listFreeGuestSessions(
  params: PagedParams,
): Promise<{ data: { rows: FreeGuestSessionRow[]; total: number } | null; error: AppError | null }> {
  const { data, error } = await callRpc<{
    session_id: string;
    member_id: string;
    member_name: string;
    earned_at: string;
    usable_until: string;
    status: FreeGuestSessionStatus;
    total_count: number;
  }>("list_free_guest_sessions", { p_period: params.period, ...pageArgs(params.page) });
  if (error || !data) return { data: null, error };
  return {
    data: {
      total: Number(data[0]?.total_count ?? 0),
      rows: data.map((r) => ({
        id: r.session_id,
        memberId: r.member_id,
        memberName: r.member_name,
        earnedAt: r.earned_at,
        usableUntil: r.usable_until,
        status: r.status,
      })),
    },
    error: null,
  };
}
