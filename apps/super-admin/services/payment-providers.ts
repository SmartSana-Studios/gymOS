import { createClient } from "@/lib/supabase/server";
import { type AppError } from "@gymos/types";
import { mapAndLog } from "@/services/gyms";

export interface PaymentProviderRow {
  id: string;
  providerKey: string;
  displayName: string;
  isActive: boolean;
}

/** Story 4.1 AC #6: every registered provider and which one is active. */
export async function listPaymentProviders(): Promise<{
  data: PaymentProviderRow[] | null;
  error: AppError | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("payment_providers")
    .select("id, provider_key, display_name, is_active")
    .order("display_name", { ascending: true });

  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }

  const rows: PaymentProviderRow[] = (data ?? []).map((row) => ({
    id: row.id,
    providerKey: row.provider_key,
    displayName: row.display_name,
    isActive: row.is_active,
  }));

  return { data: rows, error: null };
}

/** Thin RPC wrapper over activate_payment_provider() -- the only sanctioned
 * write path into payment_providers (AC #7's atomicity/audit guarantee
 * lives in the RPC itself, not here). */
export async function activatePaymentProvider(
  providerKey: string,
): Promise<{ error: AppError | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("activate_payment_provider", {
    p_provider_key: providerKey,
  });

  if (error) {
    return { error: await mapAndLog(error) };
  }
  return { error: null };
}
