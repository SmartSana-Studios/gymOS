/**
 * Story 2.10 (Task 1, AC #1-#3): unit tests for the Node port of the Deno
 * `EvolutionApiProvider.ts` REST contract. Mirrors that file's own Deno test
 * suite (`supabase/functions/send-sms-hook/_shared/otp-providers/EvolutionApiProvider.test.ts`)
 * -- same scenarios (missing config, missing instance, non-2xx, 2xx, phone
 * normalization, per-request instance_id read), adapted to Vitest/`fetch`
 * mocking and a mocked `createAdminClient()` instead of a stubbed `fetch` to
 * the PostgREST endpoint directly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const singleMock = vi.fn();
const selectMock = vi.fn(() => ({ single: singleMock }));
const fromMock = vi.fn(() => ({ select: selectMock }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: fromMock }),
}));

const PHONE = "+237680811041";
const MESSAGE = "Alice, you've been added to Iron Gym on GymOS.";

describe("sendEvolutionApiMessage", () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    singleMock.mockReset();
    selectMock.mockClear();
    fromMock.mockClear();
    process.env.EVOLUTION_API_BASE_URL = "https://evo.example.com";
    process.env.EVOLUTION_API_KEY = "test-key";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("returns a clean failure, never throws, when EVOLUTION_API_BASE_URL/KEY are missing", async () => {
    delete process.env.EVOLUTION_API_BASE_URL;
    delete process.env.EVOLUTION_API_KEY;
    const { sendEvolutionApiMessage } = await import("./EvolutionApiMessageProvider");

    const result = await sendEvolutionApiMessage(PHONE, MESSAGE);

    expect(result.success).toBe(false);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns a clean failure when messaging_provider_config.instance_id is null (Story 1.13's 'not yet configured' state)", async () => {
    singleMock.mockResolvedValue({ data: { instance_id: null }, error: null });
    globalThis.fetch = vi.fn();
    const { sendEvolutionApiMessage } = await import("./EvolutionApiMessageProvider");

    const result = await sendEvolutionApiMessage(PHONE, MESSAGE);

    expect(result).toEqual({ success: false, error: "Evolution API instance is not configured" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("returns a clean failure when the instance_id lookup itself errors, rather than throwing", async () => {
    singleMock.mockResolvedValue({ data: null, error: { message: "no rows", code: "PGRST116" } });
    const { sendEvolutionApiMessage } = await import("./EvolutionApiMessageProvider");

    const result = await sendEvolutionApiMessage(PHONE, MESSAGE);

    expect(result.success).toBe(false);
  });

  it("maps a non-2xx sendText response to a failure carrying the status and body", async () => {
    singleMock.mockResolvedValue({ data: { instance_id: "souna2" }, error: null });
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Connection Closed" }), { status: 500 }),
    );
    const { sendEvolutionApiMessage } = await import("./EvolutionApiMessageProvider");

    const result = await sendEvolutionApiMessage(PHONE, MESSAGE);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Evolution API 500");
      expect(result.error).toContain("Connection Closed");
    }
  });

  it("treats a 2xx sendText response as success on the whatsapp channel", async () => {
    singleMock.mockResolvedValue({ data: { instance_id: "souna2" }, error: null });
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 201 }));
    const { sendEvolutionApiMessage } = await import("./EvolutionApiMessageProvider");

    const result = await sendEvolutionApiMessage(PHONE, MESSAGE);

    expect(result).toEqual({ success: true, channel: "whatsapp" });
  });

  it("posts to {baseUrl}/message/sendText/{instance} with the apikey header and strips the leading '+' from the phone", async () => {
    singleMock.mockResolvedValue({ data: { instance_id: "souna2" }, error: null });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 201 }));
    globalThis.fetch = fetchMock;
    const { sendEvolutionApiMessage } = await import("./EvolutionApiMessageProvider");

    await sendEvolutionApiMessage(PHONE, MESSAGE);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://evo.example.com/message/sendText/souna2");
    expect(init.headers.apikey).toBe("test-key");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ number: "237680811041", text: MESSAGE });
  });

  it("reads instance_id per-request, not cached -- two sends both query messaging_provider_config", async () => {
    singleMock.mockResolvedValue({ data: { instance_id: "souna2" }, error: null });
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 201 }));
    const { sendEvolutionApiMessage } = await import("./EvolutionApiMessageProvider");

    await sendEvolutionApiMessage(PHONE, MESSAGE);
    await sendEvolutionApiMessage(PHONE, MESSAGE);

    expect(fromMock).toHaveBeenCalledTimes(2);
  });

  it("returns a clean failure if response.text() itself throws while reading a non-ok body", async () => {
    singleMock.mockResolvedValue({ data: { instance_id: "souna2" }, error: null });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: () => Promise.reject(new Error("stream closed")),
    });
    const { sendEvolutionApiMessage } = await import("./EvolutionApiMessageProvider");

    const result = await sendEvolutionApiMessage(PHONE, MESSAGE);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Evolution API 502");
      expect(result.error).toContain("failed to read response body");
    }
  });
});
