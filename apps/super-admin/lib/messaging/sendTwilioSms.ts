/**
 * Story 11.5: the SMS half of the "Trigger retry" row action's payment-due
 * notice. Node port of `apps/dashboard/lib/messaging/sendTwilioSms.ts`
 * (Story 11.3) -- same Twilio plain-SMS REST contract, no Content Template
 * required. Duplicated into `apps/super-admin` for the same AD-7 reasoning
 * as `EvolutionApiMessageProvider.ts` above it, not shared.
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
