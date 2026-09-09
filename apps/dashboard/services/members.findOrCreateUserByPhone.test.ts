/**
 * Regression tests for `findOrCreateUserByPhone` (services/members.ts), the
 * member-side "does this phone already have a platform account" lookup.
 *
 * THE BUG THESE PIN. GoTrue stores `auth.users.phone` -- and the trigger-copied
 * `public.users.phone` (0003_members_and_users.sql:62-63) -- in E.164 digits
 * WITHOUT the leading "+", while every Zod `e164Phone` schema in this codebase
 * REQUIRES it (`/^\+[1-9]\d{7,14}$/`, member.ts:9, csvImport.ts:24-26). Both
 * lookups here compared the raw "+"-prefixed input, so neither ever matched an
 * existing row: the find fell through to `createUser()`, GoTrue's own
 * consistently-normalized uniqueness check rejected it with `phone_exists`, and
 * the race-recovery re-query missed for the same reason -- so the caller got a
 * confusing "already registered" error instead of the existing account being
 * reused. Practical effect: adding an already-registered person as a member at
 * a second gym failed, which is the thing multi-gym support exists for.
 *
 * Reproduced directly against this project's local Supabase before fixing (not
 * inferred from the sibling bug): `createUser({ phone: "+237699000777" })`
 * persisted as `237699000777`, and
 * `select count(*) from public.users where phone = '+237699000777'` returned 0
 * while the un-prefixed form returned 1.
 *
 * `createStaffMember()` carried the identical defect and fixed it in Story 9.4
 * (staff.ts:200-213, asserted in staff.createStaffMember.test.ts:144);
 * members.ts was the file that one was modelled on and never received the fix.
 *
 * Mocking follows staff.createStaffMember.test.ts: `@/lib/supabase/admin`'s
 * `createAdminClient()` is replaced with a small chainable stub rather than
 * hitting a real database.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let usersLookupResults: Array<{ data: { id: string } | null; error: unknown }>;
let usersLookupCalls: Array<{ table: string; column: string; value: string }>;
let createUserResult: { data: { user: { id: string } } | null; error: unknown };
let createUserCalls: Array<{ phone: string; phone_confirm: boolean }>;

const createUserMock = vi.fn(async (args: { phone: string; phone_confirm: boolean }) => {
  createUserCalls.push(args);
  return createUserResult;
});

function makeAdminStub() {
  return {
    auth: { admin: { createUser: createUserMock } },
    from: vi.fn((table: string) => ({
      select: () => ({
        eq: (column: string, value: string) => ({
          maybeSingle: async () => {
            usersLookupCalls.push({ table, column, value });
            // Each call consumes the next queued result, so the initial lookup
            // and the race-recovery re-query can be driven independently.
            return usersLookupResults.shift() ?? { data: null, error: null };
          },
        }),
      }),
    })),
  };
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => makeAdminStub()),
}));

vi.mock("@/services/session", () => ({
  mapAndLog: vi.fn(async (err: unknown) => ({
    code: "unknown",
    message: `mapped: ${JSON.stringify(err)}`,
  })),
}));

const PHONE_WITH_PLUS = "+237699000777";
const PHONE_AS_STORED = "237699000777";

describe("findOrCreateUserByPhone -- E.164 lookup normalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usersLookupResults = [];
    usersLookupCalls = [];
    createUserCalls = [];
    createUserResult = { data: { user: { id: "new-user-1" } }, error: null };
  });

  it("strips the leading '+' before comparing against public.users.phone -- the raw input would never match GoTrue's stored format", async () => {
    usersLookupResults = [{ data: { id: "existing-user-1" }, error: null }];
    const { findOrCreateUserByPhone } = await import("@/services/members");

    const result = await findOrCreateUserByPhone(PHONE_WITH_PLUS);

    expect(usersLookupCalls).toEqual([
      { table: "users", column: "phone", value: PHONE_AS_STORED },
    ]);
    expect(usersLookupCalls[0]?.value).not.toContain("+");
    expect(result).toEqual({
      data: { userId: "existing-user-1", created: false },
      error: null,
    });
    // The whole point: an existing account is REUSED, so no second account is
    // provisioned and no `phone_exists` rejection ever reaches the caller.
    expect(createUserMock).not.toHaveBeenCalled();
  });

  it("still provisions a new auth user when the normalized lookup genuinely finds nobody, and passes the '+'-prefixed form to createUser (GoTrue normalizes on write)", async () => {
    usersLookupResults = [{ data: null, error: null }];
    const { findOrCreateUserByPhone } = await import("@/services/members");

    const result = await findOrCreateUserByPhone(PHONE_WITH_PLUS);

    expect(usersLookupCalls).toEqual([
      { table: "users", column: "phone", value: PHONE_AS_STORED },
    ]);
    expect(createUserCalls).toEqual([{ phone: PHONE_WITH_PLUS, phone_confirm: false }]);
    expect(result).toEqual({
      data: { userId: "new-user-1", created: true },
      error: null,
    });
  });

  it("normalizes the race-recovery re-query too -- a `phone_exists` collision self-heals into a reuse instead of surfacing as an error", async () => {
    // Initial lookup misses (the racing session had not committed yet),
    // createUser then loses the race, and the re-query must find the row the
    // winner wrote. Before the fix this second comparison also carried the
    // "+", so it missed as well and the raw error was returned.
    usersLookupResults = [
      { data: null, error: null },
      { data: { id: "race-winner-1" }, error: null },
    ];
    createUserResult = { data: null, error: { code: "phone_exists" } };
    const { findOrCreateUserByPhone } = await import("@/services/members");

    const result = await findOrCreateUserByPhone(PHONE_WITH_PLUS);

    expect(usersLookupCalls).toEqual([
      { table: "users", column: "phone", value: PHONE_AS_STORED },
      { table: "users", column: "phone", value: PHONE_AS_STORED },
    ]);
    expect(result).toEqual({
      data: { userId: "race-winner-1", created: false },
      error: null,
    });
  });

  it("accepts an already-unprefixed number unchanged, so a caller that has pre-normalized is not double-stripped", async () => {
    usersLookupResults = [{ data: { id: "existing-user-2" }, error: null }];
    const { findOrCreateUserByPhone } = await import("@/services/members");

    await findOrCreateUserByPhone(PHONE_AS_STORED);

    expect(usersLookupCalls).toEqual([
      { table: "users", column: "phone", value: PHONE_AS_STORED },
    ]);
  });

  it("surfaces a lookup error before attempting any provisioning", async () => {
    usersLookupResults = [{ data: null, error: { message: "boom" } }];
    const { findOrCreateUserByPhone } = await import("@/services/members");

    const result = await findOrCreateUserByPhone(PHONE_WITH_PLUS);

    expect(createUserMock).not.toHaveBeenCalled();
    expect(result.data).toBeNull();
    expect(result.error).toEqual({
      code: "unknown",
      message: `mapped: ${JSON.stringify({ message: "boom" })}`,
    });
  });
});
