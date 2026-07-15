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

function jsonResponse(status: number, body: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
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
    typeof v?.user?.phone === "string" &&
    typeof v?.sms?.otp === "string"
  );
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

    const payloadText = await req.text();
    const headers = Object.fromEntries(req.headers);

    let verified: unknown;
    try {
      verified = wh.verify(payloadText, headers);
    } catch {
      return jsonResponse(400);
    }

    if (!isValidPayload(verified)) {
      console.error("send-sms-hook: verified payload has unexpected shape");
      return jsonResponse(400);
    }
    const payload = verified;

    // Confirmed via a real Story 2.1 spike send: GoTrue's Send SMS Hook payload delivers user.phone
    // WITHOUT the leading "+" (its internal storage convention) — some provider paths (Twilio's direct
    // From-number send) reject a non-"+"-prefixed E.164 number outright (error 21211), even though
    // other paths (Twilio Messaging Service, sent.dm) silently tolerated it. Normalize here once,
    // at the boundary (see OtpDeliveryProvider.send's own documented contract), rather than relying
    // on each provider/path's own leniency.
    const phone = payload.user.phone.startsWith("+") ? payload.user.phone : `+${payload.user.phone}`;

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
      console.error(`send-sms-hook: delivery failed — ${result.error}`);
      return jsonResponse(500);
    }

    return jsonResponse(200);
  },
};
