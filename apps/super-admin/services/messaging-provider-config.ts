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
    .single();

  if (error) {
    return { data: null, error: await mapAndLog(error) };
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
