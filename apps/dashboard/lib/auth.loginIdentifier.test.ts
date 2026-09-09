/**
 * Login identifier: email OR phone (@gymos/types' loginSchema /
 * toPasswordCredentials).
 *
 * WHY THIS EXISTS. Story 9.1's staff provisioning (`createStaffMember()`,
 * apps/dashboard/services/staff.ts) calls
 * `createUser({ phone, password, phone_confirm: true })` with no `email`, so
 * every Supervisor / Manager / Receptionist / Coach account lands with
 * `email = ''`. The dashboard's only login form asked for an email address, so
 * those accounts -- three shipped, code-reviewed stories' worth -- had nothing
 * they could type in. Owners were unaffected: `createGym()`
 * (apps/super-admin/app/(admin)/gyms/actions.ts) sets both email and phone.
 *
 * Confirmed against local Supabase before the fix, on an account created
 * exactly the way createStaffMember() creates one:
 *   signInWithPassword({ email: "", password })            -> 400 "missing email or phone"
 *   signInWithPassword({ phone: "+237699000777", password }) -> access_token
 *   signInWithPassword({ phone: "237699000777", password })  -> access_token
 * So the accounts were never broken and need no email backfill; the form just
 * could not address them. These tests pin the routing that fixes that.
 *
 * `packages/types` has no test runner of its own -- testing its shared logic
 * from the dashboard suite follows lib/errors.gymSuspended.test.ts's precedent.
 */
import { describe, expect, it } from "vitest";

import { isPhoneIdentifier, loginSchema, toPasswordCredentials } from "@gymos/types";

function parse(identifier: string, password = "hunter22") {
  return loginSchema.safeParse({ identifier, password });
}

describe("loginSchema -- accepts an email or a phone number", () => {
  it.each([
    ["owner@example.com", "an ordinary email"],
    ["+237699000777", "E.164 with the leading plus, as every e164Phone schema produces"],
    ["237699000777", "bare digits, which is how GoTrue actually stores the number"],
    ["+237 699 000 777", "a phone typed with spaces"],
    ["+237-699-000-777", "a phone typed with dashes"],
  ])("accepts %j (%s)", (identifier) => {
    expect(parse(identifier).success).toBe(true);
  });

  it.each([
    ["", "empty"],
    ["   ", "whitespace only"],
    ["not-an-email", "a bare word"],
    ["@example.com", "a malformed email"],
    ["+0123456789", "E.164 must not start with 0 after the plus"],
    ["12345", "too short to be a phone number"],
  ])("rejects %j (%s)", (identifier) => {
    expect(parse(identifier).success).toBe(false);
  });

  it("still requires a password", () => {
    expect(parse("owner@example.com", "").success).toBe(false);
  });

  it("reports the identifier error against the identifier field, so the form can surface it in place", () => {
    const result = parse("not-an-email");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["identifier"]);
    }
  });
});

describe("toPasswordCredentials -- routes to the right GoTrue credential shape", () => {
  it("sends an email as { email } -- the Owner path, unchanged", () => {
    const parsed = parse("owner@example.com");
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(toPasswordCredentials(parsed.data)).toEqual({
        email: "owner@example.com",
        password: "hunter22",
      });
    }
  });

  it("sends a phone as { phone } -- the staff path that was previously unreachable", () => {
    const parsed = parse("+237699000777");
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const creds = toPasswordCredentials(parsed.data);
      expect(creds).toEqual({ phone: "+237699000777", password: "hunter22" });
      // Must NOT be sent as an email: `signInWithPassword({ email: "+237..." })`
      // is what produced the original dead end.
      expect(creds).not.toHaveProperty("email");
    }
  });

  it("strips typed formatting from a phone before sending it", () => {
    const parsed = parse("+237 699-000 777");
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(toPasswordCredentials(parsed.data)).toEqual({
        phone: "+237699000777",
        password: "hunter22",
      });
    }
  });

  it("trims surrounding whitespace on an email rather than sending it to GoTrue", () => {
    const parsed = parse("  owner@example.com  ");
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(toPasswordCredentials(parsed.data)).toEqual({
        email: "owner@example.com",
        password: "hunter22",
      });
    }
  });

  it("keeps an unprefixed phone unprefixed -- GoTrue accepts both forms, confirmed live", () => {
    const parsed = parse("237699000777");
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(toPasswordCredentials(parsed.data)).toEqual({
        phone: "237699000777",
        password: "hunter22",
      });
    }
  });
});

describe("isPhoneIdentifier", () => {
  it("never classifies an email as a phone, so the two branches cannot overlap", () => {
    for (const email of ["a@b.co", "owner@example.com", "237@example.com"]) {
      expect(isPhoneIdentifier(email)).toBe(false);
    }
  });

  it("classifies E.164 with and without the plus as a phone", () => {
    expect(isPhoneIdentifier("+237699000777")).toBe(true);
    expect(isPhoneIdentifier("237699000777")).toBe(true);
  });
});
