"use server";

import type { AppError } from "@gymos/types";
import { authorizeOrRedirect } from "@/lib/authz-action";
import { createClient } from "@/lib/supabase/server";
import { mapAndLog } from "@/services/gyms";

export interface AdminNotice {
  id: string;
  titleEn: string;
  titleFr: string;
  bodyEn: string;
  bodyFr: string;
  createdAt: string;
  readAt: string | null;
}

/**
 * Story 23.9: the header bell. Every Super Admin gets their own copy of a payment-connection alert (the database writes one per Super
 * Admin); both functions read and write only the caller's own rows. The text names the gym and the action, never an individual.
 */
export async function getAdminNotices(): Promise<{ data: { notices: AdminNotice[]; unread: number } | null; error: AppError | null }> {
  const authz = await authorizeOrRedirect("platform.admin_access");
  if (!authz.ok) return { data: null, error: authz.error };
  const supabase = await createClient();
  const [list, count] = await Promise.all([
    supabase.rpc("get_staff_notices", { p_limit: 20 }),
    supabase.rpc("count_unread_staff_notices"),
  ]);
  if (list.error) return { data: null, error: await mapAndLog(list.error) };
  if (count.error) return { data: null, error: await mapAndLog(count.error) };
  return {
    data: {
      notices: (list.data ?? []).map((n: NonNullable<typeof list.data>[number]) => ({
        id: n.id,
        titleEn: n.title_en,
        titleFr: n.title_fr,
        bodyEn: n.body_en,
        bodyFr: n.body_fr,
        createdAt: n.created_at,
        readAt: n.read_at,
      })),
      unread: count.data ?? 0,
    },
    error: null,
  };
}

export async function markAdminNoticesRead(): Promise<{ error: AppError | null }> {
  const authz = await authorizeOrRedirect("platform.admin_access");
  if (!authz.ok) return { error: authz.error };
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_staff_notices_read", { p_ids: null });
  return { error: error ? await mapAndLog(error) : null };
}
