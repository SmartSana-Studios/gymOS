"use server";

import { createAdminClient } from "@/lib/supabase/admin";

/** Story 22.8: cancel a scheduled recovery from the link in the notice email. Public by design: the
 * 256-bit token is the credential (only its hash is stored). Identical answer for unknown/used tokens. */
export async function cancelRecovery(input: { token: string }): Promise<{ ok: boolean }> {
  const token = typeof input?.token === "string" ? input.token : "";
  if (token.length < 32 || token.length > 200) return { ok: false };
  const { data, error } = await createAdminClient().rpc("recovery_cancel", { p_token: token });
  const row = Array.isArray(data) ? data[0] : null;
  return { ok: !error && row?.ok === true };
}
