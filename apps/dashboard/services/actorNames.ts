import type { createClient } from "@/lib/supabase/server";
import type { AppError } from "@gymos/types";
import { mapAndLog } from "@/services/session";

/**
 * Story 23.8 (FR-187): one place that turns the `actor_id` columns a gym screen holds (payments, refunds, audit rows, guest-session
 * payments) into the name shown as "recorded by".
 *
 * A staff actor resolves through the gym's own `members` rows, as before. The per-gym support proxy has NO `members` row, so it
 * resolves through `get_gym_support_proxy_id()` and is labelled SUPPORT_ACTOR_LABEL. The real support person is never read here: the
 * proxy id is the only id a gym ever holds, and `support_action_identity` is Super Admin read only.
 */
export const SUPPORT_ACTOR_LABEL = "GymOS Support";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export async function resolveActorNames(
  supabase: Supabase,
  gymId: string,
  actorUserIds: string[],
): Promise<{ data: Map<string, string>; error: null } | { data: null; error: AppError }> {
  const names = new Map<string, string>();
  if (actorUserIds.length === 0) {
    return { data: names, error: null };
  }

  const { data: actorRows, error: actorError } = await supabase
    .from("members")
    .select("user_id, name")
    .eq("gym_id", gymId)
    .in("user_id", actorUserIds);
  if (actorError) {
    return { data: null, error: await mapAndLog(actorError) };
  }
  for (const row of actorRows ?? []) {
    if (row.user_id) names.set(row.user_id, row.name);
  }

  // Only an id no membership explains can be the proxy; skip the call otherwise.
  if (actorUserIds.some((id) => !names.has(id))) {
    const { data: proxyId, error: proxyError } = await supabase.rpc("get_gym_support_proxy_id");
    // Only the recorded-by label depends on this call: a failure leaves the proxy unnamed, it never blocks the list.
    if (!proxyError && typeof proxyId === "string" && actorUserIds.includes(proxyId) && !names.has(proxyId)) {
      names.set(proxyId, SUPPORT_ACTOR_LABEL);
    }
  }
  return { data: names, error: null };
}
