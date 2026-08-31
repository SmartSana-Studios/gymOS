/**
 * Story 13.2 (Task 3, AC #1, #2, #4) + Story 13.3 (Task 3, AC #3): unit
 * tests for `getWorkoutPlan`. Exercises the found/no-plan-yet/query-error
 * branches without hitting a real database -- matches
 * exercises.listExerciseLibrary.test.ts's chainable-stub shape for
 * `@/lib/supabase/server`'s `createClient()`.
 *
 * Story 13.3 adds a second `.from("workout_plan_completions")` query --
 * the stub below dispatches on the table name so both query shapes can be
 * independently configured per test.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let claimsResult: { data: { claims: Record<string, unknown> | null } | null; error: unknown };
let maybeSingleResult: { data: Record<string, unknown> | null; error: unknown };
let completionsResult: { data: Array<{ exercise_id: string; completed_at: string }> | null; error: unknown };
let orderCalls: Array<{ column: string; options: Record<string, unknown> }>;

function makeSupabaseStub() {
  return {
    auth: {
      getClaims: vi.fn(async () => claimsResult),
    },
    from: vi.fn((table: string) => {
      if (table === "workout_plan_completions") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn((column: string, options: Record<string, unknown>) => {
                  orderCalls.push({ column, options });
                  return {
                    limit: vi.fn(() => Promise.resolve(completionsResult)),
                  };
                }),
              })),
            })),
          })),
        };
      }
      return {
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
      };
    }),
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
    completionsResult = { data: [], error: null };
    orderCalls = [];
  });

  it("maps a found plan and its ordered exercises with zero completions", async () => {
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
            completionCount: 0,
            lastCompletedAt: null,
          },
        ],
      },
      error: null,
    });
    expect(orderCalls).toEqual([
      { column: "order_index", options: { referencedTable: "workout_plan_exercises", ascending: true } },
      { column: "completed_at", options: { ascending: false } },
    ]);
  });

  it("groups multiple completions for one exercise_id and leaves an uncompleted exercise at zero", async () => {
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
          {
            id: "wpe-2",
            exercise_id: "ex-2",
            order_index: 1,
            sets: 3,
            reps: 8,
            note: null,
            exercise_library: { name: "Bench Press" },
          },
        ],
      },
      error: null,
    };
    // Newest-first, matching the real query's own .order("completed_at", { ascending: false }).
    completionsResult = {
      data: [
        { exercise_id: "ex-1", completed_at: "2026-08-30T10:00:00.000Z" },
        { exercise_id: "ex-1", completed_at: "2026-08-25T10:00:00.000Z" },
      ],
      error: null,
    };
    const { getWorkoutPlan } = await import("./workoutPlans");

    const result = await getWorkoutPlan("member-1");

    expect(result.data?.exercises[0]).toMatchObject({
      exerciseId: "ex-1",
      completionCount: 2,
      lastCompletedAt: "2026-08-30T10:00:00.000Z",
    });
    expect(result.data?.exercises[1]).toMatchObject({
      exerciseId: "ex-2",
      completionCount: 0,
      lastCompletedAt: null,
    });
  });

  it("degrades to zero completions on every row when the completions query fails, without failing the whole plan fetch", async () => {
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
    completionsResult = { data: null, error: { message: "connection reset" } };
    const { getWorkoutPlan } = await import("./workoutPlans");

    const result = await getWorkoutPlan("member-1");

    expect(result.error).toBeNull();
    expect(result.data?.exercises[0]).toMatchObject({ completionCount: 0, lastCompletedAt: null });
  });

  it("returns { data: null, error: null } when the member has no plan yet (not an error), skipping the completions query entirely", async () => {
    maybeSingleResult = { data: null, error: null };
    const { getWorkoutPlan } = await import("./workoutPlans");

    const result = await getWorkoutPlan("member-1");

    expect(result).toEqual({ data: null, error: null });
    expect(orderCalls).toEqual([
      { column: "order_index", options: { referencedTable: "workout_plan_exercises", ascending: true } },
    ]);
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
