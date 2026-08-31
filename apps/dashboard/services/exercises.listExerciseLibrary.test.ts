/**
 * Story 13.1 (Task 3, AC #1, #2) code-review patch: unit tests for
 * `listExerciseLibrary`, added alongside the already-covered
 * `addCustomExercise` (exercises.addCustomExercise.test.ts) for parity.
 * Exercises the "no gym_id claim" branch and the query-error branch without
 * hitting a real database -- matches getMemberForInvite.test.ts's
 * chainable-stub shape for `@/lib/supabase/server`'s `createClient()`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let claimsResult: { data: { claims: Record<string, unknown> | null } | null; error: unknown };
let selectResult: { data: Array<{ id: string; name: string }> | null; error: unknown };

function makeSupabaseStub() {
  return {
    auth: {
      getClaims: vi.fn(async () => claimsResult),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        order: vi.fn(async () => selectResult),
      })),
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

describe("listExerciseLibrary", () => {
  beforeEach(() => {
    claimsResult = { data: { claims: { gym_id: "gym-1" } }, error: null };
    selectResult = {
      data: [
        { id: "exercise-1", name: "Bench Press" },
        { id: "exercise-2", name: "Squat" },
      ],
      error: null,
    };
  });

  it("returns the caller's visible rows (platform defaults + own gym's custom entries)", async () => {
    const { listExerciseLibrary } = await import("./exercises");

    const result = await listExerciseLibrary();

    expect(result).toEqual({
      data: [
        { id: "exercise-1", name: "Bench Press" },
        { id: "exercise-2", name: "Squat" },
      ],
      error: null,
    });
  });

  it("returns the no-gym-claim error when the caller's session has no gym_id claim", async () => {
    claimsResult = { data: { claims: {} }, error: null };
    const { listExerciseLibrary } = await import("./exercises");

    const result = await listExerciseLibrary();

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("not_found");
  });

  it("returns { data: null, error } without throwing when the query fails", async () => {
    selectResult = { data: null, error: { message: "connection reset" } };
    const { listExerciseLibrary } = await import("./exercises");

    const result = await listExerciseLibrary();

    expect(result.data).toBeNull();
    expect(result.error).toEqual({ code: "unknown", message: "mapped error" });
  });
});
