/**
 * Story 13.1 (Task 3, AC #1, #2): unit tests for `addCustomExercise`.
 * Exercises the Zod pre-check, the caller's-gym-scoped insert, and the
 * RLS-denied ("not a Coach") failure path without hitting a real database --
 * matches getMemberForInvite.test.ts's chainable-stub shape for
 * `@/lib/supabase/server`'s `createClient()`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let claimsResult: { data: { claims: Record<string, unknown> | null } | null; error: unknown };
let insertResult: { data: { id: string; name: string } | null; error: unknown };
let insertCalls: Array<Record<string, unknown>>;

function makeSupabaseStub() {
  return {
    auth: {
      getClaims: vi.fn(async () => claimsResult),
    },
    from: vi.fn(() => ({
      insert: vi.fn((row: Record<string, unknown>) => {
        insertCalls.push(row);
        return {
          select: vi.fn(() => ({
            single: vi.fn(async () => insertResult),
          })),
        };
      }),
    })),
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => makeSupabaseStub()),
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

describe("addCustomExercise", () => {
  beforeEach(() => {
    claimsResult = { data: { claims: { gym_id: "gym-1" } }, error: null };
    insertResult = { data: { id: "exercise-1", name: "Kettlebell Swing" }, error: null };
    insertCalls = [];
  });

  it("inserts scoped to the caller's own gym and returns the new row", async () => {
    const { addCustomExercise } = await import("./exercises");

    const result = await addCustomExercise({ name: "Kettlebell Swing" });

    expect(insertCalls).toEqual([{ gym_id: "gym-1", name: "Kettlebell Swing" }]);
    expect(result).toEqual({ data: { id: "exercise-1", name: "Kettlebell Swing" }, error: null });
  });

  it("returns { data: null, error } without throwing when RLS denies the insert (caller is not a Coach)", async () => {
    insertResult = { data: null, error: { message: "new row violates row-level security policy" } };
    const { addCustomExercise } = await import("./exercises");

    const result = await addCustomExercise({ name: "Kettlebell Swing" });

    expect(result.data).toBeNull();
    expect(result.error).toEqual({ code: "unknown", message: "mapped error" });
  });

  it("rejects an empty/whitespace-only name before ever reaching Supabase", async () => {
    const { addCustomExercise } = await import("./exercises");

    const result = await addCustomExercise({ name: "   " });

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("validation_error");
    expect(insertCalls).toEqual([]);
  });

  it("returns the no-gym-claim error when the caller's session has no gym_id claim", async () => {
    claimsResult = { data: { claims: {} }, error: null };
    const { addCustomExercise } = await import("./exercises");

    const result = await addCustomExercise({ name: "Kettlebell Swing" });

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("not_found");
    expect(insertCalls).toEqual([]);
  });
});
