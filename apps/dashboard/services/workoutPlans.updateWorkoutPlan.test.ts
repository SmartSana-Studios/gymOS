/**
 * Story 13.2 (Task 3, AC #2, #4): unit tests for `updateWorkoutPlan`.
 * Exercises the success path and the not-the-authoring-coach RPC-rejection
 * path (FR-111 scaffolding, `update_workout_plan`'s ownership check) without
 * hitting a real database -- matches
 * exercises.addCustomExercise.test.ts's chainable-stub shape for
 * `@/lib/supabase/server`'s `createClient()`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let rpcResult: { data: null; error: unknown };
let rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;

function makeSupabaseStub() {
  return {
    rpc: vi.fn((fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return rpcResult;
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

const validInput = {
  name: "Strength Basics v2",
  exercises: [{ exerciseId: "ex-1", sets: 4, reps: 8, note: "Go slow" }],
};

describe("updateWorkoutPlan", () => {
  beforeEach(() => {
    rpcResult = { data: null, error: null };
    rpcCalls = [];
  });

  it("calls update_workout_plan with the mapped exercise rows", async () => {
    const { updateWorkoutPlan } = await import("./workoutPlans");

    const result = await updateWorkoutPlan("plan-1", validInput);

    expect(rpcCalls).toEqual([
      {
        fn: "update_workout_plan",
        args: {
          p_plan_id: "plan-1",
          p_name: "Strength Basics v2",
          p_exercises: [{ exercise_id: "ex-1", sets: 4, reps: 8, note: "Go slow" }],
        },
      },
    ]);
    expect(result).toEqual({ error: null });
  });

  it("returns { error } without throwing when the caller is not the authoring coach", async () => {
    rpcResult = { data: null, error: { message: "update_workout_plan: caller is not the authoring coach for this plan" } };
    const { updateWorkoutPlan } = await import("./workoutPlans");

    const result = await updateWorkoutPlan("plan-1", validInput);

    expect(result.error).toEqual({ code: "unknown", message: "mapped error" });
  });

  it("rejects an empty exercises array before ever calling .rpc()", async () => {
    const { updateWorkoutPlan } = await import("./workoutPlans");

    const result = await updateWorkoutPlan("plan-1", { name: "Strength Basics v2", exercises: [] });

    expect(result.error?.code).toBe("validation_error");
    expect(rpcCalls).toEqual([]);
  });
});
