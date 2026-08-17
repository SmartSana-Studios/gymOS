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
// first OtpDeliveryProvider with a live database dependency. Unlike gym-qr-display/payment-webhook
// (each its own whole Edge Function, where a missing client is fatal to the only thing that
// function does), this provider is one of four in send-sms-hook's PROVIDER_CHAIN, imported
// statically at module scope alongside the others — throwing here would crash isolate boot for
// the entire hook (Twilio/sent.dm included), not just disable Evolution API, defeating AD-11's
// whole fallback-resilience point. Never throw; degrade to a per-request clean failure instead,
// same "always return a DeliveryResult" contract every provider in this directory follows.
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = supabaseUrl && serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey) : null;

export class EvolutionApiProvider implements OtpDeliveryProvider {
  async send(phone: string, code: string, locale: "en" | "fr"): Promise<DeliveryResult> {
    if (!supabase) {
      return { success: false, error: "Evolution API: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" };
    }

    const baseUrl = Deno.env.get("EVOLUTION_API_BASE_URL");
    const apiKey = Deno.env.get("EVOLUTION_API_KEY");
    if (!baseUrl || !apiKey) {
      return { success: false, error: "Evolution API credentials are not configured" };
    }

    // instance_id is a runtime DB value (Story 1.13's /messaging Super Admin page), not a
    // deploy-time secret — read per-request, not hoisted, so a Super Admin repointing it takes
    // effect on the very next send instead of after an isolate recycle. A null/missing value (the
    // table's documented "not yet configured" state) is a clean failure result, not a thrown
    // exception — this is what lets AC #3's fall-through actually work. Bounded with an abort
    // signal (code review fix) — unlike every HTTP fetch in this chain, this query previously had
    // no timeout, so a hung PostgREST/Postgres response would have blocked send() indefinitely.
    const { data, error } = await supabase
      .from("messaging_provider_config")
      .select("instance_id")
      .abortSignal(AbortSignal.timeout(3_000))
      .single();
    if (error || !data?.instance_id) {
      // A genuine DB error (RLS misconfiguration, transient outage, abort-timeout) is logged with
      // its own message (code review fix) rather than collapsed into the same "not configured"
      // text as the routine empty-table case — the two are indistinguishable outcomes for the
      // caller (both fall through to the next provider) but must stay distinguishable in logs.
      const detail = error ? `: ${error.message}` : "";
      return { success: false, error: `Evolution API instance is not configured${detail}` };
    }
    const instance = data.instance_id;

    const result = await postJsonWithTimeout("Evolution API", `${baseUrl.replace(/\/+$/, "")}/message/sendText/${encodeURIComponent(instance)}`, {
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
