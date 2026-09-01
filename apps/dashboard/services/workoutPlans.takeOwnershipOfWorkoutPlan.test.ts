/**
 * Story 13.4 (Task 2, AC #2): unit tests for `takeOwnershipOfWorkoutPlan`.
 * Same thin `.rpc()`-wrapper shape as `updateWorkoutPlan` --
 * `workoutPlans.updateWorkoutPlan.test.ts`'s own chainable-stub shape for
 * `@/lib/supabase/server`'s `createClient()`, reused verbatim.
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

describe("takeOwnershipOfWorkoutPlan", () => {
  beforeEach(() => {
    rpcResult = { data: null, error: null };
    rpcCalls = [];
  });

  it("calls take_ownership_of_workout_plan with the given planId", async () => {
    const { takeOwnershipOfWorkoutPlan } = await import("./workoutPlans");

    const result = await takeOwnershipOfWorkoutPlan("plan-1");

    expect(rpcCalls).toEqual([{ fn: "take_ownership_of_workout_plan", args: { p_plan_id: "plan-1" } }]);
    expect(result).toEqual({ error: null });
  });

  it("returns { error } without throwing when the caller is not currently assigned to the plan's member", async () => {
    rpcResult = {
      data: null,
      error: { message: "take_ownership_of_workout_plan: member is not currently assigned to caller" },
    };
    const { takeOwnershipOfWorkoutPlan } = await import("./workoutPlans");

    const result = await takeOwnershipOfWorkoutPlan("plan-1");

    expect(result.error).toEqual({ code: "unknown", message: "mapped error" });
  });
});
