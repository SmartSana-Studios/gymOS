/**
 * Story 17.5 (AC #6, #15): `listAssignedMemberNoteRecency()` backs the Coach
 * Portal Overview's Needs Follow-Up widget.
 *
 * Pinned here:
 *  - it reads `members` with an embedded LATEST note per member
 *    (`limit(1, { referencedTable })`), never a `session_notes` row fetch --
 *    max_rows = 1000 would silently truncate a notes table that only grows;
 *  - `role = 'member'` is filtered, because `self_read_own_membership` hands a
 *    Coach their own row on any `members` select;
 *  - the FK hint, since `session_notes` has two FKs to `members`;
 *  - the mapping tolerates `gyms` as an object (what PostgREST sends), a
 *    one-element array (what the query builder's types claim) or null, and
 *    never yields an empty timezone, which would make Intl throw.
 *
 * The query builder is a recording stub: every call is appended to `calls`,
 * and awaiting the builder resolves to `result`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = [string, ...unknown[]];

let calls: Call[];
let result: { data: unknown; error: unknown };
let claimsResult: { data: { claims: Record<string, unknown> | null } | null; error: unknown };

function makeBuilder() {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "order", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.then = (resolve: (value: typeof result) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

const from = vi.fn((table: string) => {
  calls.push(["from", table]);
  return makeBuilder();
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getClaims: vi.fn(async () => claimsResult) },
    from,
  })),
}));

vi.mock("@/services/session", () => ({
  mapAndLog: vi.fn(async () => ({ code: "unknown", message: "mapped error" })),
}));

vi.mock("@/lib/i18n/get-request-locale", () => ({
  getRequestLocale: vi.fn(async () => "en"),
}));

vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

import { listAssignedMemberNoteRecency } from "./coaches";

describe("listAssignedMemberNoteRecency", () => {
  beforeEach(() => {
    calls = [];
    result = { data: [], error: null };
    claimsResult = { data: { claims: { gym_id: "gym-1" } }, error: null };
    from.mockClear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("reads members with each one's latest note embedded, gym-scoped and members-only", async () => {
    await listAssignedMemberNoteRecency();

    expect(calls).toEqual([
      ["from", "members"],
      ["select", "id, name, gyms(timezone), session_notes!session_notes_member_id_fkey(created_at)"],
      ["eq", "gym_id", "gym-1"],
      ["eq", "role", "member"],
      ["is", "deactivated_at", null],
      ["order", "name", { ascending: true }],
      ["order", "created_at", { referencedTable: "session_notes", ascending: false }],
      ["limit", 1, { referencedTable: "session_notes" }],
    ]);
  });

  it("maps each member to their timezone and latest note, tolerating every shape gyms can take", async () => {
    result = {
      data: [
        { id: "m-1", name: "Aicha", gyms: { timezone: "Africa/Douala" }, session_notes: [{ created_at: "2026-09-07T10:00:00Z" }] },
        { id: "m-2", name: "Blaise", gyms: [{ timezone: "Africa/Lagos" }], session_notes: [] },
        { id: "m-3", name: "Marc", gyms: null, session_notes: null },
      ],
      error: null,
    };

    await expect(listAssignedMemberNoteRecency()).resolves.toEqual({
      data: [
        { memberId: "m-1", memberName: "Aicha", gymTimezone: "Africa/Douala", lastAt: "2026-09-07T10:00:00Z" },
        { memberId: "m-2", memberName: "Blaise", gymTimezone: "Africa/Lagos", lastAt: null },
        { memberId: "m-3", memberName: "Marc", gymTimezone: "UTC", lastAt: null },
      ],
      error: null,
    });
  });

  it("returns an empty list when the read returns no data", async () => {
    result = { data: null, error: null };

    await expect(listAssignedMemberNoteRecency()).resolves.toEqual({ data: [], error: null });
  });

  it("returns a mapped error with null data instead of throwing", async () => {
    result = { data: null, error: { message: "boom" } };

    await expect(listAssignedMemberNoteRecency()).resolves.toEqual({
      data: null,
      error: { code: "unknown", message: "mapped error" },
    });
  });

  it("returns the claims error and never queries when there is no gym_id claim", async () => {
    claimsResult = { data: { claims: {} }, error: null };

    const outcome = await listAssignedMemberNoteRecency();

    expect(outcome.data).toBeNull();
    expect(outcome.error).toMatchObject({ code: "not_found" });
    expect(from).not.toHaveBeenCalled();
  });
});
