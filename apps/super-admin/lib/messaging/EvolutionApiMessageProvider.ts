/**
 * Story 11.5: sends the Billing view's "Trigger retry" row action's payment-
 * due notice over WhatsApp. Node port of `apps/dashboard/lib/messaging/
 * EvolutionApiMessageProvider.ts` (Story 2.10/11.3) -- same REST contract
 * (`POST {baseUrl}/message/sendText/{instance}`, `apikey` header,
 * `{ number, text }` body, per-request `instance_id` read via a service-role
 * client, never-throw discipline, the same WhatsApp-number-existence
 * pre-check with a national-number-length variant retry).
 *
 * Duplicated into `apps/super-admin` rather than shared, per this codebase's
 * own established precedent of per-app messaging duplication (AD-7) --
 * `sendTempPasswordMessage.ts` already lives independently in both apps'
 * `lib/messaging/`. This story's Dev Notes raised the alternative (a new
 * authenticated cross-app HTTP endpoint calling into `apps/dashboard`) and
 * the user chose duplication, on the strength of that same precedent and to
 * avoid a new authenticated network boundary for one row-action button.
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
    const variantMatch = results.find((r) => r.exists && candidates.has(r.number));
    return variantMatch?.number ?? bareDigitPhone;
  } catch {
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

  const admin = createAdminClient();
  const { data, error } = await admin.from("messaging_provider_config").select("instance_id").single();
  if (error) {
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
