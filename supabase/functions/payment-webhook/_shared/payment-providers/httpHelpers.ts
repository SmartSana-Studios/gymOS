import type { InitiatePaymentResult } from "./PaymentProvider.ts";

// Mirrors send-sms-hook/_shared/otp-providers/httpHelpers.ts's fetchWithTimeout
// + shared error-result pattern — every provider's non-2xx/timeout response
// collapses to the same InitiatePaymentResult failure shape.

const FETCH_TIMEOUT_MS = 10_000;

export async function errorResult(providerName: string, response: Response): Promise<InitiatePaymentResult> {
  const body = await response.text();
  return { success: false, error: `${providerName} ${response.status}: ${body}` };
}

function timeoutResult(providerName: string): InitiatePaymentResult {
  return { success: false, error: `${providerName} request timed out after ${FETCH_TIMEOUT_MS}ms` };
}

// A hung gateway response would otherwise block the whole webhook/initiate call
// indefinitely instead of failing fast — bounds every provider fetch to the same
// timeout and converts an abort into a typed failure rather than an uncaught rejection.
export async function fetchWithTimeout(
  providerName: string,
  url: string,
  init: RequestInit,
): Promise<Response | InitiatePaymentResult> {
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

export async function postJsonWithTimeout(
  providerName: string,
  url: string,
  body: unknown,
): Promise<Response | InitiatePaymentResult> {
  return fetchWithTimeout(providerName, url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
