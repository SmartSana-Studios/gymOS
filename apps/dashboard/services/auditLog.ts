import { createClient } from "@/lib/supabase/server";
import { type AppError } from "@gymos/types";
import { mapAndLog, type MemberRole } from "@/services/session";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

// Story 7.2: Audit Log Dashboard Page (FR-068, FR-079/080/081, AD-12).
// Read-only service layer backing /audit -- the real enforcement is
// manager_or_owner_read_own_audit_log (0049_audit_log_dashboard_read_policy.sql),
// this file's own .eq("gym_id", gymId) below is defense-in-depth only, same
// discipline as every other service function in this codebase.

/** Every function in this file needs the caller's own `gym_id` (and, for
 * `exportAuditLogCsv`'s Owner-only gate, `role`) -- copied verbatim from
 * subscriptions.ts's own (unexported) helper rather than reaching across
 * service files, matching this app's established per-file-copy discipline.
 * Extended beyond that copy to also return `role` (`claims.app_role as
 * MemberRole`, per session.ts's own claims-derived role read). */
async function getCallerGymId(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ gymId: string | null; role: MemberRole | null; error: AppError | null }> {
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();

  if (claimsError) {
    return { gymId: null, role: null, error: await mapAndLog(claimsError) };
  }

  const claims = claimsData?.claims as { gym_id?: string; app_role?: string } | undefined;
  const gymId = claims?.gym_id ?? null;
  const role = (claims?.app_role as MemberRole | undefined) ?? null;
  if (!gymId) {
    console.warn("[auditLog] getCallerGymId: no gym_id claim on caller's session");
    const { t } = await getServerTranslation(await getRequestLocale());
    return { gymId: null, role, error: { code: "not_found", message: t("common.somethingWentWrong") } };
  }

  return { gymId, role, error: null };
}

// Copied verbatim from subscriptions.ts's own csvEscape -- per-file-copy
// convention (OWASP CSV-injection guard), not a cross-file import.
function csvEscape(value: string): string {
  const safeValue = /^[=+\-@]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(safeValue)) {
    return `"${safeValue.replace(/"/g, '""')}"`;
  }
  return safeValue;
}

// Date-boundary helpers copied from attendance.ts -- per-file-copy
// discipline, not a cross-file import. This file's default fallback is
// "last 7 days" (AC #2), not attendance's "today".
function dateStartIso(dateStr: string): string {
  return `${dateStr}T00:00:00.000Z`;
}

function dateEndExclusiveIso(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return next.toISOString();
}

/** True only for a real, well-formed calendar date (rejects "2026-02-30",
 * not just malformed strings) -- `Date.UTC` silently rolls invalid
 * day/month values over into the next period instead of erroring. */
function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Resolves a caller-supplied `from`/`to` query param to a safe date
 * string, falling back to `fallback` when absent OR malformed -- a
 * hand-edited URL or a cleared `<input type="date">` (which emits `""`,
 * not `undefined`) both reach here. */
export function resolveDateParam(value: string | undefined, fallback: string): string {
  return value && isValidDateString(value) ? value : fallback;
}

/** Default date range: [today - 7 days, today] (AC #2's literal default),
 * not attendance.ts's default-to-today-only. */
export function defaultAuditLogDateRange(): { from: string; to: string } {
  const today = new Date();
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - 7);
  return { from: from.toISOString().slice(0, 10), to: today.toISOString().slice(0, 10) };
}

/** Resolves caller-supplied `from`/`to` params against the default range,
 * then swaps them if `from` ends up after `to` -- a hand-edited URL
 * supplying an inverted range would otherwise silently produce an empty
 * result with no indication why. Callers (route + client props) should use
 * this instead of resolving `from`/`to` independently, so the rendered date
 * filters always reflect the range actually queried. */
export function resolveAuditDateRange(
  fromParam: string | undefined,
  toParam: string | undefined,
): { from: string; to: string } {
  const defaults = defaultAuditLogDateRange();
  const from = resolveDateParam(fromParam, defaults.from);
  const to = resolveDateParam(toParam, defaults.to);
  return from > to ? { from: to, to: from } : { from, to };
}

// FR-068's literal value (prd.md, EXPERIENCE.md) -- not a mockup-derived
// guess like Subscriptions' 25.
export const AUDIT_LOG_PAGE_SIZE = 50;

// Own per-file copy, matching members.ts/subscriptions.ts's identical
// constants -- AC #4's extrapolated 1,000-row export cap.
const AUDIT_LOG_EXPORT_ROW_LIMIT = 1000;

export interface AuditLogRow {
  id: string;
  actorId: string | null;
  actorDisplayName: string;
  actionType: string;
  targetEntityId: string | null;
  targetEntityType: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface AuditLogRowFromDb {
  id: string;
  actor_id: string | null;
  actor_display_name: string;
  action_type: string;
  target_entity_id: string | null;
  target_entity_type: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

function toAuditLogRow(row: AuditLogRowFromDb): AuditLogRow {
  return {
    id: row.id,
    actorId: row.actor_id,
    actorDisplayName: row.actor_display_name,
    actionType: row.action_type,
    targetEntityId: row.target_entity_id,
    targetEntityType: row.target_entity_type,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}

/** Chains `.gte`/`.lt` on `created_at` and, if `actorId` is present,
 * `.eq("actor_id", actorId)` -- same defensive-against-hand-edited-params
 * discipline as subscriptions.ts's applySubscriptionFilters. */
function applyAuditLogFilters<T>(query: T, params: { from: string; to: string; actorId?: string }): T {
  type ChainableFilter = { gte(column: string, value: unknown): ChainableFilter; lt(column: string, value: unknown): ChainableFilter; eq(column: string, value: unknown): ChainableFilter };
  let next = query as unknown as ChainableFilter;
  next = next.gte("created_at", dateStartIso(params.from)).lt("created_at", dateEndExclusiveIso(params.to));
  if (params.actorId) {
    next = next.eq("actor_id", params.actorId);
  }
  return next as unknown as T;
}

/** AC #1, #2: filter/paginate the caller's own gym's audit_log, newest
 * first. No sortable columns -- AD-12 specifies fixed newest-first order
 * only, unlike Subscriptions' sortable table. `.eq("gym_id", gymId)` is
 * defense-in-depth even though RLS (0049) already scopes this -- every
 * service function in this codebase double-checks (subscriptions.ts's own
 * stated discipline). */
export async function listAuditLog(params: {
  from?: string;
  to?: string;
  actorId?: string;
  page?: number;
}): Promise<{ data: { rows: AuditLogRow[]; total: number } | null; error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const { from, to } = resolveAuditDateRange(params.from, params.to);

  const page = params.page && params.page > 0 ? params.page : 1;
  const rangeFrom = (page - 1) * AUDIT_LOG_PAGE_SIZE;
  const rangeTo = rangeFrom + AUDIT_LOG_PAGE_SIZE - 1;

  let query = supabase.from("audit_log").select("*", { count: "exact" }).eq("gym_id", gymId);
  query = applyAuditLogFilters(query, { from, to, actorId: params.actorId });
  query = query.order("created_at", { ascending: false }).range(rangeFrom, rangeTo);

  const { data, count, error } = await query;

  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }

  return {
    data: {
      rows: ((data ?? []) as unknown as AuditLogRowFromDb[]).map(toAuditLogRow),
      total: count ?? 0,
    },
    error: null,
  };
}

export interface AuditActorOption {
  actorId: string;
  actorDisplayName: string;
}

/** AC #2: backs the Actor filter dropdown. No exact precedent for a
 * "distinct values for a filter dropdown" query exists in this codebase --
 * a capped client-side de-dup rather than a new SQL RPC function (simpler,
 * consistent with this codebase's preference for avoiding new SQL
 * functions unless a write path needs SECURITY DEFINER). */
export async function listAuditActors(): Promise<{ data: AuditActorOption[] | null; error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const { data, error } = await supabase
    .from("audit_log")
    .select("actor_id, actor_display_name")
    .eq("gym_id", gymId)
    .not("actor_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }

  const rows = (data ?? []) as unknown as { actor_id: string; actor_display_name: string }[];
  const byActorId = new Map<string, AuditActorOption>();
  for (const row of rows) {
    if (!byActorId.has(row.actor_id)) {
      byActorId.set(row.actor_id, { actorId: row.actor_id, actorDisplayName: row.actor_display_name });
    }
  }

  return { data: Array.from(byActorId.values()), error: null };
}

export type ExportAuditLogCsvResult = { data: string; error: null } | { data: null; error: AppError };

/** AC #4: mirrors exportSubscriptionsCsv()'s exact structure (count-then-data
 * two-query shape, `export_too_large` if the filtered count exceeds
 * AUDIT_LOG_EXPORT_ROW_LIMIT), with one addition ahead of all of that: an
 * Owner-only role gate. RLS/gym scoping alone cannot enforce this
 * distinction -- Manager and Owner share identical read access to the
 * underlying rows (0049's policy is deliberately not role-split) -- so this
 * check must live here, in the service layer, not just the UI. */
export async function exportAuditLogCsv(params: {
  from?: string;
  to?: string;
  actorId?: string;
}): Promise<ExportAuditLogCsvResult> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const supabase = await createClient();
  const { gymId, role, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError ?? { code: "not_found", message: t("common.somethingWentWrong") } };
  }

  if (role !== "owner") {
    return { data: null, error: { code: "forbidden", message: t("audit.errors.exportOwnerOnly") } };
  }

  const { from, to } = resolveAuditDateRange(params.from, params.to);

  let countQuery = supabase
    .from("audit_log")
    .select("*", { count: "exact", head: true })
    .eq("gym_id", gymId);
  countQuery = applyAuditLogFilters(countQuery, { from, to, actorId: params.actorId });

  const { count, error: countError } = await countQuery;
  if (countError) {
    return { data: null, error: await mapAndLog(countError) };
  }
  if ((count ?? 0) > AUDIT_LOG_EXPORT_ROW_LIMIT) {
    return { data: null, error: { code: "export_too_large", message: t("audit.errors.exportTooLarge") } };
  }

  let dataQuery = supabase.from("audit_log").select("*").eq("gym_id", gymId);
  dataQuery = applyAuditLogFilters(dataQuery, { from, to, actorId: params.actorId });
  dataQuery = dataQuery.order("created_at", { ascending: false }).range(0, AUDIT_LOG_EXPORT_ROW_LIMIT - 1);

  const { data, error } = await dataQuery;
  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }

  const header = ["timestamp", "actor", "action_type", "target_entity_type", "target_entity_id", "metadata"];
  const lines = [header.join(",")];

  for (const row of ((data ?? []) as unknown as AuditLogRowFromDb[]).map(toAuditLogRow)) {
    lines.push(
      [
        csvEscape(row.createdAt),
        csvEscape(row.actorDisplayName),
        csvEscape(row.actionType),
        csvEscape(row.targetEntityType ?? ""),
        csvEscape(row.targetEntityId ?? ""),
        csvEscape(JSON.stringify(row.metadata ?? {})),
      ].join(","),
    );
  }

  return { data: lines.join("\r\n"), error: null };
}
