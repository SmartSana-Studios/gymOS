import "@supabase/functions-js/edge-runtime.d.ts";
import { Webhook } from "standardwebhooks";

import type { OtpDeliveryProvider } from "./_shared/otp-providers/OtpDeliveryProvider.ts";
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

function getProvider(): OtpDeliveryProvider | undefined {
  switch (Deno.env.get("OTP_PROVIDER")) {
    case "twilio":
      return new TwilioSmsProvider();
    case "twilio_whatsapp":
      return new TwilioWhatsAppProvider();
    case "sentdm":
      return new SentDmProvider();
    default:
      return undefined;
  }
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

const provider = getProvider();

export default {
  fetch: async (req: Request): Promise<Response> => {
    if (!wh) {
      console.error(`send-sms-hook: webhook verifier failed to initialize — ${webhookInitError}`);
      return jsonResponse(500);
    }

    if (!provider) {
      console.error("send-sms-hook: no valid OTP_PROVIDER configured");
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

    let result;
    try {
      result = await provider.send(phone, payload.sms.otp, "en");
    } catch (err) {
      // Defense in depth: providers are contracted to always return a DeliveryResult, never throw,
      // but a future provider (or an unexpected runtime error) breaking that contract shouldn't crash
      // the whole hook — same posture as the try/catch around signature verification above.
      console.error(`send-sms-hook: provider threw unexpectedly — ${err instanceof Error ? err.message : String(err)}`);
      return jsonResponse(500);
    }

    if (!result.success) {
      console.error(`send-sms-hook: delivery failed — ${redactPhone(result.error, phone)}`);
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
