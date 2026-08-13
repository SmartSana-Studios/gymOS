/**
 * Story 2.10: sends the automated member-invite message over WhatsApp via
 * the same self-hosted Evolution API gateway Story 2.9's `EvolutionApiProvider.ts`
 * (Deno, `send-sms-hook`) already validated live.
 *
 * Node port of that file's REST contract (`POST {baseUrl}/message/sendText/{instance}`,
 * `apikey` header, `{ number, text }` body, per-request `instance_id` read via a
 * service-role client, never-throw discipline) combined with
 * `apps/super-admin/lib/messaging/sendTempPasswordMessage.ts`'s Node-runtime shape
 * (`process.env`, inline `AbortController`-bounded `fetch`, no Deno-only imports --
 * `httpHelpers.ts` is a Deno Edge Function module and cannot be imported here).
 *
 * A plain async function, not a class: this app has no `OtpDeliveryProvider`-style
 * chain/registry (unlike `send-sms-hook`'s `PROVIDER_CHAIN`) -- there is exactly one
 * caller (`sendMemberInvite`) and no polymorphism need.
 */

import { createAdminClient } from "@/lib/supabase/admin";

export type EvolutionApiMessageResult =
  | { success: true; channel: "whatsapp" }
  | { success: false; error: string };

const FETCH_TIMEOUT_MS = 10_000;

export async function sendEvolutionApiMessage(
  phone: string,
  message: string,
): Promise<EvolutionApiMessageResult> {
  const baseUrl = process.env.EVOLUTION_API_BASE_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;
  if (!baseUrl || !apiKey) {
    return { success: false, error: "Evolution API credentials are not configured" };
  }

  // instance_id is a runtime DB value (Story 1.13's /messaging Super Admin page), not a
  // deploy-time secret -- read per-request (no module-scope caching), so a Super Admin
  // repointing it takes effect on the very next send. The table's only RLS policy
  // (super_admin_read_messaging_config) grants SELECT to is_super_admin() only, so a
  // Manager/Owner dashboard session has zero read access -- this requires the
  // service-role client (mirrors services/members.ts's findOrCreateUserByPhone usage).
  const admin = createAdminClient();
  const { data, error } = await admin.from("messaging_provider_config").select("instance_id").single();
  if (error || !data?.instance_id) {
    return { success: false, error: "Evolution API instance is not configured" };
  }
  const instance = data.instance_id;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/message/sendText/${instance}`, {
      method: "POST",
      headers: {
        apikey: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        number: phone.replace(/^\+/, ""),
        text: message,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { success: false, error: `Evolution API request timed out after ${FETCH_TIMEOUT_MS}ms` };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "Evolution API request failed",
    };
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // response.text() can itself throw (e.g. connection reset mid-body-read) -- guarded
    // separately from the fetch() try/catch above so that failure can't escape this
    // function unguarded (matches sendTempPasswordMessage.ts's identical precedent).
    let text: string;
    try {
      text = await response.text();
    } catch {
      text = "(failed to read response body)";
    }
    return { success: false, error: `Evolution API ${response.status}: ${text}` };
  }

  return { success: true, channel: "whatsapp" };
}
