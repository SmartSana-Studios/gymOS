// Deno test suite for the ordered fallback-chain runner (Story 2.9, Task 2 — AC #2, #3, #4).
//
// index.ts's static import graph pulls in EvolutionApiProvider.ts, which creates a supabase-js
// client at module scope (null, not a throw, if SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are unset —
// see EvolutionApiProvider.test.ts). This file sets them before importing index.ts dynamically
// regardless, since sendViaChain's own tests below swap in tracked fake providers and never
// exercise the real EvolutionApiProvider (a static top-level import would in any case be hoisted
// ahead of the Deno.env.set calls).
//
// Run: deno test --allow-env supabase/functions/send-sms-hook/index.test.ts

import { assert, assertEquals } from "jsr:@std/assert@^1";
import type { DeliveryResult, OtpDeliveryProvider } from "./_shared/otp-providers/OtpDeliveryProvider.ts";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");

const { sendViaChain, PROVIDER_CHAIN, redactPhone, normalizePhone } = await import("./index.ts");

const PHONE = "+237680811041";
const CODE = "123456";

const originalChain = [...PROVIDER_CHAIN];
function setChain(...providers: OtpDeliveryProvider[]) {
  PROVIDER_CHAIN.length = 0;
  PROVIDER_CHAIN.push(...providers);
}
function restoreChain() {
  setChain(...originalChain);
}

function trackedProvider(behavior: "success" | "fail" | "throw", label = "provider"): OtpDeliveryProvider & { calls: number } {
  return {
    calls: 0,
    async send(): Promise<DeliveryResult> {
      this.calls++;
      if (behavior === "throw") throw new Error(`${label} exploded unexpectedly`);
      if (behavior === "fail") return { success: false, error: `${label} rejected ${PHONE}` };
      return { success: true, channel: "whatsapp" };
    },
  };
}

// Captures both console.log (success) and console.error (failure, code review fix -- a
// per-provider failure now logs at error level, not log level) into one ordered array, tagged
// with which stream each line came from -- `lines` stays a plain-text projection for callers
// that only care about content/order, `entries` exposes the stream tag for callers (review fix:
// code review flagged that only exposing merged `lines` made the console.error-for-failures
// fix itself unverifiable by any test) that need to assert failures use console.error, not
// console.log.
function captureConsoleLog() {
  const entries: Array<{ stream: "log" | "error"; text: string }> = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args: unknown[]) => entries.push({ stream: "log", text: args.map(String).join(" ") });
  console.error = (...args: unknown[]) => entries.push({ stream: "error", text: args.map(String).join(" ") });
  return {
    entries,
    restore: () => {
      console.log = originalLog;
      console.error = originalError;
    },
  };
}

Deno.test({
  name: "sendViaChain: first provider succeeding short-circuits — later providers are never called",
  fn: async () => {
    const first = trackedProvider("success");
    const second = trackedProvider("success");
    setChain(first, second);
    try {
      const result = await sendViaChain(PHONE, CODE, "en");
      assertEquals(result, { success: true, channel: "whatsapp" });
      assertEquals(first.calls, 1);
      assertEquals(second.calls, 0, "chain must short-circuit on first success");
    } finally {
      restoreChain();
    }
  },
});

Deno.test({
  name: "sendViaChain: Evolution API failing falls through to the next provider and the OTP still arrives (AC #3)",
  fn: async () => {
    const evolution = trackedProvider("fail", "EvolutionApiProvider");
    const twilioWhatsApp = trackedProvider("success");
    const twilioSms = trackedProvider("success");
    setChain(evolution, twilioWhatsApp, twilioSms);
    try {
      const result = await sendViaChain(PHONE, CODE, "en");
      assertEquals(result.success, true);
      assertEquals(evolution.calls, 1);
      assertEquals(twilioWhatsApp.calls, 1, "must fall through to the next provider");
      assertEquals(twilioSms.calls, 0, "must not call providers after the first success");
    } finally {
      restoreChain();
    }
  },
});

Deno.test({
  name: "sendViaChain: a provider throwing unexpectedly does not abort the chain — it's treated as a failure and the chain advances",
  fn: async () => {
    const throwing = trackedProvider("throw", "FlakyProvider");
    const fallback = trackedProvider("success");
    setChain(throwing, fallback);
    try {
      const result = await sendViaChain(PHONE, CODE, "en");
      assertEquals(result.success, true);
      assertEquals(throwing.calls, 1);
      assertEquals(fallback.calls, 1);
    } finally {
      restoreChain();
    }
  },
});

Deno.test({
  name: "sendViaChain: every provider failing returns the LAST provider's failure result (preserves 429/503 Retry-After mapping)",
  fn: async () => {
    const a = trackedProvider("fail", "A");
    const b: OtpDeliveryProvider = {
      async send(): Promise<DeliveryResult> {
        return { success: false, error: "B rate limited", status: 429, retryAfter: "30" };
      },
    };
    setChain(a, b);
    try {
      const result = await sendViaChain(PHONE, CODE, "en");
      assertEquals(result.success, false);
      if (!result.success) {
        assertEquals(result.status, 429);
        assertEquals(result.retryAfter, "30");
      }
    } finally {
      restoreChain();
    }
  },
});

Deno.test({
  name: "sendViaChain: logs one line per attempt and never leaks the raw phone number into a log line",
  fn: async () => {
    const a = trackedProvider("fail", "A");
    const b = trackedProvider("success");
    setChain(a, b);
    const { entries, restore } = captureConsoleLog();
    try {
      await sendViaChain(PHONE, CODE, "en");
      assertEquals(entries.length, 2, "one log line per attempt");
      for (const entry of entries) {
        assert(!entry.text.includes(PHONE), `log line leaked the raw phone number: ${entry.text}`);
      }
      assert(entries[0].text.includes("[REDACTED]"), "failed attempt must log the redacted error");
      assert(entries[1].text.includes("success"), "successful attempt must log success");
      assertEquals(entries[0].stream, "error", "code review fix: a failed attempt must log via console.error, not console.log, so it reaches error-level monitoring");
      assertEquals(entries[1].stream, "log", "a successful attempt must still log via console.log");
    } finally {
      restore();
      restoreChain();
    }
  },
});

Deno.test("redactPhone: replaces both the E.164 and bare-digit forms of the phone with [REDACTED]", () => {
  const withPlus = redactPhone(`Invalid 'To' Phone Number: ${PHONE}`, PHONE);
  assert(!withPlus.includes(PHONE));
  assert(withPlus.includes("[REDACTED]"));

  const bareDigits = PHONE.replace("+", "");
  const withoutPlus = redactPhone(`number ${bareDigits} is invalid`, PHONE);
  assert(!withoutPlus.includes(bareDigits));
  assert(withoutPlus.includes("[REDACTED]"));
});

Deno.test("normalizePhone: accepts GoTrue's no-leading-plus payload shape and rejects out-of-bounds digit counts", () => {
  assertEquals(normalizePhone("237680811041"), "+237680811041");
  assertEquals(normalizePhone("+237680811041"), "+237680811041");
  assertEquals(normalizePhone("1234567"), null, "7 digits is below the 8-digit E.164 floor");
  assertEquals(normalizePhone("0123456789"), null, "a leading 0 is not a valid E.164 country-code digit");
});
