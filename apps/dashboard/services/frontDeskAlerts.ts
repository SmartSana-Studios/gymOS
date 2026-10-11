import { createClient } from "@/lib/supabase/server";
import { type AppError } from "@gymos/types";
import { mapAndLog } from "@/services/session";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import { loadSessionAlertContext } from "@/lib/frontDeskSessionAlerts";

// front_desk_alerts.status only ever carries the 3 at-risk values (the
// table's own CHECK constraint, 0034_real_time_front_desk_alert.sql) --
// narrower than members.ts's own MemberSubscriptionStatus, which also
// includes 'active'. Defined locally, not imported from @gymos/types --
// this package's generated `Database` type isn't re-exported (members.ts's
// own MemberSubscriptionStatus precedent for the same reason).
type FrontDeskAlertStatus = "expiring_soon" | "grace_period" | "expired";

/** Per-file-copy discipline (Scope Notes) -- matches attendance.ts's own
 * getCallerGymId verbatim rather than importing across service files. */
async function getCallerGymId(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ gymId: string | null; error: AppError | null }> {
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();

  if (claimsError) {
    return { gymId: null, error: await mapAndLog(claimsError) };
  }

  const gymId = (claimsData?.claims as { gym_id?: string } | undefined)?.gym_id;
  if (!gymId) {
    console.warn("[frontDeskAlerts] resolved to not_found: no gym_id claim on caller's session");
    const { t } = await getServerTranslation(await getRequestLocale());
    return { gymId: null, error: { code: "not_found", message: t("members.errors.memberNotFound") } };
  }

  return { gymId, error: null };
}

export interface FrontDeskAlertRow {
  id: string;
  memberId: string;
  memberName: string;
  memberPhotoUrl: string | null;
  /** Story 19.9b: absent means subscription_status (every pre-19.9b caller). */
  kind?: "subscription_status" | "session_required";
  /** Null only on a session_required row. */
  status: FrontDeskAlertStatus | null;
  expiryDate: string | null;
  createdAt: string;
  /** Story 19.9b, session_required only: the class that refused the member. */
  className?: string | null;
  /** Story 19.9b, session_required only: set for an offline scan verified late. */
  scannedOfflineAt?: string | null;
  /** Story 19.9b, session_required only: a Tara session payment is in flight. */
  paymentInFlight?: boolean;
}

interface FrontDeskAlertRowFromDb {
  id: string;
  member_id: string;
  status: FrontDeskAlertStatus | null;
  expiry_date: string | null;
  created_at: string;
  members: { name: string; photo_url: string | null } | null;
}

/** Overview/Attendance (Server Components) initial SSR read (Task 6) -- the
 * client-side realtime path (lib/realtime/frontDeskAlerts.ts) does its own
 * subsequent reads via the browser client, never via this file (this file
 * uses the cookie-based server client and cannot run in the browser). */
export async function listActiveFrontDeskAlerts(): Promise<{
  data: { alerts: FrontDeskAlertRow[]; autoDismissMinutes: number } | null;
  error: AppError | null;
}> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const [alertsResult, sessionAlertsResult, gymResult] = await Promise.all([
    supabase
      .from("front_desk_alerts")
      .select("id, member_id, status, expiry_date, created_at, members(name, photo_url)")
      .eq("gym_id", gymId)
      // 0111: only subscription-status alerts render as at-risk alerts; a
      // session_required row has a null status.
      .eq("kind", "subscription_status")
      .is("dismissed_at", null)
      .order("created_at", { ascending: false }),
    // Story 19.9b: the panel also renders session-required alerts (their own
    // variant). The at-risk list above stays subscription-only.
    supabase
      .from("front_desk_alerts")
      .select("id, member_id, status, expiry_date, created_at, members(name, photo_url)")
      .eq("gym_id", gymId)
      .eq("kind", "session_required")
      .is("dismissed_at", null)
      .order("created_at", { ascending: false }),
    supabase.from("gyms").select("alert_auto_dismiss_minutes").eq("id", gymId).single(),
  ]);

  if (alertsResult.error) {
    return { data: null, error: await mapAndLog(alertsResult.error) };
  }
  if (gymResult.error) {
    return { data: null, error: await mapAndLog(gymResult.error) };
  }
  // A failed session-alert read hides only those alerts, never the at-risk list.
  if (sessionAlertsResult.error) {
    console.error("[frontDeskAlerts] session_required alert read failed", sessionAlertsResult.error);
  }

  const rows = (alertsResult.data ?? []) as unknown as FrontDeskAlertRowFromDb[];
  const subscriptionAlerts: FrontDeskAlertRow[] = rows.map((row) => ({
    id: row.id,
    memberId: row.member_id,
    memberName: row.members?.name ?? "",
    memberPhotoUrl: row.members?.photo_url ?? null,
    kind: "subscription_status",
    status: row.status,
    expiryDate: row.expiry_date,
    createdAt: row.created_at,
  }));

  const sessionRows = sessionAlertsResult.error
    ? []
    : ((sessionAlertsResult.data ?? []) as unknown as FrontDeskAlertRowFromDb[]);
  const sessionContext = await loadSessionAlertContext(
    supabase,
    gymId,
    sessionRows.map((row) => row.member_id),
  );
  const sessionAlerts: FrontDeskAlertRow[] = sessionRows.map((row) => {
    const context = sessionContext.get(row.member_id);
    return {
      id: row.id,
      memberId: row.member_id,
      memberName: row.members?.name ?? "",
      memberPhotoUrl: row.members?.photo_url ?? null,
      kind: "session_required",
      status: null,
      expiryDate: null,
      createdAt: row.created_at,
      className: context?.className ?? null,
      scannedOfflineAt: context?.scannedOfflineAt ?? null,
      paymentInFlight: context?.paymentInFlight ?? false,
    };
  });

  // Newest first across both kinds, as the panel renders them.
  const alerts = [...subscriptionAlerts, ...sessionAlerts].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  );

  return {
    data: { alerts, autoDismissMinutes: gymResult.data.alert_auto_dismiss_minutes },
    error: null,
  };
}
