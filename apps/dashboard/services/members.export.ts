import { createClient } from "@/lib/supabase/server";
import { type AppError } from "@gymos/types";
import { mapAndLog } from "@/services/session";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import { type MemberRowFromDb, applyMemberFilters, getCallerGymId, memberNotFoundError, usesSubscriptionInnerJoin } from "./members.shared";

// Members CSV export (split out of members.ts, Epic 20 retro G-2). members.ts re-exports the public names.

// FR-066's exact 1,000-row export ceiling.
const EXPORT_ROW_LIMIT = 1000;

export type ExportMembersCsvResult =
  | { data: string; error: null }
  | { data: null; error: AppError };

function csvEscape(value: string): string {
  // OWASP CSV-injection guard: a value starting with =, +, -, or @ is
  // interpreted as a formula by Excel/Sheets/etc. when the file is opened --
  // prefixing with a single quote forces those apps to render it as plain
  // text instead, without changing the value stored in the CSV cell itself.
  const safeValue = /^[=+\-@]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(safeValue)) {
    return `"${safeValue.replace(/"/g, '""')}"`;
  }
  return safeValue;
}

/** FR-066's exact, explicit CSV column list (also referenced by AD-08's
 * Subscriptions export as "same column schema") -- not a judgment call.
 * `last_check_in_date` has no data source yet (`attendance_events` is Epic
 * 3) -- always an empty column, never a fabricated value. Reuses
 * `listMembers`'s exact filter logic but with no pagination: a
 * `count: "exact", head: true` pre-check first; if it exceeds
 * EXPORT_ROW_LIMIT, returns `export_too_large` without fetching any rows
 * (AD-03: "Apply a filter to narrow results"). */
export async function exportMembersCsv(params: {
  search?: string;
  status?: string;
}): Promise<ExportMembersCsvResult> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError ?? (await memberNotFoundError("no gymId or error from getCallerGymId in exportMembersCsv")) };
  }

  const useInnerJoin = usesSubscriptionInnerJoin(params.status);
  const subscriptionsSelect = useInnerJoin
    ? "subscriptions!inner(status, expiry_date, plan_id, created_at, plans(name, plan_type))"
    : "subscriptions(status, expiry_date, plan_id, created_at, plans(name, plan_type))";

  let countQuery = supabase
    .from("members")
    .select(`id, ${subscriptionsSelect}`, { count: "exact", head: true })
    .eq("gym_id", gymId)
    .eq("role", "member");
  countQuery = applyMemberFilters(countQuery, params);

  const { count, error: countError } = await countQuery;
  if (countError) {
    return { data: null, error: await mapAndLog(countError) };
  }
  if ((count ?? 0) > EXPORT_ROW_LIMIT) {
    const { t } = await getServerTranslation(await getRequestLocale());
    return { data: null, error: { code: "export_too_large", message: t("members.errors.exportTooLarge") } };
  }

  let dataQuery = supabase
    .from("members")
    .select(`id, name, phone, email, join_date, deactivated_at, birth_year, profession, neighborhood, ${subscriptionsSelect}`)
    .eq("gym_id", gymId)
    .eq("role", "member")
    .order("name", { ascending: true })
    .order("created_at", { referencedTable: "subscriptions", ascending: false })
    .limit(1, { referencedTable: "subscriptions" });
  dataQuery = applyMemberFilters(dataQuery, params);
  dataQuery = dataQuery.range(0, EXPORT_ROW_LIMIT - 1);

  const { data, error } = await dataQuery;
  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }

  // Matches CSV_TEMPLATE_COLUMNS' order (packages/types/src/schemas/csvImport.ts)
  // so a user exporting then re-importing their own file sees the same
  // column order, plus this export's own trailing last_check_in_date column
  // (not part of the import template).
  const header = [
    "member_name",
    "phone",
    "plan_type",
    "join_date",
    "subscription_status",
    "expiry_date",
    "last_check_in_date",
    // Story 26.1: profile fields, appended after the existing columns.
    "birth_year",
    "profession",
    "neighborhood",
  ];
  const lines = [header.join(",")];

  for (const row of (data ?? []) as unknown as MemberRowFromDb[]) {
    const sub = row.subscriptions?.[0] ?? null;
    lines.push(
      [
        csvEscape(row.name),
        csvEscape(row.phone ?? ""),
        csvEscape(sub?.plans?.plan_type ?? ""),
        csvEscape(row.join_date),
        csvEscape(sub?.status ?? ""),
        csvEscape(sub?.expiry_date ?? ""),
        "", // last_check_in_date: no data source yet (attendance_events is Epic 3)
        row.birth_year == null ? "" : String(row.birth_year),
        csvEscape(row.profession ?? ""),
        csvEscape(row.neighborhood ?? ""),
      ].join(","),
    );
  }

  return { data: lines.join("\r\n"), error: null };
}
