/**
 * Story 17.5 (AC #7, #15): `listAssignedMemberProgressRecency()` backs the
 * Coach Portal Overview's Recent Progress Activity widget.
 *
 * Pinned here:
 *  - it reads `members` with each one's LATEST ACTIVE entry embedded -- the
 *    embedded `deactivated_at is null` filter matters, since RLS does not hide
 *    soft-deleted entries (0067);
 *  - only `logged_at` is selected: no measurement value reaches a summary
 *    screen;
 *  - `progress_photos` is never read -- a logged entry is not consent for a
 *    photo to appear here;
 *  - `role = 'member'`, gym scope, and the same tolerant `gyms` mapping as the
 *    note-recency read.
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

import { listAssignedMemberProgressRecency } from "./coaches";

describe("listAssignedMemberProgressRecency", () => {
  beforeEach(() => {
    calls = [];
    result = { data: [], error: null };
    claimsResult = { data: { claims: { gym_id: "gym-1" } }, error: null };
    from.mockClear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("reads members with each one's latest active entry embedded, logged_at only", async () => {
    await listAssignedMemberProgressRecency();

    expect(calls).toEqual([
      ["from", "members"],
      ["select", "id, name, gyms(timezone), progress_entries(logged_at)"],
      ["eq", "gym_id", "gym-1"],
      ["eq", "role", "member"],
      ["is", "deactivated_at", null],
      ["is", "progress_entries.deactivated_at", null],
      ["order", "name", { ascending: true }],
      ["order", "logged_at", { referencedTable: "progress_entries", ascending: false }],
      ["limit", 1, { referencedTable: "progress_entries" }],
    ]);
  });

  it("never reads progress_photos", async () => {
    await listAssignedMemberProgressRecency();

    expect(from).toHaveBeenCalledTimes(1);
    expect(from).not.toHaveBeenCalledWith("progress_photos");
  });

  it("maps each member to their timezone and latest entry, tolerating every shape gyms can take", async () => {
    result = {
      data: [
        { id: "m-1", name: "Aicha", gyms: { timezone: "Africa/Douala" }, progress_entries: [{ logged_at: "2026-09-08T07:00:00Z" }] },
        { id: "m-2", name: "Blaise", gyms: [{ timezone: "Africa/Lagos" }], progress_entries: [] },
        { id: "m-3", name: "Marc", gyms: null, progress_entries: null },
      ],
      error: null,
    };

    await expect(listAssignedMemberProgressRecency()).resolves.toEqual({
      data: [
        { memberId: "m-1", memberName: "Aicha", gymTimezone: "Africa/Douala", lastAt: "2026-09-08T07:00:00Z" },
        { memberId: "m-2", memberName: "Blaise", gymTimezone: "Africa/Lagos", lastAt: null },
        { memberId: "m-3", memberName: "Marc", gymTimezone: "UTC", lastAt: null },
      ],
      error: null,
    });
  });

  it("returns an empty list when the read returns no data", async () => {
    result = { data: null, error: null };

    await expect(listAssignedMemberProgressRecency()).resolves.toEqual({ data: [], error: null });
  });

  it("returns a mapped error with null data instead of throwing", async () => {
    result = { data: null, error: { message: "boom" } };

    await expect(listAssignedMemberProgressRecency()).resolves.toEqual({
      data: null,
      error: { code: "unknown", message: "mapped error" },
    });
  });

  it("returns the claims error and never queries when there is no gym_id claim", async () => {
    claimsResult = { data: { claims: {} }, error: null };

    const outcome = await listAssignedMemberProgressRecency();

    expect(outcome.data).toBeNull();
    expect(outcome.error).toMatchObject({ code: "not_found" });
    expect(from).not.toHaveBeenCalled();
  });
});
