import { createClient } from "@/lib/supabase/server";
import { type AppError } from "@gymos/types";
import { mapAndLog } from "@/services/session";

export interface StaffNotice {
  id: string;
  noticeType: string;
  titleEn: string;
  titleFr: string;
  bodyEn: string;
  bodyFr: string;
  createdAt: string;
  readAt: string | null;
}

/** Story 23.9: the caller's own in-app notices for the gym they are in, newest first, and the unread count. */
export async function getStaffNotices(
  limit = 20,
): Promise<{ data: { notices: StaffNotice[]; unread: number } | null; error: AppError | null }> {
  const supabase = await createClient();
  const [list, count] = await Promise.all([
    supabase.rpc("get_staff_notices", { p_limit: limit }),
    supabase.rpc("count_unread_staff_notices"),
  ]);
  if (list.error) return { data: null, error: await mapAndLog(list.error) };
  if (count.error) return { data: null, error: await mapAndLog(count.error) };
  return {
    data: {
      notices: (list.data ?? []).map((n: NonNullable<typeof list.data>[number]) => ({
        id: n.id,
        noticeType: n.notice_type,
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

export async function markStaffNoticesRead(ids?: string[]): Promise<{ error: AppError | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_staff_notices_read", { p_ids: ids ?? null });
  return { error: error ? await mapAndLog(error) : null };
}
