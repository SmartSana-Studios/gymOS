/**
 * Story 13.2 (Task 3, AC #1, #3, #4): unit tests for `createWorkoutPlan`.
 * Exercises the Zod pre-check (rejecting an empty exercises array before
 * ever calling `.rpc()`) and the RLS/assignment-denied RPC-rejection path
 * without hitting a real database -- matches
 * exercises.addCustomExercise.test.ts's chainable-stub shape for
 * `@/lib/supabase/server`'s `createClient()`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let rpcResult: { data: string | null; error: unknown };
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
  name: "Strength Basics",
  exercises: [{ exerciseId: "ex-1", sets: 3, reps: 10, note: null }],
};

describe("createWorkoutPlan", () => {
  beforeEach(() => {
    rpcResult = { data: "plan-1", error: null };
    rpcCalls = [];
  });

  it("calls create_workout_plan with the mapped exercise rows and returns the new id", async () => {
    const { createWorkoutPlan } = await import("./workoutPlans");

    const result = await createWorkoutPlan("member-1", validInput);

    expect(rpcCalls).toEqual([
      {
        fn: "create_workout_plan",
        args: {
          p_member_id: "member-1",
          p_name: "Strength Basics",
          p_exercises: [{ exercise_id: "ex-1", sets: 3, reps: 10, note: null }],
        },
      },
    ]);
    expect(result).toEqual({ data: { id: "plan-1" }, error: null });
  });

  it("returns { data: null, error } without throwing when the RPC rejects (RLS/assignment denied)", async () => {
    rpcResult = { data: null, error: { message: "create_workout_plan: member is not currently assigned to caller" } };
    const { createWorkoutPlan } = await import("./workoutPlans");

    const result = await createWorkoutPlan("member-1", validInput);

    expect(result.data).toBeNull();
    expect(result.error).toEqual({ code: "unknown", message: "mapped error" });
  });

  it("rejects an empty exercises array before ever calling .rpc()", async () => {
    const { createWorkoutPlan } = await import("./workoutPlans");

    const result = await createWorkoutPlan("member-1", { name: "Strength Basics", exercises: [] });

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("validation_error");
    expect(rpcCalls).toEqual([]);
  });
});
