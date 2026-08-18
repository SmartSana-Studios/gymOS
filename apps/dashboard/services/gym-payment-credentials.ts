import { createClient } from "@/lib/supabase/server";
import { type AppError, type ConnectGymPaymentCredentialsInput } from "@gymos/types";
import { mapAndLog } from "@/services/session";

export interface GymPaymentConnectionStatus {
  businessIdMasked: string;
  connectedAt: string;
  /** Story 4.14/AC #3: a prior connection that is now failing (initiation
   * hit a "credentials not usable" outcome) -- distinct from Story 4.13's
   * "not connected" case, which has no row at all and needs no banner. */
  needsAttention: boolean;
}

/** Mirrors `connect_gym_payment_credentials()`'s own masking rule
 * (`0052_gym_payment_credentials.sql`) -- kept in sync so the client-side
 * fallback in `connectPaymentProvider` (used only if the post-connect
 * status re-fetch itself fails) displays the same shape the DB would have
 * returned. Business IDs of 4 characters or fewer are never partially
 * revealed (matches the DB-side guard against NFR-017 "never returned to
 * any client" being defeated by a too-short value). */
export function maskBusinessId(businessId: string): string {
  const trimmed = businessId.trim();
  return trimmed.length > 4 ? `•••• ${trimmed.slice(-4)}` : "••••";
}

/** Thin wrapper over get_gym_payment_connection_status() -- the one narrow
 * read every gym-scoped session needs to decide whether to show the
 * mobile_money option (Story 4.13, AC #3). Not owner-gated at the RPC
 * level, so any authenticated gym-scoped session can call this. `data: null`
 * means "not connected", distinct from `error` (a real failure). */
export async function getGymPaymentConnectionStatus(
  providerKey: string,
): Promise<{ data: GymPaymentConnectionStatus | null; error: AppError | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_gym_payment_connection_status", {
    p_provider_key: providerKey,
  });

  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }

  const row = data?.[0];
  if (!row) {
    return { data: null, error: null };
  }

  return {
    data: {
      businessIdMasked: row.business_id_masked,
      connectedAt: row.connected_at,
      needsAttention: row.needs_attention,
    },
    error: null,
  };
}

/** Thin wrapper over connect_gym_payment_credentials() -- the only
 * sanctioned write path (Owner-only, enforced in the RPC itself via
 * `app_role = 'owner'` + `private.gym_id()`, never a client-supplied gym
 * id). Upserts: a reconnect replaces the previously stored credentials. */
export async function connectGymPaymentCredentials(
  providerKey: string,
  input: ConnectGymPaymentCredentialsInput,
): Promise<{ error: AppError | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("connect_gym_payment_credentials", {
    p_provider_key: providerKey,
    p_api_key: input.apiKey,
    p_business_id: input.businessId,
    p_webhook_secret: input.webhookSecret,
  });

  if (error) {
    return { error: await mapAndLog(error) };
  }
  return { error: null };
}

/** Thin wrapper over disconnect_gym_payment_credentials() -- Owner-only,
 * idempotent no-op if no connection exists for this gym/provider. */
export async function disconnectGymPaymentCredentials(
  providerKey: string,
): Promise<{ error: AppError | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("disconnect_gym_payment_credentials", {
    p_provider_key: providerKey,
  });

  if (error) {
    return { error: await mapAndLog(error) };
  }
  return { error: null };
}
