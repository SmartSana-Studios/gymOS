"use server";

import { PAGE_NAME_DECISION_ERROR_CODES, decideHeldPageNameSchema, type AppError } from "@gymos/types";

import { authorizeOrRedirect } from "@/lib/authz-action";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import { createClient } from "@/lib/supabase/server";
import { mapAndLog } from "@/services/gyms";

export interface HeldPageNameRow {
  id: string;
  gymId: string;
  gymName: string;
  name: string;
  origin: string;
  /** `code` or `code:detail` (the detail may be another gym's name: Super Admin only). */
  heldReason: string;
  heldAt: string;
  dueAt: string;
  overdue: boolean;
  currentName: string | null;
}

/** Story 24.7: the review queue, oldest first. The database admits only a live Super Admin; the gate here is the first layer. */
export async function listHeldPageNames(): Promise<{ data: HeldPageNameRow[] | null; error: AppError | null }> {
  const authz = await authorizeOrRedirect("platform.admin_access");
  if (!authz.ok) return { data: null, error: authz.error };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_held_page_names");
  if (error) return { data: null, error: await mapAndLog(error) };
  const rows = (data ?? []) as {
    id: string;
    gym_id: string;
    gym_name: string;
    name: string;
    origin: string;
    held_reason: string;
    held_at: string;
    due_at: string;
    overdue: boolean;
    current_name: string | null;
  }[];
  return {
    data: rows.map((r) => ({
      id: r.id,
      gymId: r.gym_id,
      gymName: r.gym_name,
      name: r.name,
      origin: r.origin,
      heldReason: r.held_reason,
      heldAt: r.held_at,
      dueAt: r.due_at,
      overdue: r.overdue,
      currentName: r.current_name,
    })),
    error: null,
  };
}

/**
 * Approve or reject a held name. A reason of 3 to 500 characters is required for both; the Owner is told the outcome and the
 * reason by a notice written in the database. Typed refusals (reason_required, not_held, reserved_name, name_taken) get their own copy.
 */
export async function decideHeldPageName(input: unknown): Promise<{ data: { state: string } | null; error: AppError | null }> {
  const authz = await authorizeOrRedirect("platform.admin_access");
  if (!authz.ok) return { data: null, error: authz.error };
  const { t } = await getServerTranslation(await getRequestLocale());

  const parsed = decideHeldPageNameSchema.safeParse(input);
  if (!parsed.success) {
    const reasonIssue = parsed.error.issues.some((i) => i.path[0] === "reason");
    return {
      data: null,
      error: { code: "validation_error", message: reasonIssue ? t("pageNames.errors.reason_required") : t("common.invalidInput") },
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("decide_held_page_name", {
    p_id: parsed.data.id,
    p_approve: parsed.data.approve,
    p_reason: parsed.data.reason,
  });
  if (error) {
    const message = String(error.message ?? "");
    const code = PAGE_NAME_DECISION_ERROR_CODES.find((c) => message.includes(`decide_held_page_name: ${c}`));
    if (code) return { data: null, error: { code, message: t(`pageNames.errors.${code}`) } };
    return { data: null, error: await mapAndLog(error) };
  }
  return { data: { state: String((data as { state?: unknown } | null)?.state ?? "") }, error: null };
}
