/**
 * Story 13.2 (Task 3, AC #1, #2, #4): unit tests for `getWorkoutPlan`.
 * Exercises the found/no-plan-yet/query-error branches without hitting a
 * real database -- matches exercises.listExerciseLibrary.test.ts's
 * chainable-stub shape for `@/lib/supabase/server`'s `createClient()`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let claimsResult: { data: { claims: Record<string, unknown> | null } | null; error: unknown };
let maybeSingleResult: { data: Record<string, unknown> | null; error: unknown };
let orderCalls: Array<{ column: string; options: Record<string, unknown> }>;

function makeSupabaseStub() {
  return {
    auth: {
      getClaims: vi.fn(async () => claimsResult),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn((column: string, options: Record<string, unknown>) => {
              orderCalls.push({ column, options });
              return {
                maybeSingle: vi.fn(async () => maybeSingleResult),
              };
            }),
          })),
        })),
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

describe("getWorkoutPlan", () => {
  beforeEach(() => {
    claimsResult = { data: { claims: { gym_id: "gym-1" } }, error: null };
    maybeSingleResult = { data: null, error: null };
    orderCalls = [];
  });

  it("maps a found plan and its ordered exercises", async () => {
    maybeSingleResult = {
      data: {
        id: "plan-1",
        name: "Strength Basics",
        coach_id: "coach-1",
        workout_plan_exercises: [
          {
            id: "wpe-1",
            exercise_id: "ex-1",
            order_index: 0,
            sets: 3,
            reps: 10,
            note: null,
            exercise_library: { name: "Squat" },
          },
        ],
      },
      error: null,
    };
    const { getWorkoutPlan } = await import("./workoutPlans");

    const result = await getWorkoutPlan("member-1");

    expect(result).toEqual({
      data: {
        id: "plan-1",
        name: "Strength Basics",
        coachId: "coach-1",
        exercises: [
          {
            id: "wpe-1",
            exerciseId: "ex-1",
            exerciseName: "Squat",
            sets: 3,
            reps: 10,
            note: null,
            orderIndex: 0,
          },
        ],
      },
      error: null,
    });
    expect(orderCalls).toEqual([
      { column: "order_index", options: { referencedTable: "workout_plan_exercises", ascending: true } },
    ]);
  });

  it("returns { data: null, error: null } when the member has no plan yet (not an error)", async () => {
    maybeSingleResult = { data: null, error: null };
    const { getWorkoutPlan } = await import("./workoutPlans");

    const result = await getWorkoutPlan("member-1");

    expect(result).toEqual({ data: null, error: null });
  });

  it("returns { data: null, error } without throwing when the query fails", async () => {
    maybeSingleResult = { data: null, error: { message: "connection reset" } };
    const { getWorkoutPlan } = await import("./workoutPlans");

    const result = await getWorkoutPlan("member-1");

    expect(result.data).toBeNull();
    expect(result.error).toEqual({ code: "unknown", message: "mapped error" });
  });

  it("returns the no-gym-claim error when the caller's session has no gym_id claim", async () => {
    claimsResult = { data: { claims: {} }, error: null };
    const { getWorkoutPlan } = await import("./workoutPlans");

    const result = await getWorkoutPlan("member-1");

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("not_found");
  });
});
