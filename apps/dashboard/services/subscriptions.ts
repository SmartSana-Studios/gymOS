import { createClient } from "@/lib/supabase/server";
import {
  confirmRenewalSchema,
  renewSubscriptionSchema,
  type ConfirmRenewalInput,
  type RenewSubscriptionInput,
  type AppError,
} from "@gymos/types";
import { mapAndLog } from "@/services/session";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/** Story 3.2: Manual Renewal Reset. Backend-only story (no `actions.ts`/UI
 * yet -- Epic 4 Stories 4.7/4.8 own that) -- this service function is
 * currently the outermost boundary receiving this input, so it validates
 * here rather than trusting an already-parsed caller the way most other
 * service functions in this file do (e.g. `insertSubscription`), matching
 * `createMember`'s `actions.ts`-layer validate-then-map-generic-error
 * pattern since no `actions.ts` exists yet to own that step. Calls the
 * `renew_subscription()` SECURITY DEFINER RPC (0022_manual_renewal_reset.sql),
 * which does the real work (INSERTs a new `subscriptions` row rather than
 * mutating the member's existing one -- renewal-as-history, not
 * renewal-as-mutation) and self-enforces the owner/manager/receptionist role
 * check internally. */
export async function renewSubscription(
  input: RenewSubscriptionInput,
): Promise<{ data: { id: string } | null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = renewSubscriptionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      data: null,
      error: { code: "validation_error", message: t("common.invalidInput") },
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("renew_subscription", {
    p_member_id: parsed.data.memberId,
    p_reason: parsed.data.reason,
  });

  if (error || !data) {
    return { data: null, error: await mapAndLog(error) };
  }

  return { data: { id: data as unknown as string }, error: null };
}

// ============================================================================
// Story 4.7: Inline Renewal Panel. `confirmRenewal` calls the new atomic
// `confirm_renewal()` RPC (0035_inline_renewal_panel.sql -- see that
// migration's own comment for why this is one function, not
// renewSubscription + recordManualPayment called back-to-back).
// `getRenewalPreview` is a plain read backing the panel's pre-population
// (AC #1) -- this file's first non-RPC table query, so it needs its own
// `gym_id` claim resolution; copied verbatim from payments.ts's
// getCallerGymId rather than a cross-import, matching that file's own
// established per-file-copy discipline.
// ============================================================================

async function getCallerGymId(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ gymId: string | null; error: AppError | null }> {
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();

  if (claimsError) {
    return { gymId: null, error: await mapAndLog(claimsError) };
  }

  const claims = claimsData?.claims as { gym_id?: string } | undefined;
  const gymId = claims?.gym_id ?? null;
  if (!gymId) {
    console.warn("[subscriptions] getCallerGymId: no gym_id claim on caller's session");
    const { t } = await getServerTranslation(await getRequestLocale());
    return { gymId: null, error: { code: "not_found", message: t("common.somethingWentWrong") } };
  }

  return { gymId, error: null };
}

export interface ConfirmedRenewal {
  paymentId: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  newExpiryDate: string | null;
}

interface ConfirmRenewalRpcRow {
  payment_id: string;
  subscription_id: string;
  amount: number;
  currency: string;
  new_expiry_date: string | null;
}

/**
 * AC #2, #3: validates via `confirmRenewalSchema`, calls `confirm_renewal()`.
 * `confirm_renewal` uses `out` parameters (not `returns table(...)`), so
 * Supabase's generated type is an untyped `Record<string, unknown>` --
 * cast to the row shape below, mirroring `renewSubscription`'s own
 * `data as unknown as string` precedent for the same reason.
 */
export async function confirmRenewal(
  input: ConfirmRenewalInput,
): Promise<{ data: ConfirmedRenewal | null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = confirmRenewalSchema.safeParse(input);
  if (!parsed.success) {
    return {
      data: null,
      error: { code: "validation_error", message: t("common.invalidInput") },
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("confirm_renewal", {
    p_member_id: parsed.data.memberId,
    p_method: parsed.data.method,
    p_reason: parsed.data.reason,
    p_backdate: parsed.data.backdate ?? false,
  });

  if (error || !data) {
    return { data: null, error: await mapAndLog(error) };
  }

  const row = data as unknown as ConfirmRenewalRpcRow;

  return {
    data: {
      paymentId: row.payment_id,
      subscriptionId: row.subscription_id,
      amount: row.amount,
      currency: row.currency,
      newExpiryDate: row.new_expiry_date,
    },
    error: null,
  };
}

export interface RenewalPreview {
  planName: string;
  price: number;
  currency: string;
  /** Story 4.12: the member's own E.164 phone, needed to offer the
   * automated Mobile Money (Tara Money) option -- `null` when the member has
   * no phone on file, in which case the panel must not offer that option
   * (initiatePaymentSchema requires a valid phone). Sourced from the same
   * query as plan/price rather than a second round-trip. */
  memberPhone: string | null;
}

interface RenewalPreviewRowFromDb {
  plans: { name: string; price: number; currency: string } | null;
  members: { phone: string | null } | null;
}

/**
 * AC #1: backs the panel's pre-population. Read-only, same "most recent
 * subscription -> plan" join pattern as `initiatePayment`
 * (apps/dashboard/services/payments.ts:79-86). A `null` plan (member has no
 * subscription at all) maps to a `not_found` AppError -- the panel shows
 * this as its own inline error state (Task 6), even though this specific
 * failure happens on open, not on confirm.
 */
export async function getRenewalPreview(
  memberId: string,
): Promise<{ data: RenewalPreview | null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const { data, error } = await supabase
    .from("subscriptions")
    .select("plans(name, price, currency), members(phone)")
    .eq("gym_id", gymId)
    .eq("member_id", memberId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }

  const row = data as unknown as RenewalPreviewRowFromDb | null;
  const plan = row?.plans ?? null;
  if (!plan) {
    console.warn(`[subscriptions] getRenewalPreview: member ${memberId} has no subscription/plan to preview`);
    return { data: null, error: { code: "not_found", message: t("renewalPanel.errors.noActivePlan") } };
  }

  return {
    data: { planName: plan.name, price: plan.price, currency: plan.currency, memberPhone: row?.members?.phone ?? null },
    error: null,
  };
}

// ============================================================================
// Story 4.8: Subscriptions Page & Manual Renewal. `listSubscriptions`/
// `exportSubscriptionsCsv` query the new `subscriptions_current` view
// (0037_subscriptions_page_manual_renewal.sql) instead of embedding, modeled
// directly on members.ts's `listMembers`/`exportMembersCsv` -- this view is
// what makes AC #1's "sortable by member name, status, and expiry date"
// possible at all (PostgREST cannot sort top-level rows by an embedded
// child's column).
// ============================================================================

// AD-08 mockup's own spec value (25 rows/page) -- matches MEMBERS_PAGE_SIZE's
// own mockup-sourced precedent (members.ts).
export const SUBSCRIPTIONS_PAGE_SIZE = 25;

// FR-066's exact 1,000-row export ceiling -- own per-file copy, matching
// members.ts's own per-file-copy discipline (not a shared import).
const SUBSCRIPTIONS_EXPORT_ROW_LIMIT = 1000;

export interface SubscriptionListRow {
  subscriptionId: string;
  memberId: string;
  memberName: string;
  memberPhone: string | null;
  planId: string;
  planName: string;
  planType: string;
  status: "active" | "expiring_soon" | "grace_period" | "expired";
  startDate: string;
  expiryDate: string | null;
}

interface SubscriptionCurrentRowFromDb {
  subscription_id: string;
  member_id: string;
  member_name: string;
  member_phone: string | null;
  plan_id: string;
  plan_name: string;
  plan_type: string;
  status: SubscriptionListRow["status"];
  start_date: string;
  expiry_date: string | null;
}

function toSubscriptionListRow(row: SubscriptionCurrentRowFromDb): SubscriptionListRow {
  return {
    subscriptionId: row.subscription_id,
    memberId: row.member_id,
    memberName: row.member_name,
    memberPhone: row.member_phone,
    planId: row.plan_id,
    planName: row.plan_name,
    planType: row.plan_type,
    status: row.status,
    startDate: row.start_date,
    expiryDate: row.expiry_date,
  };
}

const VALID_SUBSCRIPTION_STATUS_FILTERS = new Set(["active", "expiring_soon", "grace_period", "expired"]);
const VALID_PLAN_TYPE_FILTERS = new Set(["pay_per_session", "monthly", "coach_inclusive", "class_only"]);

// `?sort=`/`?dir=` are hand-editable URL params -- an invalid value must
// never reach `.order()` with an unvalidated column name, matching
// members.ts's own isValidStatusFilter defensive discipline.
const SORT_COLUMN_MAP: Record<string, string> = {
  name: "member_name",
  status: "status",
  expiry: "expiry_date",
};

function resolveSortColumn(sort: string | undefined): string {
  return (sort && SORT_COLUMN_MAP[sort]) || SORT_COLUMN_MAP.name;
}

function resolveSortAscending(dir: string | undefined): boolean {
  return dir !== "desc";
}

function applySubscriptionFilters<T>(query: T, params: { status?: string; planType?: string }): T {
  type ChainableFilter = { eq(column: string, value: unknown): ChainableFilter };
  let next = query as unknown as ChainableFilter;
  if (params.status && VALID_SUBSCRIPTION_STATUS_FILTERS.has(params.status)) {
    next = next.eq("status", params.status);
  }
  if (params.planType && VALID_PLAN_TYPE_FILTERS.has(params.planType)) {
    next = next.eq("plan_type", params.planType);
  }
  return next as unknown as T;
}

/** AC #1: filter/sort/paginate against `subscriptions_current`. The view
 * already excludes deactivated members' rows unconditionally via
 * `.is("deactivated_at", null)` -- no "deactivated" pseudo-status here,
 * unlike members.ts's `VALID_STATUS_FILTERS`. `.eq("gym_id", gymId)` is
 * defense-in-depth (the view's own `security_invoker = true` already
 * enforces this via RLS) -- matches every other service function's own
 * discipline of never relying on RLS alone. */
export async function listSubscriptions(params: {
  status?: string;
  planType?: string;
  sort?: string;
  dir?: string;
  page?: number;
}): Promise<{ data: { rows: SubscriptionListRow[]; total: number } | null; error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const page = params.page && params.page > 0 ? params.page : 1;
  const from = (page - 1) * SUBSCRIPTIONS_PAGE_SIZE;
  const to = from + SUBSCRIPTIONS_PAGE_SIZE - 1;

  let query = supabase
    .from("subscriptions_current")
    .select("*", { count: "exact" })
    .eq("gym_id", gymId)
    .is("deactivated_at", null);

  query = applySubscriptionFilters(query, params);
  query = query
    .order(resolveSortColumn(params.sort), { ascending: resolveSortAscending(params.dir) })
    .range(from, to);

  const { data, count, error } = await query;

  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }

  return {
    data: {
      rows: ((data ?? []) as unknown as SubscriptionCurrentRowFromDb[]).map(toSubscriptionListRow),
      total: count ?? 0,
    },
    error: null,
  };
}

// Copied verbatim from members.ts's own csvEscape -- per-file-copy
// convention (OWASP CSV-injection guard), not a cross-file import.
function csvEscape(value: string): string {
  const safeValue = /^[=+\-@]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(safeValue)) {
    return `"${safeValue.replace(/"/g, '""')}"`;
  }
  return safeValue;
}

export type ExportSubscriptionsCsvResult = { data: string; error: null } | { data: null; error: AppError };

/** AC #3: mirrors `exportMembersCsv()`'s exact structure -- a
 * `count: "exact", head: true` pre-check against the same 1,000-row ceiling,
 * returning the same `export_too_large` error code if exceeded, then a
 * capped data query. Column schema matches `exportMembersCsv()`'s header
 * exactly (AC #3: "same column schema as the Members export"), with
 * `last_check_in_date` always "" (no data source -- same reason as
 * `exportMembersCsv()`; the "Last Payment" column is deliberately cut, see
 * docs/decisions.md). */
export async function exportSubscriptionsCsv(params: {
  status?: string;
  planType?: string;
}): Promise<ExportSubscriptionsCsvResult> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError ?? { code: "not_found", message: t("common.somethingWentWrong") } };
  }

  let countQuery = supabase
    .from("subscriptions_current")
    .select("*", { count: "exact", head: true })
    .eq("gym_id", gymId)
    .is("deactivated_at", null);
  countQuery = applySubscriptionFilters(countQuery, params);

  const { count, error: countError } = await countQuery;
  if (countError) {
    return { data: null, error: await mapAndLog(countError) };
  }
  if ((count ?? 0) > SUBSCRIPTIONS_EXPORT_ROW_LIMIT) {
    return { data: null, error: { code: "export_too_large", message: t("subscriptions.errors.exportTooLarge") } };
  }

  let dataQuery = supabase
    .from("subscriptions_current")
    .select("*")
    .eq("gym_id", gymId)
    .is("deactivated_at", null);
  dataQuery = applySubscriptionFilters(dataQuery, params);
  dataQuery = dataQuery.order("member_name", { ascending: true }).range(0, SUBSCRIPTIONS_EXPORT_ROW_LIMIT - 1);

  const { data, error } = await dataQuery;
  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }

  const header = [
    "member_name",
    "phone",
    "plan_type",
    "join_date",
    "subscription_status",
    "expiry_date",
    "last_check_in_date",
  ];
  const lines = [header.join(",")];

  for (const row of (data ?? []) as unknown as (SubscriptionCurrentRowFromDb & {
    join_date: string;
  })[]) {
    lines.push(
      [
        csvEscape(row.member_name),
        csvEscape(row.member_phone ?? ""),
        csvEscape(row.plan_type),
        csvEscape(row.join_date),
        csvEscape(row.status),
        csvEscape(row.expiry_date ?? ""),
        "", // last_check_in_date: no data source (Scope Notes -- Last Payment column also cut)
      ].join(","),
    );
  }

  return { data: lines.join("\r\n"), error: null };
}
