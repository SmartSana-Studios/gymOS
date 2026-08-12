import { createClient } from "@supabase/supabase-js";

import type { DeliveryResult, OtpDeliveryProvider } from "./OtpDeliveryProvider.ts";
import { errorResult, postJsonWithTimeout } from "./httpHelpers.ts";

// Not an official WhatsApp Business Platform provider (unlike sent.dm/Twilio WhatsApp), so there's
// no template-approval constraint to work around — plain inline text, same pattern as
// TwilioSmsProvider's MESSAGES map. WhatsApp renders single-asterisk-wrapped text as bold in plain
// messages (confirmed live during the Story 2.9 spike) -- used here to make the code stand out.
// There is no native "Copy Code" button available on this path: that's a WhatsApp Business Platform
// feature tied to a Meta-approved Authentication template (see TwilioWhatsAppProvider/SentDmProvider),
// and Evolution API's whole appeal here is sending plain text with no template-approval step -- the
// two are mutually exclusive, not an oversight.
const MESSAGES: Record<"en" | "fr", string> = {
  en: "Your GymOS code is: *{code}*",
  fr: "Votre code GymOS est : *{code}*",
};

// Hoisted to module scope: same warm-isolate rationale as gym-qr-display/index.ts and
// payment-webhook/index.ts — created once per isolate boot, not once per OTP send. This is the
// first OtpDeliveryProvider with a live database dependency; SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY
// are Supabase-CLI-injected defaults for every Edge Function, so a missing value here means a
// genuinely broken deployment, worth a hard isolate-boot failure with a clear message rather than
// a client silently pointed nowhere.
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("EvolutionApiProvider: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}
const supabase = createClient(supabaseUrl, serviceRoleKey);

export class EvolutionApiProvider implements OtpDeliveryProvider {
  async send(phone: string, code: string, locale: "en" | "fr"): Promise<DeliveryResult> {
    const baseUrl = Deno.env.get("EVOLUTION_API_BASE_URL");
    const apiKey = Deno.env.get("EVOLUTION_API_KEY");
    if (!baseUrl || !apiKey) {
      return { success: false, error: "Evolution API credentials are not configured" };
    }

    // instance_id is a runtime DB value (Story 1.13's /messaging Super Admin page), not a
    // deploy-time secret — read per-request, not hoisted, so a Super Admin repointing it takes
    // effect on the very next send instead of after an isolate recycle. A null/missing value (the
    // table's documented "not yet configured" state) is a clean failure result, not a thrown
    // exception — this is what lets AC #3's fall-through actually work.
    const { data, error } = await supabase.from("messaging_provider_config").select("instance_id").single();
    if (error || !data?.instance_id) {
      return { success: false, error: "Evolution API instance is not configured" };
    }
    const instance = data.instance_id;

    const result = await postJsonWithTimeout("Evolution API", `${baseUrl}/message/sendText/${instance}`, {
      method: "POST",
      headers: {
        apikey: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        number: phone.replace(/^\+/, ""),
        text: MESSAGES[locale].replace("{code}", code),
      }),
    });

    if (!(result instanceof Response)) {
      return result;
    }

    if (!result.ok) {
      return errorResult("Evolution API", result);
    }

    // A 2xx with a key/message object shape means the gateway accepted the send — not delivery
    // confirmation (WhatsApp's own async read/delivery receipts are out of scope), matching how
    // every other OtpDeliveryProvider here treats a synchronous accept-response as success.
    return { success: true, channel: "whatsapp" };
  }
}
