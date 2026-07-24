import { createClient } from "@/lib/supabase/server";
import { type AppError } from "@gymos/types";
import { mapAndLog } from "@/services/gyms";

export interface PlatformMetrics {
  totalGyms: number;
  totalMembers: number;
  totalPaymentsProcessed: number;
  activeGyms: number;
  suspendedGyms: number;
  deactivatedGyms: number;
}

/** SA-05 Platform Metrics. Calls the platform_metrics() SECURITY DEFINER
 * RPC (0011 migration) rather than querying gyms/members/payments
 * directly -- that function is the one place aggregate-only access to
 * every gym's data is granted without broadening any row-level SELECT
 * policy (see migration comments). */
export async function getPlatformMetrics(): Promise<{
  data: PlatformMetrics | null;
  error: AppError | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_metrics").maybeSingle();

  if (error || !data) {
    return { data: null, error: await mapAndLog(error) };
  }

  // The Supabase client factories in this app aren't parameterized with the
  // generated `Database` type (established convention -- see the same
  // `as unknown as` casts in services/gyms.ts for embedded-select shapes),
  // so `rpc()`'s return type doesn't resolve to platform_metrics()'s real
  // column shape without an explicit cast here.
  const row = data as unknown as {
    total_gyms: number;
    total_members: number;
    total_payments_processed: number;
    active_gyms: number;
    suspended_gyms: number;
    deactivated_gyms: number;
  };

  return {
    data: {
      totalGyms: Number(row.total_gyms),
      totalMembers: Number(row.total_members),
      totalPaymentsProcessed: Number(row.total_payments_processed),
      activeGyms: Number(row.active_gyms),
      suspendedGyms: Number(row.suspended_gyms),
      deactivatedGyms: Number(row.deactivated_gyms),
    },
    error: null,
  };
}

export interface JobFailure {
  id: string;
  jobName: string;
  startedAt: string;
  finishedAt: string | null;
  // Named `errorMessage`, not `error` -- this sits inside the `data` array of
  // a `{ data, error }` result tuple; a same-named `error` field one level
  // down from the tuple's own `error: AppError | null` is a readability trap
  // for a caller doing `const { error } = await getRecentJobFailures()`.
  errorMessage: string | null;
}

/** Story 3.1: recent pg_cron job failures, for the metrics page's
 * job-failure alert (AC #4). Calls the super_admin_job_failures()
 * SECURITY DEFINER RPC (0021 migration) -- same pattern as
 * getPlatformMetrics() above, since job_runs itself stays RLS-deny-all
 * with zero policies (Story 1.4). */
export async function getRecentJobFailures(): Promise<{
  data: JobFailure[] | null;
  error: AppError | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("super_admin_job_failures");

  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }

  const rows = (data ?? []) as unknown as {
    id: string;
    job_name: string;
    started_at: string;
    finished_at: string | null;
    error: string | null;
  }[];

  return {
    data: rows.map((row) => ({
      id: row.id,
      jobName: row.job_name,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      errorMessage: row.error,
    })),
    error: null,
  };
}
