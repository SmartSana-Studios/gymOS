/**
 * Story 11.3 (Task 3, AC #1): unit tests for the project's first plain
 * Twilio SMS send. Mirrors EvolutionApiMessageProvider.test.ts's shape
 * (missing-env-var failure, non-2xx failure, timeout, success) minus that
 * file's Supabase-client mocking -- this helper has no DB lookup of its own,
 * every credential comes straight from process.env.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PHONE = "+237680811041";
const MESSAGE = "Your GymOS subscription payment is due 2026-09-01. Pay now: https://app.example.com/settings";

describe("sendTwilioSms", () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env.TWILIO_ACCOUNT_SID = "test-sid";
    process.env.TWILIO_AUTH_TOKEN = "test-token";
    process.env.TWILIO_SMS_FROM_NUMBER = "+15551234567";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("returns a clean failure, never throws, when TWILIO_ACCOUNT_SID/AUTH_TOKEN/SMS_FROM_NUMBER are missing", async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_SMS_FROM_NUMBER;
    globalThis.fetch = vi.fn();
    const { sendTwilioSms } = await import("./sendTwilioSms");

    const result = await sendTwilioSms(PHONE, MESSAGE);

    expect(result).toEqual({ success: false, error: "Twilio SMS credentials are not configured" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("maps a non-2xx response to a failure carrying the status and body", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "The 'To' number is not a valid phone number." }), { status: 400 }),
    );
    const { sendTwilioSms } = await import("./sendTwilioSms");

    const result = await sendTwilioSms(PHONE, MESSAGE);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Twilio SMS 400");
      expect(result.error).toContain("not a valid phone number");
      expect(result.status).toBe(400);
    }
  });

  it("treats a 2xx response as success", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ sid: "SM123" }), { status: 201 }));
    const { sendTwilioSms } = await import("./sendTwilioSms");

    const result = await sendTwilioSms(PHONE, MESSAGE);

    expect(result).toEqual({ success: true });
  });

  it("posts To/From/Body form-encoded with Basic auth, and never sends a Content Template (plain SMS, not WhatsApp)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ sid: "SM123" }), { status: 201 }));
    globalThis.fetch = fetchMock;
    const { sendTwilioSms } = await import("./sendTwilioSms");

    await sendTwilioSms(PHONE, MESSAGE);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/test-sid/Messages.json");
    expect(init.headers.Authorization).toBe(`Basic ${btoa("test-sid:test-token")}`);
    const body = init.body as URLSearchParams;
    expect(body.get("To")).toBe(PHONE);
    expect(body.get("From")).toBe("+15551234567");
    expect(body.get("Body")).toBe(MESSAGE);
    expect(body.get("ContentSid")).toBeNull();
  });

  it("returns a clean failure, never throws, when the fetch is aborted by the timeout", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new DOMException("The operation was aborted.", "AbortError"));
    const { sendTwilioSms } = await import("./sendTwilioSms");

    const result = await sendTwilioSms(PHONE, MESSAGE);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("timed out after");
      expect(result.status).toBe(503);
    }
  });

  it("returns a clean failure when fetch rejects with a non-Error value", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue("network exploded");
    const { sendTwilioSms } = await import("./sendTwilioSms");

    const result = await sendTwilioSms(PHONE, MESSAGE);

    expect(result).toEqual({ success: false, error: "Twilio SMS request failed" });
  });

  it("returns a clean failure if response.text() itself throws while reading a non-ok body", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: () => Promise.reject(new Error("stream closed")),
    });
    const { sendTwilioSms } = await import("./sendTwilioSms");

    const result = await sendTwilioSms(PHONE, MESSAGE);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Twilio SMS 502");
      expect(result.error).toContain("failed to read response body");
    }
  });
});
