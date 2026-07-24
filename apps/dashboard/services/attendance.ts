import { createClient } from "@/lib/supabase/server";
import { type AppError } from "@gymos/types";
import { mapAndLog } from "@/services/session";

/** Story 3.5: Check-Out -- Manual & Auto-Timeout. Calls the staff-driven
 * `check_out_member()` SECURITY DEFINER RPC (0024_check_out_manual_auto_timeout.sql),
 * which self-enforces the owner/manager/receptionist role check and the
 * gym-scoped lookup internally. No `actions.ts`/UI caller yet -- Story 3.6's
 * dashboard "Check Out" button is the first consumer, matching
 * `subscriptions.ts`'s own "backend-only story still ships the service-layer
 * function" precedent. `memberId` needs no Zod schema here (unlike
 * `renewSubscription`'s `reason` field) -- it is a bare UUID passed straight
 * to the RPC, which does its own gym-scoped lookup. */
export async function checkOutMember(memberId: string): Promise<{ error: AppError | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("check_out_member", { p_member_id: memberId });
  if (error) {
    return { error: await mapAndLog(error) };
  }
  return { error: null };
}
