import "@supabase/functions-js/edge-runtime.d.ts";
import { Webhook } from "standardwebhooks";

import type { DeliveryResult, OtpDeliveryProvider } from "./_shared/otp-providers/OtpDeliveryProvider.ts";
import { EvolutionApiProvider } from "./_shared/otp-providers/EvolutionApiProvider.ts";
import { TwilioSmsProvider } from "./_shared/otp-providers/TwilioSmsProvider.ts";
import { TwilioWhatsAppProvider } from "./_shared/otp-providers/TwilioWhatsAppProvider.ts";
import { SentDmProvider } from "./_shared/otp-providers/SentDmProvider.ts";

interface SendSmsHookPayload {
  user: { id: string; phone: string; [key: string]: unknown };
  sms: { otp: string };
}

function jsonResponse(
  status: number,
  body: Record<string, unknown> = {},
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

function isValidPayload(value: unknown): value is SendSmsHookPayload {
  const v = value as Partial<SendSmsHookPayload> | null | undefined;
  return (
    typeof v?.user?.phone === "string" && v.user.phone.length > 0 &&
    typeof v?.sms?.otp === "string" && v.sms.otp.length > 0
  );
}

// Confirmed via a real Story 2.1 spike send: GoTrue's Send SMS Hook payload delivers user.phone
// WITHOUT the leading "+" (its internal storage convention) — some provider paths (Twilio's direct
// From-number send) reject a non-"+"-prefixed E.164 number outright (error 21211), even though
// other paths (Twilio Messaging Service, sent.dm) silently tolerated it. Normalize AND validate
// here once, at the boundary (see OtpDeliveryProvider.send's own documented contract), rather than
// relying on each provider/path's own leniency or forwarding an unvalidated string.
// Bounds must match packages/types/src/schemas/{member,csvImport}.ts's e164Phone
// (/^\+[1-9]\d{7,14}$/, 8-15 total digits) -- this was previously one digit
// looser (7-15) than every app-layer schema, a latent inconsistency at the
// Edge Function boundary (code review finding).
const E164_DIGITS = /^[1-9]\d{7,14}$/;
function normalizePhone(rawPhone: string): string | null {
  const digits = rawPhone.startsWith("+") ? rawPhone.slice(1) : rawPhone;
  return E164_DIGITS.test(digits) ? `+${digits}` : null;
}

// Provider error bodies (Twilio/sent.dm) frequently echo the destination number back in plain
// text (e.g. Twilio's "Invalid 'To' Phone Number: +237..."). Redact both the normalized and raw
// forms before this ever reaches console.error, so phone numbers don't sit unredacted in logs.
function redactPhone(text: string, phone: string): string {
  const digitsOnly = phone.replace(/^\+/, "");
  return text.split(phone).join("[REDACTED]").split(digitsOnly).join("[REDACTED]");
}

// Hoisted to module scope: Supabase's Edge Runtime reuses warm isolates across requests, so this
// setup work (HMAC-key parsing, provider selection) runs once per isolate boot, not once per OTP
// request on this latency-sensitive path. The Webhook constructor throws synchronously on an empty
// secret (e.g. SEND_SMS_HOOK_SECRET unset in a misconfigured deployment) — caught here so a bad
// secret produces a clean per-request 500 instead of crashing isolate initialization for every request.
const rawSecret = Deno.env.get("SEND_SMS_HOOK_SECRET") ?? "";
const secretBase64 = rawSecret.replace(/^v1,whsec_/, "");
let wh: Webhook | null = null;
let webhookInitError: string | null = null;
try {
  wh = new Webhook(secretBase64);
} catch (err) {
  webhookInitError = err instanceof Error ? err.message : String(err);
}

// Ordered fallback chain (AD-11): Evolution API first (lowest friction when its self-hosted
// instance is connected), then Twilio WhatsApp, then Twilio SMS, then sent.dm. Module-scope
// hoisted like `provider` used to be — instantiating these is cheap and stateless, and each
// provider reads its own credentials inside send(), not at construction time.
const PROVIDER_CHAIN: OtpDeliveryProvider[] = [
  new EvolutionApiProvider(),
  new TwilioWhatsAppProvider(),
  new TwilioSmsProvider(),
  new SentDmProvider(),
];

// Tries each provider in order, short-circuiting on the first success. A provider throwing
// unexpectedly (contract violation — every provider is supposed to always return a
// DeliveryResult, never throw) must not abort the whole chain, so each attempt gets its own
// try/catch rather than one try/catch around the loop. Every attempt is logged (provider name +
// outcome only, never the phone number/code) per AD-11's "every attempt is logged" requirement.
// A failed attempt (whether from a thrown error or a `success: false` result) always logs at
// console.error, not console.log (code review fix) -- a per-provider failure previously logged
// at console.log, so a persistently broken PROVIDER_CHAIN[0] that a later provider always
// rescues would never surface to error-level monitoring/alerting until the whole chain failed.
// A thrown error and a `success: false` result now share one log call site below instead of
// each having their own separately-maintained duplicate log line.
async function sendViaChain(phone: string, code: string, locale: "en" | "fr"): Promise<DeliveryResult> {
  let lastResult: DeliveryResult = { success: false, error: "no OTP provider configured" };

  for (const provider of PROVIDER_CHAIN) {
    const providerName = provider.constructor.name;
    try {
      lastResult = await provider.send(phone, code, locale);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lastResult = { success: false, error: message };
    }

    if (lastResult.success) {
      console.log(`send-sms-hook: ${providerName} → success`);
      return lastResult;
    }
    console.error(`send-sms-hook: ${providerName} → failed: ${redactPhone(lastResult.error, phone)}`);
  }

  return lastResult;
}

// Exported for testing only — the Edge Function's own entry point is the default export below;
// Supabase's runtime ignores named exports on a function's index.ts.
export { normalizePhone, PROVIDER_CHAIN, redactPhone, sendViaChain };

export default {
  fetch: async (req: Request): Promise<Response> => {
    if (!wh) {
      console.error(`send-sms-hook: webhook verifier failed to initialize — ${webhookInitError}`);
      return jsonResponse(500);
    }

    // Body read and signature verification share one try/catch: a body-read failure (aborted/
    // truncated request) is just as much a "reject this request" case as a bad signature, and both
    // must produce the JSON error response the Auth Hook contract requires, not an uncaught throw.
    let verified: unknown;
    try {
      const payloadText = await req.text();
      const headers = Object.fromEntries(req.headers);
      verified = wh.verify(payloadText, headers);
    } catch {
      return jsonResponse(400);
    }

    if (!isValidPayload(verified)) {
      console.error("send-sms-hook: verified payload has unexpected shape");
      return jsonResponse(400);
    }
    const payload = verified;

    const phone = normalizePhone(payload.user.phone);
    if (!phone) {
      console.error("send-sms-hook: payload.user.phone is not a valid E.164 number");
      return jsonResponse(400);
    }

    // Play Store review test account: bypass real SMS delivery for this number.
    // Supabase still generates and validates the OTP internally — we just skip
    // the Twilio/sent.dm send. The fixed OTP (123456) must be configured via
    // Supabase Dashboard → Authentication → Phone → Test OTPs. Number lives in
    // REVIEW_TEST_PHONE (Edge Function env config), not hardcoded, so it can be
    // rotated without a redeploy.
    const reviewTestPhone = Deno.env.get("REVIEW_TEST_PHONE");
    if (reviewTestPhone && phone === reviewTestPhone) {
      return jsonResponse(200);
    }

    const result = await sendViaChain(phone, payload.sms.otp, "en");

    if (!result.success) {
      console.error(`send-sms-hook: all providers failed — ${redactPhone(result.error, phone)}`);
      // Per Supabase's HTTP Auth Hook contract: 429/503 are retry-able and need a non-empty
      // Retry-After header; everything else becomes a 500 on Supabase's side regardless of the
      // status we send, so there's no benefit to forwarding other provider status codes as-is.
      if (result.status === 429 || result.status === 503) {
        return jsonResponse(result.status, {}, { "Retry-After": result.retryAfter ?? "60" });
      }
      return jsonResponse(500);
    }

    return jsonResponse(200);
  },
};
