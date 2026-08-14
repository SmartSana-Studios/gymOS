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
  if (error) {
    // Distinct from the "not configured" case below -- a real query failure (DB outage, RLS
    // misconfig) would otherwise return the identical message and mislead an operator into
    // checking the Super Admin messaging config page instead of DB health (Review finding).
    console.error("[EvolutionApiMessageProvider] messaging_provider_config query failed", error);
    return { success: false, error: "Evolution API instance is not configured" };
  }
  if (!data?.instance_id) {
    return { success: false, error: "Evolution API instance is not configured" };
  }
  const instance = data.instance_id;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  // `timer` is only cleared in the `finally` below, once this function is fully done -- not
  // right after `fetch()` resolves -- so the same FETCH_TIMEOUT_MS bound also covers the
  // `response.text()` read further down, not just the initial request (Review finding: a
  // response whose headers arrive quickly but whose body then stalls was previously
  // unbounded, since the abort timer had already been cleared by the time text() ran).
  try {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/message/sendText/${encodeURIComponent(instance)}`, {
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
    }

    if (!response.ok) {
      // response.text() can itself throw or hang (e.g. connection reset or a stalled body
      // mid-read) -- guarded separately from the fetch() try/catch above so that failure
      // can't escape this function unguarded (matches sendTempPasswordMessage.ts's identical
      // precedent), and still bounded by the same controller/timer as the initial fetch.
      let text: string;
      try {
        text = await response.text();
      } catch {
        text = "(failed to read response body)";
      }
      return { success: false, error: `Evolution API ${response.status}: ${text}` };
    }

    return { success: true, channel: "whatsapp" };
  } finally {
    clearTimeout(timer);
  }
}
