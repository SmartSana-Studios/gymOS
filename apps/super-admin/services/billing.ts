import { createClient } from "@/lib/supabase/server";
import { type AppError } from "@gymos/types";
import { mapAndLog } from "@/services/gyms";

export interface GymBillingRow {
  id: string;
  name: string;
  /** `gyms.status` (active/suspended/deactivated) -- carried alongside the
   * `saas_billing_status` columns below so this row is a superset of
   * `GymListRow`'s `{id, name, status}` shape, letting `<GymLifecycleDialog>`
   * (Story 1.6) drop in unchanged for the Suspend/Reactivate row action. */
  status: string;
  tierName: string;
  saasBillingInterval: string;
  saasBillingStatus: string;
  nextBillingDate: string;
  lastPaymentDate: string | null;
  failedAttemptCount: number;
}

const GYM_BILLING_PAGE_SIZE = 20;

export interface ListGymsBillingParams {
  page?: number; // 1-indexed
  search?: string;
  status?: "active" | "past_due" | "grace_period" | "suspended";
}

export interface GymBillingPage {
  rows: GymBillingRow[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * SA-07 Billing view. Filters/searches against `saas_billing_status` (the
 * platform's own billing-relationship clock, Story 11.2), never `gyms.status`
 * -- the two are adjacent-but-distinct state machines, and `GymsPageClient`'s
 * own `STATUS_OPTIONS` filters the wrong column for this page's purposes.
 *
 * `saas_billing_payments`' "last payment"/"failed attempts" columns need a
 * second, batched query (`.in("gym_id", ids)`) -- there's no natural
 * one-to-one PostgREST embedding for "latest verified row per gym", and this
 * page's row count is small (every gym, not a hot path), so a plain second
 * round trip is simpler than a single nested-relation query.
 */
export async function listGymsBilling(
  params: ListGymsBillingParams = {},
): Promise<{ data: GymBillingPage | null; error: AppError | null }> {
  const supabase = await createClient();
  let page =
    params.page && Number.isInteger(params.page) && params.page > 0 ? params.page : 1;

  function buildQuery(forPage: number) {
    const from = (forPage - 1) * GYM_BILLING_PAGE_SIZE;
    const to = from + GYM_BILLING_PAGE_SIZE - 1;

    let query = supabase
      .from("gyms")
      .select(
        `id, name, status, saas_billing_interval, saas_billing_status, saas_billing_anchor_date,
         tiers ( name )`,
        { count: "exact" },
      )
      .order("name", { ascending: true })
      .range(from, to);

    if (params.search) {
      // Escape ilike's wildcard characters ('%', '_') and the escape
      // character itself ('\') -- otherwise a literal backslash in the search
      // term corrupts the pattern instead of matching literally (same
      // precedent as listGyms()).
      const escaped = params.search.replace(/[\\%_]/g, (char) => `\\${char}`);
      query = query.ilike("name", `%${escaped}%`);
    }
    if (params.status) {
      query = query.eq("saas_billing_status", params.status);
    }
    return query;
  }

  let { data, error, count } = await buildQuery(page);
  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }

  // Review fix: a requested page beyond the real last page (an override
  // action shrank `total` after a filtered row changed status, or a
  // directly-edited `?page=` URL param) previously returned an empty page
  // with a misleading "no gyms match" message. Clamp to the real last page
  // and re-query once instead.
  const realTotalPages = Math.max(1, Math.ceil((count ?? 0) / GYM_BILLING_PAGE_SIZE));
  if ((data ?? []).length === 0 && count && count > 0 && page > realTotalPages) {
    page = realTotalPages;
    ({ data, error, count } = await buildQuery(page));
    if (error) {
      return { data: null, error: await mapAndLog(error) };
    }
  }

  const gymIds = (data ?? []).map((gym) => gym.id);
  const { data: summaries, error: summariesError } = await loadBillingPaymentSummaries(
    supabase,
    gymIds,
  );
  if (summariesError) {
    return { data: null, error: summariesError };
  }

  const rows: GymBillingRow[] = (data ?? []).map((gym) => {
    const summary = summaries.get(gym.id) ?? { lastPaymentDate: null, failedAttemptCount: 0 };
    return {
      id: gym.id,
      name: gym.name,
      status: gym.status,
      tierName: (gym.tiers as unknown as { name: string } | null)?.name ?? "—",
      saasBillingInterval: gym.saas_billing_interval,
      saasBillingStatus: gym.saas_billing_status,
      nextBillingDate: gym.saas_billing_anchor_date,
      lastPaymentDate: summary.lastPaymentDate,
      failedAttemptCount: summary.failedAttemptCount,
    };
  });

  return {
    data: { rows, total: count ?? 0, page, pageSize: GYM_BILLING_PAGE_SIZE },
    error: null,
  };
}

/**
 * "Failed attempt count" (FR-134) is derived, not stored -- `payment_status`
 * has no `'failed'` value; `'flagged'` (the outcome of a declined/failed Flow
 * B webhook event, see `payment-webhook/index.ts`) is the closest real
 * analog in this schema. All-time, not scoped to the current billing cycle --
 * no column exists to scope it to "this cycle" either, matching SA-07's own
 * plain-integer mockup with no cycle qualifier. "Last payment" is the most
 * recent `verified` row's `created_at`.
 */
async function loadBillingPaymentSummaries(
  supabase: Awaited<ReturnType<typeof createClient>>,
  gymIds: string[],
): Promise<{
  data: Map<string, { lastPaymentDate: string | null; failedAttemptCount: number }>;
  error: AppError | null;
}> {
  const summaries = new Map<string, { lastPaymentDate: string | null; failedAttemptCount: number }>();
  if (gymIds.length === 0) {
    return { data: summaries, error: null };
  }

  const { data, error } = await supabase
    .from("saas_billing_payments")
    .select("gym_id, status, created_at")
    .in("gym_id", gymIds);

  if (error) {
    return { data: summaries, error: await mapAndLog(error) };
  }

  for (const row of data ?? []) {
    const existing = summaries.get(row.gym_id) ?? { lastPaymentDate: null, failedAttemptCount: 0 };
    if (row.status === "verified" && (!existing.lastPaymentDate || row.created_at > existing.lastPaymentDate)) {
      existing.lastPaymentDate = row.created_at;
    }
    if (row.status === "flagged") {
      existing.failedAttemptCount += 1;
    }
    summaries.set(row.gym_id, existing);
  }

  return { data: summaries, error: null };
}
