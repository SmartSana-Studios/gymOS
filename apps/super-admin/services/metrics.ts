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
    return { data: null, error: mapAndLog(error) };
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
