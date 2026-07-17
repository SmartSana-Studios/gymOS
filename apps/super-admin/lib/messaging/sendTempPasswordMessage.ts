/**
 * Story 1.11: sends the new gym owner's temp password over WhatsApp.
 *
 * Ports the *pattern* of `supabase/functions/send-sms-hook/_shared/otp-providers/
 * {TwilioWhatsAppProvider,httpHelpers}.ts` (Twilio's Content API, `whatsapp:`
 * To/From prefixes, Basic-auth `btoa`, `AbortController`-bounded fetch) to a
 * Node/Next.js Server Action -- those files are Deno Edge Function modules
 * (`Deno.env.get`, `@supabase/functions-js/edge-runtime.d.ts`) and cannot be
 * imported directly into this app's runtime. `fetch`/`btoa`/`AbortController`
 * are Node 18+/24 globals, so no new HTTP client dependency is needed.
 *
 * Reuses Story 2.1's already-approved `verifications_2fa_template` (Content
 * API, single `{{1}}` body variable) rather than a new template -- ships
 * immediately, zero new Meta approval (Open Question 1, resolved 2026-07-15).
 * **Accepted, documented wording mismatch**: the template's fixed body reads
 * "{{1}} is your verification code. For your security, do not share this
 * code." -- written for an OTP code, not a temp password. Accepted as-is; see
 * docs/decisions.md's 2026-07-15 Story 1.11 entry.
 *
 * These are separate credentials/config from the Send SMS Hook's own Supabase
 * Edge Function secrets (not accessible to a Next.js server process) -- the
 * same Twilio account/number's values are copied into this app's own env.
 *
 * No SMS path or fallback chain is built here -- WhatsApp-via-existing-
 * template is the sole channel for this message (deferred-work.md).
 */

export type TempPasswordMessageResult =
  | { success: true; channel?: string }
  | { success: false; error: string; status?: number };

const FETCH_TIMEOUT_MS = 10_000;

export async function sendTempPasswordMessage(
  phone: string,
  tempPassword: string,
): Promise<TempPasswordMessageResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const whatsappFrom = process.env.TWILIO_WHATSAPP_FROM_NUMBER;
  const contentSid = process.env.TWILIO_WHATSAPP_CONTENT_SID;

  if (!accountSid || !authToken || !whatsappFrom || !contentSid) {
    return { success: false, error: "Twilio WhatsApp credentials are not configured" };
  }

  // Guard against a misconfigured TWILIO_WHATSAPP_FROM_NUMBER that already
  // carries the prefix -- an unconditional prepend would silently double it.
  const To = phone.startsWith("whatsapp:") ? phone : `whatsapp:${phone}`;
  const From = whatsappFrom.startsWith("whatsapp:") ? whatsappFrom : `whatsapp:${whatsappFrom}`;
  const body = new URLSearchParams({
    To,
    From,
    ContentSid: contentSid,
    ContentVariables: JSON.stringify({ "1": tempPassword }),
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
        signal: controller.signal,
      },
    );
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return {
        success: false,
        error: `Twilio WhatsApp request timed out after ${FETCH_TIMEOUT_MS}ms`,
        status: 503,
      };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "Twilio WhatsApp request failed",
    };
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // response.text() can itself throw (e.g. connection reset mid-body-read)
    // -- guarded separately from the fetch() try/catch above so that failure
    // can't escape this function unguarded (code review finding).
    let text: string;
    try {
      text = await response.text();
    } catch {
      text = "(failed to read response body)";
    }
    return { success: false, error: `Twilio WhatsApp ${response.status}: ${text}`, status: response.status };
  }

  return { success: true, channel: "whatsapp" };
}
