/**
 * Story 11.3: sends the SaaS billing-due reminder over plain SMS (the
 * project's first Twilio *SMS* send -- every prior Twilio integration,
 * `apps/super-admin/lib/messaging/sendTempPasswordMessage.ts`, is WhatsApp
 * via Twilio's Content API).
 *
 * Twilio's plain SMS endpoint (`POST /2010-04-01/Accounts/{Sid}/Messages.json`,
 * Basic-auth, form-encoded `To`/`From`/`Body`) does not require a
 * pre-approved Content Template the way the WhatsApp Business API does --
 * confirmed against Twilio's current docs at implementation time (2026-08-27),
 * not assumed from training data, per this story's own explicit instruction.
 * `sendTempPasswordMessage.ts`'s Content-API constraint is WhatsApp-specific
 * and does not apply here.
 *
 * Node-runtime shape mirrors `EvolutionApiMessageProvider.ts`/
 * `sendTempPasswordMessage.ts` exactly: `process.env`, inline
 * `AbortController`-bounded `fetch`, never-throw `{success, error?}` result.
 * No fallback chain -- AD-11 doesn't apply here; FR-135 calls for SMS and
 * WhatsApp to both fire unconditionally (Task 4), never one substituting
 * for the other.
 *
 * `TWILIO_SMS_FROM_NUMBER` is a new, separate env var from
 * `TWILIO_WHATSAPP_FROM_NUMBER` -- a number approved/configured for
 * Twilio's WhatsApp Business API is not necessarily SMS-capable, so this
 * story does not assume the two can share one number. Confirm with
 * whoever manages the Twilio account whether an existing SMS-capable
 * number can be reused or a new one needs provisioning (flagged in this
 * story's Task 7 live-evidence step, not silently assumed here).
 */

export type TwilioSmsResult = { success: true } | { success: false; error: string; status?: number };

const FETCH_TIMEOUT_MS = 10_000;

export async function sendTwilioSms(phone: string, message: string): Promise<TwilioSmsResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_SMS_FROM_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    return { success: false, error: "Twilio SMS credentials are not configured" };
  }

  const body = new URLSearchParams({
    To: phone,
    From: fromNumber,
    Body: message,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { success: false, error: `Twilio SMS request timed out after ${FETCH_TIMEOUT_MS}ms`, status: 503 };
    }
    return { success: false, error: err instanceof Error ? err.message : "Twilio SMS request failed" };
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // response.text() can itself throw (e.g. connection reset mid-body-read)
    // -- guarded separately from the fetch() try/catch above, same
    // precedent as EvolutionApiMessageProvider.ts/sendTempPasswordMessage.ts.
    let text: string;
    try {
      text = await response.text();
    } catch {
      text = "(failed to read response body)";
    }
    return { success: false, error: `Twilio SMS ${response.status}: ${text}`, status: response.status };
  }

  return { success: true };
}
