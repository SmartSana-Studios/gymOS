/**
 * Story 27.4: the Correct plan Server Actions. The opening check validates its input and reads through the service; the correction
 * validates (a reason outside 5 to 300 characters is the coded invalid_reason, not a thrown error), issues a single-use grant bound to
 * (support_correct_plan, member) for a live GymOS Support session before the write, and leaves staff roles unchanged. The code never
 * travels into the service.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const correctSubscriptionPlan = vi.fn();
const getCorrectPlanEligibility = vi.fn();
const isLiveSupportSession = vi.fn();
const issueSupportStepUp = vi.fn();

vi.mock("@/services/members.correctPlan", () => ({
  correctSubscriptionPlan: (...a: unknown[]) => correctSubscriptionPlan(...a),
  getCorrectPlanEligibility: (...a: unknown[]) => getCorrectPlanEligibility(...a),
}));
vi.mock("@/services/support-stepup", async (importActual) => ({
  ...(await importActual<typeof import("@/services/support-stepup")>()),
  isLiveSupportSession: () => isLiveSupportSession(),
  issueSupportStepUp: (...a: unknown[]) => issueSupportStepUp(...a),
}));
vi.mock("@/services/members", () => ({}));
vi.mock("@/services/gym-settings", () => ({ getGymSettings: vi.fn() }));
vi.mock("@/services/loyalty", () => ({ getMemberLoyalty: vi.fn() }));
vi.mock("@/services/coaches", () => ({ assignCoach: vi.fn(), getCoachAssignments: vi.fn() }));
vi.mock("@/services/csvImport", () => ({ confirmCsvImport: vi.fn(), mapCsvRows: vi.fn(), validateCsvImport: vi.fn() }));
vi.mock("@/services/session", () => ({ getDashboardShellContext: vi.fn() }));
vi.mock("@/lib/messaging/EvolutionApiMessageProvider", () => ({ sendEvolutionApiMessage: vi.fn() }));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })),
}));

const MEMBER_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const PLAN_ID = "4fa85f64-5717-4562-b3fc-2c963f66afa7";
const SUB_ID = "5fa85f64-5717-4562-b3fc-2c963f66afa8";
const INPUT = { memberId: MEMBER_ID, newPlanId: PLAN_ID, subscriptionId: SUB_ID, reason: "  Wrong plan chosen at sign-up  " };
const OK = { data: { subscriptionId: SUB_ID, planId: PLAN_ID, planName: "MONTHLY", planType: "monthly", expiryDate: "2026-12-02", status: "active" }, refusal: null, permissionDenied: false, error: null };

beforeEach(() => {
  vi.clearAllMocks();
  isLiveSupportSession.mockResolvedValue(false);
  issueSupportStepUp.mockResolvedValue("issued");
  correctSubscriptionPlan.mockResolvedValue(OK);
  getCorrectPlanEligibility.mockResolvedValue({ data: null, error: null });
});

describe("getCorrectPlanEligibilityAction", () => {
  it("reads the member's eligibility through the service", async () => {
    const { getCorrectPlanEligibilityAction } = await import("./actions");
    await getCorrectPlanEligibilityAction({ memberId: MEMBER_ID });
    expect(getCorrectPlanEligibility).toHaveBeenCalledWith(MEMBER_ID);
  });

  it("refuses a malformed member id before any read", async () => {
    const { getCorrectPlanEligibilityAction } = await import("./actions");
    const result = await getCorrectPlanEligibilityAction({ memberId: "nope" });
    expect(result.error?.code).toBe("validation_error");
    expect(getCorrectPlanEligibility).not.toHaveBeenCalled();
  });
});

describe("correctPlanAction", () => {
  it("passes the plan, the trimmed reason and the subscription the modal showed to the service (staff: no grant)", async () => {
    const { correctPlanAction } = await import("./actions");
    const result = await correctPlanAction(INPUT);
    expect(result.data?.planName).toBe("MONTHLY");
    expect(correctSubscriptionPlan).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      newPlanId: PLAN_ID,
      reason: "Wrong plan chosen at sign-up",
      subscriptionId: SUB_ID,
    });
    expect(issueSupportStepUp).not.toHaveBeenCalled();
  });

  it.each(["abcd", "x".repeat(301), "     "])("a reason of the wrong length (%#) is the coded invalid_reason, with no call", async (reason) => {
    const { correctPlanAction } = await import("./actions");
    const result = await correctPlanAction({ ...INPUT, reason });
    expect(result.refusal).toEqual({ code: "invalid_reason" });
    expect(correctSubscriptionPlan).not.toHaveBeenCalled();
  });

  it("a malformed plan id is a validation error", async () => {
    const { correctPlanAction } = await import("./actions");
    const result = await correctPlanAction({ ...INPUT, newPlanId: "nope" });
    expect(result.error?.code).toBe("validation_error");
    expect(correctSubscriptionPlan).not.toHaveBeenCalled();
  });

  it("a live support session gets a support_correct_plan grant bound to the member, before the write", async () => {
    isLiveSupportSession.mockResolvedValue(true);
    const { correctPlanAction } = await import("./actions");
    const result = await correctPlanAction({ ...INPUT, authCode: "123456" });
    expect(result.error).toBeNull();
    expect(issueSupportStepUp).toHaveBeenCalledWith({ action: "support_correct_plan", subjectId: MEMBER_ID, code: "123456" });
    expect(issueSupportStepUp.mock.invocationCallOrder[0]).toBeLessThan(correctSubscriptionPlan.mock.invocationCallOrder[0]);
    expect(JSON.stringify(correctSubscriptionPlan.mock.calls[0])).not.toContain("123456");
  });

  it.each([undefined, "", "abc123", "12345"])("a missing or malformed code (%s) is refused before any grant or write", async (authCode) => {
    isLiveSupportSession.mockResolvedValue(true);
    const { correctPlanAction } = await import("./actions");
    const result = await correctPlanAction({ ...INPUT, authCode });
    expect(result.error?.code).toBe("code_required");
    expect(issueSupportStepUp).not.toHaveBeenCalled();
    expect(correctSubscriptionPlan).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid_code", "invalid_code"],
    ["locked", "account_locked"],
    ["unavailable", "step_up_unavailable"],
  ])("a %s step-up is refused with %s and no write", async (outcome, code) => {
    isLiveSupportSession.mockResolvedValue(true);
    issueSupportStepUp.mockResolvedValue(outcome);
    const { correctPlanAction } = await import("./actions");
    const result = await correctPlanAction({ ...INPUT, authCode: "123456" });
    expect(result.error?.code).toBe(code);
    expect(correctSubscriptionPlan).not.toHaveBeenCalled();
  });
});
