import { createClient } from "@/lib/supabase/server";
import { type AppError } from "@gymos/types";
import { mapAndLog } from "@/services/session";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

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
