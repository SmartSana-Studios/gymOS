"use client";

import { createClient } from "@/lib/supabase/client";
import { dismissFrontDeskAlertSchema, mapSupabaseError, type AppError } from "@gymos/types";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { FrontDeskAlertRow } from "@/services/frontDeskAlerts";

// front_desk_alerts.status only ever carries the 3 at-risk values (the
// table's own CHECK constraint, 0034_real_time_front_desk_alert.sql) --
// mirrors services/frontDeskAlerts.ts's own local FrontDeskAlertStatus type
// (per-file-copy discipline, no cross-file import).
export type FrontDeskAlertStatus = "expiring_soon" | "grace_period" | "expired";

export interface FrontDeskAlertRealtimeRow {
  id: string;
  member_id: string;
  status: FrontDeskAlertStatus;
  expiry_date: string | null;
  created_at: string;
  dismissed_at: string | null;
}

/**
 * Story 4.6: this codebase's first use of Supabase Realtime
 * (architecture.md lines 141, 176). A `postgres_changes` INSERT/UPDATE
 * payload only ever carries `front_desk_alerts`' own columns -- never the
 * member's `name`/`photo_url` (Scope Notes) -- `resolveMemberDisplay` below
 * is the follow-up read a caller uses to fill those in.
 *
 * Realtime security is RLS-driven, not filter-driven: `filter:
 * gym_id=eq.${gymId}` below is an efficiency optimization only -- the real
 * security boundary is `gym_staff_read_own_front_desk_alerts`
 * (0034_real_time_front_desk_alert.sql), which Realtime evaluates per
 * subscribing client before ever delivering a row.
 */
export function subscribeToFrontDeskAlerts(
  gymId: string,
  onInsertOrUpdate: (row: FrontDeskAlertRealtimeRow) => void,
  onStatusChange: (status: string) => void,
): RealtimeChannel {
  const supabase = createClient();
  const channel = supabase
    .channel(`gym:${gymId}:alerts`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "front_desk_alerts", filter: `gym_id=eq.${gymId}` },
      (payload) => onInsertOrUpdate(payload.new as FrontDeskAlertRealtimeRow),
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "front_desk_alerts", filter: `gym_id=eq.${gymId}` },
      (payload) => onInsertOrUpdate(payload.new as FrontDeskAlertRealtimeRow),
    )
    .subscribe((status) => onStatusChange(status));

  return channel;
}

export interface MemberDisplay {
  name: string;
  photoUrl: string | null;
}

/** The realtime-payload follow-up read (Scope Notes) -- resolves the
 * member's display fields for a row a subscribing client didn't already
 * have cached. RLS-scoped like every other browser-native read in this
 * file. */
export async function resolveMemberDisplay(memberId: string): Promise<{ data: MemberDisplay | null; error: AppError | null }> {
  const supabase = createClient();
  const { data, error } = await supabase.from("members").select("name, photo_url").eq("id", memberId).single();

  if (error || !data) {
    return { data: null, error: mapSupabaseError(error) };
  }
  return { data: { name: data.name, photoUrl: data.photo_url }, error: null };
}

/**
 * Direct browser-native write, not a Server Action -- matches Sidebar.tsx/
 * login-form.tsx's established precedent for `supabase.auth.*` usage
 * directly from client components, applied here to Realtime/dismiss for the
 * same reason (Scope Notes). RLS (`gym_staff_dismiss_own_front_desk_alerts`)
 * is the real authorization gate. The `.is("dismissed_at", null)` guard
 * makes a duplicate/racing dismiss (manual click racing an auto-dismiss
 * timer, or two sessions clicking simultaneously) a harmless no-op (0 rows
 * affected), not an error.
 *
 * Review finding (Story 4.6): `dismissed_by` is no longer sent from here --
 * the `front_desk_alerts_protect_columns` trigger (0034 migration) derives
 * it server-side from the caller's own JWT, closing a spoofing gap where a
 * client could otherwise assert an arbitrary user id.
 */
export async function dismissFrontDeskAlert(alertId: string): Promise<{ error: AppError | null }> {
  const parsed = dismissFrontDeskAlertSchema.safeParse({ alertId });
  if (!parsed.success) {
    return { error: mapSupabaseError(parsed.error) };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("front_desk_alerts")
    .update({ dismissed_at: new Date().toISOString() })
    .eq("id", parsed.data.alertId)
    .is("dismissed_at", null);

  if (error) {
    return { error: mapSupabaseError(error) };
  }
  return { error: null };
}

/**
 * Client-side auto-dismiss (default 30 min, gym-configured) -- writes
 * `dismissed_at` only, leaving `dismissed_by` null (Task 1's own schema
 * note: there is no "system" user row to attribute an auto-dismiss to).
 * Otherwise identical to `dismissFrontDeskAlert` above, including the same
 * `.is("dismissed_at", null)` no-op-on-race guard -- multiple open sessions
 * each scheduling their own timer for the same alert is expected, not a bug.
 */
export async function autoDismissFrontDeskAlert(alertId: string): Promise<{ error: AppError | null }> {
  const parsed = dismissFrontDeskAlertSchema.safeParse({ alertId });
  if (!parsed.success) {
    return { error: mapSupabaseError(parsed.error) };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("front_desk_alerts")
    .update({ dismissed_at: new Date().toISOString() })
    .eq("id", parsed.data.alertId)
    .is("dismissed_at", null);

  if (error) {
    return { error: mapSupabaseError(error) };
  }
  return { error: null };
}

interface FrontDeskAlertRowFromDb {
  id: string;
  member_id: string;
  status: FrontDeskAlertStatus;
  expiry_date: string | null;
  created_at: string;
  members: { name: string; photo_url: string | null } | null;
}

/**
 * The polling-degrade path's `queryFn` (Task 8's own polling requirement) --
 * a thin, browser-native equivalent of services/frontDeskAlerts.ts's own
 * `listActiveFrontDeskAlerts` (same query shape, per-file-copy discipline,
 * cookie-based server client swapped for the browser one since this module
 * can only ever run client-side).
 *
 * Review finding (Story 4.6): throws on a Supabase error rather than
 * returning `[]` -- this function is invoked as TanStack Query's `queryFn`
 * during the polling-degrade path specifically, and a swallowed error there
 * would overwrite the cache with an empty list, wiping every currently
 * displayed alert on exactly the transient-failure case polling exists to
 * ride out. Throwing lets TanStack Query treat it as a failed fetch and
 * keep the last-known-good data instead.
 */
export async function fetchActiveFrontDeskAlerts(gymId: string): Promise<FrontDeskAlertRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("front_desk_alerts")
    .select("id, member_id, status, expiry_date, created_at, members(name, photo_url)")
    .eq("gym_id", gymId)
    .is("dismissed_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data as unknown as FrontDeskAlertRowFromDb[]).map((row) => ({
    id: row.id,
    memberId: row.member_id,
    memberName: row.members?.name ?? "",
    memberPhotoUrl: row.members?.photo_url ?? null,
    status: row.status,
    expiryDate: row.expiry_date,
    createdAt: row.created_at,
  }));
}
