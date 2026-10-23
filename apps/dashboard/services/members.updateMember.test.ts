/**
 * Story 26.1: `updateMember` writes the three profile fields to the right columns of the gym-scoped members update.
 * A recording stub captures the `.update()` payload and the filters.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let updatePayload: unknown;
let filters: Array<[string, unknown]>;
let result: { data: { id: string } | null; error: unknown };

function builder() {
  const b: Record<string, unknown> = {};
  b.eq = (column: string, value: unknown) => {
    filters.push([column, value]);
    return b;
  };
  b.select = () => b;
  b.maybeSingle = async () => result;
  return b;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getClaims: vi.fn(async () => ({ data: { claims: { gym_id: "gym-1" } }, error: null })) },
    from: (table: string) => ({
      update: (payload: unknown) => {
        updatePayload = { table, payload };
        return builder();
      },
    }),
  })),
}));
vi.mock("@/services/session", () => ({
  mapAndLog: vi.fn(async () => ({ code: "unknown", message: "mapped error" })),
}));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

const input = {
  name: "Amina",
  email: null,
  dob: null,
  photoUrl: null,
  emergencyContact: null,
  birthYear: 1984,
  profession: "Soudeur",
  neighborhood: "Ngui",
};

describe("updateMember profile fields (Story 26.1)", () => {
  beforeEach(() => {
    updatePayload = undefined;
    filters = [];
    result = { data: { id: "m1" }, error: null };
  });

  it("writes birth_year, profession and neighborhood to the members row of the caller's gym", async () => {
    const { updateMember } = await import("./members.changes");

    const { error } = await updateMember("m1", input);

    expect(error).toBeNull();
    expect(updatePayload).toMatchObject({
      table: "members",
      payload: { birth_year: 1984, profession: "Soudeur", neighborhood: "Ngui" },
    });
    expect(filters).toEqual([["gym_id", "gym-1"], ["id", "m1"]]);
  });

  it("writes null when the values are null", async () => {
    const { updateMember } = await import("./members.changes");

    await updateMember("m1", { ...input, birthYear: null, profession: null, neighborhood: null });

    expect(updatePayload).toMatchObject({ payload: { birth_year: null, profession: null, neighborhood: null } });
  });
});
