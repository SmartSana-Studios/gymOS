/**
 * Story 18.5: the two schemas the fee-gym flow adds to @gymos/types, and that
 * createMemberSchema (the fee-0 contract) was not loosened. Lives here because
 * packages/types has no test runner (see errors.registrationFee.test.ts).
 */
import { describe, expect, it } from "vitest";
import { assignInitialPlanSchema, createFeeGymMemberSchema, createMemberSchema } from "@gymos/types";

const identity = { name: "Alice Mballa", phone: "+237680811041", joinDate: "2026-01-15" };
const MEMBER_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

describe("createFeeGymMemberSchema", () => {
  it("accepts identity fields and a join date, with no plan fields", () => {
    expect(createFeeGymMemberSchema.safeParse(identity).success).toBe(true);
  });

  it("applies the same identity validation as the fee-0 schema", () => {
    expect(createFeeGymMemberSchema.safeParse({ ...identity, phone: "680811041" }).success).toBe(false);
    expect(createFeeGymMemberSchema.safeParse({ ...identity, name: "A" }).success).toBe(false);
    expect(createFeeGymMemberSchema.safeParse({ ...identity, joinDate: "2999-01-01" }).success).toBe(false);
  });

  it("strips plan fields rather than carrying them", () => {
    const parsed = createFeeGymMemberSchema.parse({ ...identity, planId: "p", subscriptionStatus: "active" });
    expect(parsed).not.toHaveProperty("planId");
    expect(parsed).not.toHaveProperty("subscriptionStatus");
  });
});

describe("createMemberSchema (fee 0) is unchanged", () => {
  it("still requires a plan and a subscription status", () => {
    expect(createMemberSchema.safeParse(identity).success).toBe(false);
    expect(createMemberSchema.safeParse({ ...identity, planId: "p", subscriptionStatus: "active" }).success).toBe(true);
  });
});

describe("assignInitialPlanSchema", () => {
  const valid = { memberId: MEMBER_ID, planId: "plan-1", startDate: "2026-01-15" };

  it("accepts a member id, a plan id and an ISO start date", () => {
    expect(assignInitialPlanSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts a hand-seeded non-RFC-4122 plan id (planId is z.string().min(1))", () => {
    expect(assignInitialPlanSchema.safeParse({ ...valid, planId: "dddddddd-0000-0000-0000-000000000004" }).success).toBe(true);
  });

  it("rejects an empty plan id, a bad start date and a bad member id", () => {
    expect(assignInitialPlanSchema.safeParse({ ...valid, planId: "" }).success).toBe(false);
    expect(assignInitialPlanSchema.safeParse({ ...valid, startDate: "15-01-2026" }).success).toBe(false);
    expect(assignInitialPlanSchema.safeParse({ ...valid, memberId: "nope" }).success).toBe(false);
  });

  it("takes no expiry date: the server computes it", () => {
    expect(assignInitialPlanSchema.parse({ ...valid, expiryDate: "2026-02-14" })).not.toHaveProperty("expiryDate");
  });
});
