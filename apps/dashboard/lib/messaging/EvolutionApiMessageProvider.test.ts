/**
 * Story 2.10 (Task 1, AC #1-#3): unit tests for the Node port of the Deno
 * `EvolutionApiProvider.ts` REST contract. Mirrors that file's own Deno test
 * suite (`supabase/functions/send-sms-hook/_shared/otp-providers/EvolutionApiProvider.test.ts`)
 * -- same scenarios (missing config, missing instance, non-2xx, 2xx, phone
 * normalization, per-request instance_id read), adapted to Vitest/`fetch`
 * mocking and a mocked `createAdminClient()` instead of a stubbed `fetch` to
 * the PostgREST endpoint directly.
 *
 * Story 11.3: `resolveWhatsappNumber()`'s pre-send number-existence check
 * adds a second `fetch` call (`/chat/whatsappNumbers/{instance}`) ahead of
 * every send -- `makeFetchMock()` below routes by URL so every pre-existing
 * test's `sendText` assertions stay unaffected (the check defaults to "not
 * found for either candidate", which falls open to the original number,
 * identical to this function's pre-Story-11.3 behavior). New tests below
 * that block cover the check's own real behavior.
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

// `globalThis.fetch`'s real type is contravariant in its first parameter
// (`URL | RequestInfo`, not the narrower `RequestInfo | URL` union these
// mocks type explicitly) -- every mock is assigned to `globalThis.fetch`
// via `as unknown as typeof fetch` at its own call site, so `.mock.calls`
// still reflects the exact shape each test asserts against.

/**
 * Routes by URL: the whatsappNumbers check endpoint gets `checkResults`
 * (default: neither candidate found, falls open to the original number --
 * every pre-existing test's own expected behavior), the sendText endpoint
 * gets `sendTextResponse`.
 */
function makeFetchMock(sendTextResponse: Response | Promise<Response>, checkResults: unknown[] = []) {
  return vi.fn((url: RequestInfo | URL, _init?: RequestInit) => {
    if (String(url).includes("/chat/whatsappNumbers/")) {
      return Promise.resolve(new Response(JSON.stringify(checkResults), { status: 200 }));
    }
    return Promise.resolve(sendTextResponse);
  });
}

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
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
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
    globalThis.fetch = makeFetchMock(
      new Response(JSON.stringify({ error: "Connection Closed" }), { status: 500 }),
    ) as unknown as typeof fetch;
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
    globalThis.fetch = makeFetchMock(new Response(JSON.stringify({}), { status: 201 })) as unknown as typeof fetch;
    const { sendEvolutionApiMessage } = await import("./EvolutionApiMessageProvider");

    const result = await sendEvolutionApiMessage(PHONE, MESSAGE);

    expect(result).toEqual({ success: true, channel: "whatsapp" });
  });

  it("posts to {baseUrl}/message/sendText/{instance} with the apikey header and strips the leading '+' from the phone", async () => {
    singleMock.mockResolvedValue({ data: { instance_id: "souna2" }, error: null });
    const fetchMock = makeFetchMock(new Response(JSON.stringify({}), { status: 201 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { sendEvolutionApiMessage } = await import("./EvolutionApiMessageProvider");

    await sendEvolutionApiMessage(PHONE, MESSAGE);

    const sendTextCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/message/sendText/"));
    expect(sendTextCall).toBeDefined();
    const [url, init] = sendTextCall!;
    expect(url).toBe("https://evo.example.com/message/sendText/souna2");
    expect((init as RequestInit).headers as Record<string, string>).toMatchObject({ apikey: "test-key" });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ number: "237680811041", text: MESSAGE });
  });

  it("reads instance_id per-request, not cached -- two sends both query messaging_provider_config", async () => {
    singleMock.mockResolvedValue({ data: { instance_id: "souna2" }, error: null });
    globalThis.fetch = makeFetchMock(new Response(JSON.stringify({}), { status: 201 })) as unknown as typeof fetch;
    const { sendEvolutionApiMessage } = await import("./EvolutionApiMessageProvider");

    await sendEvolutionApiMessage(PHONE, MESSAGE);
    await sendEvolutionApiMessage(PHONE, MESSAGE);

    expect(fromMock).toHaveBeenCalledTimes(2);
  });

  it("returns a clean failure, never throws, when the fetch is aborted by the timeout (Review finding, Story 2.10)", async () => {
    singleMock.mockResolvedValue({ data: { instance_id: "souna2" }, error: null });
    globalThis.fetch = vi.fn((url: RequestInfo | URL, _init?: RequestInit) => {
      if (String(url).includes("/chat/whatsappNumbers/")) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
    }) as unknown as typeof fetch;
    const { sendEvolutionApiMessage } = await import("./EvolutionApiMessageProvider");

    const result = await sendEvolutionApiMessage(PHONE, MESSAGE);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("timed out after");
    }
  });

  it("returns a clean failure when fetch rejects with a non-Error value (Review finding, Story 2.10)", async () => {
    singleMock.mockResolvedValue({ data: { instance_id: "souna2" }, error: null });
    globalThis.fetch = vi.fn((url: RequestInfo | URL, _init?: RequestInit) => {
      if (String(url).includes("/chat/whatsappNumbers/")) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      return Promise.reject("network exploded");
    }) as unknown as typeof fetch;
    const { sendEvolutionApiMessage } = await import("./EvolutionApiMessageProvider");

    const result = await sendEvolutionApiMessage(PHONE, MESSAGE);

    expect(result).toEqual({ success: false, error: "Evolution API request failed" });
  });

  it("returns a clean failure if response.text() itself throws while reading a non-ok body", async () => {
    singleMock.mockResolvedValue({ data: { instance_id: "souna2" }, error: null });
    globalThis.fetch = vi.fn((url: RequestInfo | URL, _init?: RequestInit) => {
      if (String(url).includes("/chat/whatsappNumbers/")) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      return Promise.resolve({
        ok: false,
        status: 502,
        text: () => Promise.reject(new Error("stream closed")),
      });
    }) as unknown as typeof fetch;
    const { sendEvolutionApiMessage } = await import("./EvolutionApiMessageProvider");

    const result = await sendEvolutionApiMessage(PHONE, MESSAGE);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Evolution API 502");
      expect(result.error).toContain("failed to read response body");
    }
  });

  // --- Story 11.3: resolveWhatsappNumber() ----------------------------------------------------

  describe("resolveWhatsappNumber (pre-send number-existence check)", () => {
    it("sends to the primary number when the check confirms it exists, without trying the variant", async () => {
      singleMock.mockResolvedValue({ data: { instance_id: "souna2" }, error: null });
      const fetchMock = makeFetchMock(new Response(JSON.stringify({}), { status: 201 }), [
        { jid: "237680811041@s.whatsapp.net", exists: true, number: "237680811041" },
      ]);
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      const { sendEvolutionApiMessage } = await import("./EvolutionApiMessageProvider");

      await sendEvolutionApiMessage(PHONE, MESSAGE);

      const sendTextCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/message/sendText/"));
      const body = JSON.parse((sendTextCall![1] as RequestInit).body as string);
      expect(body.number).toBe("237680811041");
    });

    it("sends to the national-number-length variant when the primary isn't found but the variant is (the real Cameroon 8-vs-9-digit finding)", async () => {
      singleMock.mockResolvedValue({ data: { instance_id: "souna2" }, error: null });
      const fetchMock = makeFetchMock(new Response(JSON.stringify({}), { status: 201 }), [
        { jid: "237680811041@s.whatsapp.net", exists: false, number: "237680811041" },
        { jid: "23780811041@s.whatsapp.net", exists: true, number: "23780811041" },
      ]);
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      const { sendEvolutionApiMessage } = await import("./EvolutionApiMessageProvider");

      await sendEvolutionApiMessage(PHONE, MESSAGE);

      const sendTextCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/message/sendText/"));
      const body = JSON.parse((sendTextCall![1] as RequestInit).body as string);
      expect(body.number).toBe("23780811041");
    });

    it("falls open to the original number when neither the primary nor the variant is found", async () => {
      singleMock.mockResolvedValue({ data: { instance_id: "souna2" }, error: null });
      const fetchMock = makeFetchMock(new Response(JSON.stringify({}), { status: 201 }), [
        { jid: "237680811041@s.whatsapp.net", exists: false, number: "237680811041" },
        { jid: "23780811041@s.whatsapp.net", exists: false, number: "23780811041" },
      ]);
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      const { sendEvolutionApiMessage } = await import("./EvolutionApiMessageProvider");

      await sendEvolutionApiMessage(PHONE, MESSAGE);

      const sendTextCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/message/sendText/"));
      const body = JSON.parse((sendTextCall![1] as RequestInit).body as string);
      expect(body.number).toBe("237680811041");
    });

    it("falls open to the original number, and still sends, when the check endpoint itself errors", async () => {
      singleMock.mockResolvedValue({ data: { instance_id: "souna2" }, error: null });
      const fetchMock = vi.fn((url: RequestInfo | URL, _init?: RequestInit) => {
        if (String(url).includes("/chat/whatsappNumbers/")) {
          return Promise.reject(new Error("network down"));
        }
        return Promise.resolve(new Response(JSON.stringify({}), { status: 201 }));
      });
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      const { sendEvolutionApiMessage } = await import("./EvolutionApiMessageProvider");

      const result = await sendEvolutionApiMessage(PHONE, MESSAGE);

      expect(result.success).toBe(true);
      const sendTextCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/message/sendText/"));
      const body = JSON.parse((sendTextCall![1] as RequestInit).body as string);
      expect(body.number).toBe("237680811041");
    });

    it("falls open to the original number, and still sends, when the check endpoint returns a non-ok response", async () => {
      singleMock.mockResolvedValue({ data: { instance_id: "souna2" }, error: null });
      const fetchMock = vi.fn((url: RequestInfo | URL, _init?: RequestInit) => {
        if (String(url).includes("/chat/whatsappNumbers/")) {
          return Promise.resolve(new Response(JSON.stringify({ error: "bad request" }), { status: 400 }));
        }
        return Promise.resolve(new Response(JSON.stringify({}), { status: 201 }));
      });
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      const { sendEvolutionApiMessage } = await import("./EvolutionApiMessageProvider");

      const result = await sendEvolutionApiMessage(PHONE, MESSAGE);

      expect(result.success).toBe(true);
    });

    it("skips the check entirely (only one fetch call) when no distinct national-number-length variant is computable", async () => {
      singleMock.mockResolvedValue({ data: { instance_id: "souna2" }, error: null });
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 201 }));
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      const { sendEvolutionApiMessage } = await import("./EvolutionApiMessageProvider");

      // Not a parseable phone number -- parsePhoneNumberFromString returns
      // undefined, so there is no country-calling-code/national-number to
      // derive a variant from.
      await sendEvolutionApiMessage("not-a-phone-number", MESSAGE);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0][0])).toContain("/message/sendText/");
    });
  });
});
