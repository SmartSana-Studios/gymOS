import type { DeliveryResult } from "./OtpDeliveryProvider.ts";

// Shared by all OtpDeliveryProvider implementations (and the natural home for the same shape
// once notch-pay-webhook's PaymentProvider implementations exist, per architecture.md's "same
// design pattern" note) — every provider's non-2xx response collapses to this one shape.
export async function errorResult(providerName: string, response: Response): Promise<DeliveryResult> {
  const body = await response.text();
  return { success: false, error: `${providerName} ${response.status}: ${body}` };
}

export async function sendTwilioMessage(
  accountSid: string,
  authToken: string,
  body: URLSearchParams,
  providerName: string = "Twilio",
): Promise<DeliveryResult> {
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    },
  );

  if (!response.ok) {
    return errorResult(providerName, response);
  }

  return { success: true };
}
