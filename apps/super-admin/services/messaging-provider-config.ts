import { createClient } from "@/lib/supabase/server";
import { type AppError } from "@gymos/types";
import { mapAndLog } from "@/services/gyms";

export interface MessagingInstance {
  instanceId: string | null;
  updatedAt: string | null;
}

/** Story 1.13 AC #1: the singleton row's current instance ID (or null if
 * not yet configured). */
export async function getMessagingInstance(): Promise<{
  data: MessagingInstance | null;
  error: AppError | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("messaging_provider_config")
    .select("instance_id, updated_at")
    .maybeSingle();

  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }

  // `.maybeSingle()`, not `.single()`: the singleton row is seeded by
  // migration 0050, not by this code, so "the row is absent" is a reachable
  // state this function's own contract already promises to handle ("or null
  // if not yet configured"). `.single()` raises PGRST116 on zero rows, which
  // turned the whole page into the generic error state after the 2026-09-08
  // production data reset cleared the row -- the contract was only ever
  // satisfied by the seed happening to be present.
  if (!data) {
    return { data: { instanceId: null, updatedAt: null }, error: null };
  }

  return {
    data: { instanceId: data.instance_id, updatedAt: data.updated_at },
    error: null,
  };
}

/** Thin RPC wrapper over update_messaging_instance() -- the only sanctioned
 * write path into messaging_provider_config (AC #2's atomicity/audit
 * guarantee lives in the RPC itself, not here). */
export async function updateMessagingInstance(
  instanceId: string,
): Promise<{ error: AppError | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_messaging_instance", {
    p_instance_id: instanceId,
  });

  if (error) {
    return { error: await mapAndLog(error) };
  }
  return { error: null };
}
