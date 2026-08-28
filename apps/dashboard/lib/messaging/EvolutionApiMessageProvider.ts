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
 *
 * Story 11.3: live-evidence testing surfaced a real, recurring class of
 * false negative -- a genuinely WhatsApp-active number can still fail
 * Evolution API's own JID-existence check when the caller's own numbering
 * plan has changed its national significant number's length (confirmed
 * live: a Cameroon number dialable as 237695233625 was still indexed by
 * WhatsApp's own backend under its pre-2022-migration 8-digit form,
 * 23795233625 -- WhatsApp's own contact index lagging the numbering-plan
 * change, not an Evolution API or GymOS defect). `resolveWhatsappNumber()`
 * below checks the number's existence before sending and, if the primary
 * form isn't found, tries a national-number-length variant (one digit
 * shorter, right after the country calling code) -- general to any
 * country's own historical "added one leading digit" numbering-plan change
 * (Cameroon's is the one this story observed directly, but the pattern
 * itself isn't Cameroon-specific), using `libphonenumber-js` to correctly
 * split calling-code from national-number for whichever country the
 * caller's number belongs to, rather than a hardcoded per-country digit
 * rule. The check is fail-open: if it errors, times out, or finds neither
 * form, the send still proceeds with the original number exactly as before
 * -- this is a best-effort improvement, never a new way for a send to be
 * silently skipped.
 */

import { parsePhoneNumberFromString } from "libphonenumber-js";
import { createAdminClient } from "@/lib/supabase/admin";

export type EvolutionApiMessageResult =
  | { success: true; channel: "whatsapp" }
  | { success: false; error: string };

const FETCH_TIMEOUT_MS = 10_000;
const NUMBER_CHECK_TIMEOUT_MS = 5_000;

interface WhatsappNumberCheckResult {
  jid: string;
  exists: boolean;
  number: string;
}

/**
 * Queries Evolution API's own `/chat/whatsappNumbers/{instance}` endpoint
 * with the primary bare-digit number and, when a national-number-length
 * variant is computable and distinct, that variant too -- returns whichever
 * one Evolution API confirms `exists: true` for (primary preferred), or the
 * original `bareDigitPhone` unchanged if the check can't confirm either
 * (endpoint error/timeout, or genuinely neither form exists -- the real
 * send attempt is still the final authority, this is only a best-effort
 * pre-check).
 */
async function resolveWhatsappNumber(
  baseUrl: string,
  apiKey: string,
  instance: string,
  bareDigitPhone: string,
): Promise<string> {
  const candidates = new Set<string>([bareDigitPhone]);

  const parsed = parsePhoneNumberFromString(`+${bareDigitPhone}`);
  if (parsed?.countryCallingCode && parsed.nationalNumber.length > 1) {
    candidates.add(`${parsed.countryCallingCode}${parsed.nationalNumber.slice(1)}`);
  }

  if (candidates.size < 2) {
    // No distinct variant to check against -- skip the extra round trip
    // entirely, matching this function's own fail-open discipline.
    return bareDigitPhone;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NUMBER_CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/chat/whatsappNumbers/${encodeURIComponent(instance)}`, {
      method: "POST",
      headers: {
        apikey: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ numbers: Array.from(candidates) }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return bareDigitPhone;
    }

    const results = (await response.json()) as WhatsappNumberCheckResult[];
    const primaryMatch = results.find((r) => r.number === bareDigitPhone && r.exists);
    if (primaryMatch) {
      return bareDigitPhone;
    }
    // Only trust a variant this call actually submitted -- review finding:
    // `results.find((r) => r.exists)` alone would adopt any exists:true
    // entry in the response with no check it's one of our own candidates.
    const variantMatch = results.find((r) => r.exists && candidates.has(r.number));
    return variantMatch?.number ?? bareDigitPhone;
  } catch {
    // Network error, timeout, or unparseable response -- fail open, the
    // real send attempt below is still the final authority.
    return bareDigitPhone;
  } finally {
    clearTimeout(timer);
  }
}

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

  const bareDigitPhone = phone.replace(/^\+/, "");
  const resolvedNumber = await resolveWhatsappNumber(baseUrl, apiKey, instance, bareDigitPhone);

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
          number: resolvedNumber,
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
