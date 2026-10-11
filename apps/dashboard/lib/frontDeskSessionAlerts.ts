import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Story 19.9b: the follow-up reads a `session_required` front-desk alert needs
 * beyond its own row -- which class refused the member, whether the scan was
 * taken offline, and whether a Tara session payment is in flight. Shared by
 * the server reader (services/frontDeskAlerts.ts) and the browser reader
 * (lib/realtime/frontDeskAlerts.ts); both pass their own RLS-scoped client.
 * The reads are informational: a failed one leaves the alert showing without
 * that line, never fails the panel.
 */
export interface SessionAlertContext {
  /** The class the latest refused attempt came from, when it was a class attendance. */
  className: string | null;
  /** The scan time, when the latest refused attempt was scanned offline and synced late. */
  scannedOfflineAt: string | null;
  /** A pending/processing session payment exists for the member. */
  paymentInFlight: boolean;
}

// A scan whose recorded time trails the row's insert by more than this was
// taken offline and verified on sync (an online scan is inserted within
// moments of being scanned).
const OFFLINE_GAP_MS = 60_000;

const EMPTY_CONTEXT: SessionAlertContext = { className: null, scannedOfflineAt: null, paymentInFlight: false };

interface AttemptRow {
  member_id: string;
  scanned_at: string | null;
  created_at: string;
  class_session_id: string | null;
  // Dual-shape acceptance, same as services/classes.ts's embed handling.
  class_sessions:
    | { classes: { name: string } | { name: string }[] | null }
    | { classes: { name: string } | { name: string }[] | null }[]
    | null;
}

function className(row: AttemptRow): string | null {
  const session = Array.isArray(row.class_sessions) ? row.class_sessions[0] : row.class_sessions;
  const cls = Array.isArray(session?.classes) ? session?.classes[0] : session?.classes;
  return cls?.name ?? null;
}

export function emptySessionAlertContext(): SessionAlertContext {
  return { ...EMPTY_CONTEXT };
}

export async function loadSessionAlertContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  gymId: string,
  memberIds: string[],
): Promise<Map<string, SessionAlertContext>> {
  const result = new Map<string, SessionAlertContext>();
  const ids = [...new Set(memberIds)];
  if (ids.length === 0) return result;
  for (const id of ids) result.set(id, emptySessionAlertContext());

  const [attemptsResult, paymentsResult] = await Promise.all([
    supabase
      .from("session_attempts")
      .select("member_id, scanned_at, created_at, class_session_id, class_sessions(classes(name))")
      .eq("gym_id", gymId)
      .in("member_id", ids)
      .order("created_at", { ascending: false })
      .limit(Math.max(50, ids.length * 5)),
    supabase
      .from("payments")
      .select("member_id")
      .eq("gym_id", gymId)
      .eq("purpose", "session")
      .is("voided_at", null)
      .in("status", ["pending", "processing"])
      .in("member_id", ids),
  ]);

  if (!attemptsResult.error) {
    const seen = new Set<string>();
    for (const row of (attemptsResult.data ?? []) as unknown as AttemptRow[]) {
      // Rows come newest first: the first one per member is the latest attempt.
      if (seen.has(row.member_id)) continue;
      seen.add(row.member_id);
      const entry = result.get(row.member_id);
      if (!entry) continue;
      entry.className = row.class_session_id ? className(row) : null;
      if (row.scanned_at) {
        const gap = new Date(row.created_at).getTime() - new Date(row.scanned_at).getTime();
        if (gap > OFFLINE_GAP_MS) entry.scannedOfflineAt = row.scanned_at;
      }
    }
  }

  if (!paymentsResult.error) {
    for (const row of (paymentsResult.data ?? []) as unknown as { member_id: string }[]) {
      const entry = result.get(row.member_id);
      if (entry) entry.paymentInFlight = true;
    }
  }

  return result;
}
