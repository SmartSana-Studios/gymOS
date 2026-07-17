import type { DeliveryResult } from "./OtpDeliveryProvider.ts";

// Shared by all OtpDeliveryProvider implementations (and the natural home for the same shape
// once notch-pay-webhook's PaymentProvider implementations exist, per architecture.md's "same
// design pattern" note) — every provider's non-2xx response collapses to this one shape.
export async function errorResult(providerName: string, response: Response): Promise<DeliveryResult> {
  const body = await response.text();
  return {
    success: false,
    error: `${providerName} ${response.status}: ${body}`,
    status: response.status,
    retryAfter: response.headers.get("retry-after") ?? undefined,
  };
}

const FETCH_TIMEOUT_MS = 10_000;

function timeoutResult(providerName: string): DeliveryResult {
  return {
    success: false,
    error: `${providerName} request timed out after ${FETCH_TIMEOUT_MS}ms`,
    status: 503,
    retryAfter: "5",
  };
}

// A hung Twilio/sent.dm response would otherwise block the whole hook indefinitely instead of
// failing fast — bounds every provider fetch to the same timeout and converts an abort into a
// retryable DeliveryResult rather than letting it surface as an uncaught rejection.
async function fetchWithTimeout(providerName: string, url: string, init: RequestInit): Promise<Response | DeliveryResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return timeoutResult(providerName);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function sendTwilioMessage(
  accountSid: string,
  authToken: string,
  body: URLSearchParams,
  providerName: string = "Twilio",
): Promise<DeliveryResult> {
  const result = await fetchWithTimeout(
    providerName,
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

  if (!(result instanceof Response)) {
    return result;
  }

  if (!result.ok) {
    return errorResult(providerName, result);
  }

  return { success: true };
}

export async function postJsonWithTimeout(
  providerName: string,
  url: string,
  init: RequestInit,
): Promise<Response | DeliveryResult> {
  return fetchWithTimeout(providerName, url, init);
}
