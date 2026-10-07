/**
 * Story 18.5: `assignInitialPlan(memberId, planId, startDate)` inserts the
 * first subscription of a settled member who has none. Collaborators are mocked
 * at the service boundary; the 0098 gate itself (an awaiting member's insert is
 * refused) is pgTAP territory, so the awaiting row here drives
 * `insertSubscription` to return the error the gate's raise maps to.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getMemberSubscriptionState = vi.fn();
const getPlanTypeForGym = vi.fn();
const insertSubscription = vi.fn();
const logMemberChange = vi.fn();
const memberCountForGym = vi.fn();
const provisionMemberRow = vi.fn();

vi.mock("@/services/members", () => ({
  getMemberForInvite: vi.fn(),
  deactivateMember: vi.fn(),
  exportMembersCsv: vi.fn(),
  updateMember: vi.fn(),
  getMemberSubscriptionState: (...args: unknown[]) => getMemberSubscriptionState(...args),
  getPlanTypeForGym: (...args: unknown[]) => getPlanTypeForGym(...args),
  insertSubscription: (...args: unknown[]) => insertSubscription(...args),
  logMemberChange: (...args: unknown[]) => logMemberChange(...args),
  memberCountForGym: (...args: unknown[]) => memberCountForGym(...args),
  provisionMemberRow: (...args: unknown[]) => provisionMemberRow(...args),
}));

vi.mock("@/services/gym-settings", () => ({ getGymSettings: vi.fn() }));
vi.mock("@/services/coaches", () => ({ assignCoach: vi.fn(), getCoachAssignments: vi.fn() }));
vi.mock("@/services/csvImport", () => ({
  confirmCsvImport: vi.fn(),
  mapCsvRows: vi.fn(),
  validateCsvImport: vi.fn(),
}));
vi.mock("@/services/session", () => ({ getDashboardShellContext: vi.fn() }));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}(${JSON.stringify(vars)})` : key),
  })),
}));
vi.mock("@/lib/messaging/EvolutionApiMessageProvider", () => ({ sendEvolutionApiMessage: vi.fn() }));

const MEMBER_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const PLAN_ID = "plan-1";
const GYM_ID = "gym-1";

describe("assignInitialPlan (Story 18.5)", () => {
  beforeEach(() => {
    getMemberSubscriptionState.mockReset();
    getPlanTypeForGym.mockReset();
    insertSubscription.mockReset();
    logMemberChange.mockReset();
    memberCountForGym.mockReset();
    provisionMemberRow.mockReset();

    getMemberSubscriptionState.mockResolvedValue({ data: { gymId: GYM_ID, hasSubscription: false }, error: null });
    getPlanTypeForGym.mockResolvedValue({ data: { planType: "recurring", durationDays: 30 }, error: null });
    insertSubscription.mockResolvedValue({ data: { id: "sub-1" }, error: null });
    logMemberChange.mockResolvedValue({ error: null });
  });

  it("inserts an active subscription with the expiry computed from the plan's duration_days, and audits it", async () => {
    const { assignInitialPlan } = await import("./actions");

    const result = await assignInitialPlan(MEMBER_ID, PLAN_ID, "2026-01-15");

    expect(result).toEqual({ data: { id: "sub-1" }, error: null });
    expect(insertSubscription).toHaveBeenCalledWith(GYM_ID, MEMBER_ID, {
      planId: PLAN_ID,
      status: "active",
      startDate: "2026-01-15",
      expiryDate: "2026-02-14",
    });
    expect(logMemberChange).toHaveBeenCalledWith("member_plan_assigned", MEMBER_ID, {
      plan_id: PLAN_ID,
      start_date: "2026-01-15",
      expiry_date: "2026-02-14",
    });
  });

  it("rolls the date across a month and year boundary in UTC", async () => {
    getPlanTypeForGym.mockResolvedValue({ data: { planType: "recurring", durationDays: 365 }, error: null });
    const { assignInitialPlan } = await import("./actions");

    await assignInitialPlan(MEMBER_ID, PLAN_ID, "2027-12-31");

    expect(insertSubscription.mock.calls[0][2]).toMatchObject({ expiryDate: "2028-12-30" });
  });

  it("gives a pay_per_session plan no expiry date", async () => {
    getPlanTypeForGym.mockResolvedValue({ data: { planType: "pay_per_session", durationDays: null }, error: null });
    const { assignInitialPlan } = await import("./actions");

    await assignInitialPlan(MEMBER_ID, PLAN_ID, "2026-01-15");

    expect(insertSubscription.mock.calls[0][2]).toMatchObject({ expiryDate: null });
    expect(logMemberChange).toHaveBeenCalledWith(
      "member_plan_assigned",
      MEMBER_ID,
      expect.objectContaining({ expiry_date: null }),
    );
  });

  it("writes no payment and does no cap check", async () => {
    const { assignInitialPlan } = await import("./actions");

    await assignInitialPlan(MEMBER_ID, PLAN_ID, "2026-01-15");

    expect(memberCountForGym).not.toHaveBeenCalled();
    expect(insertSubscription).toHaveBeenCalledTimes(1);
  });

  it("an awaiting member is refused by the gate: registration_fee_due, no audit row", async () => {
    insertSubscription.mockResolvedValue({
      data: null,
      error: { code: "registration_fee_due", message: "fee due" },
    });
    const { assignInitialPlan } = await import("./actions");

    const result = await assignInitialPlan(MEMBER_ID, PLAN_ID, "2026-01-15");

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("registration_fee_due");
    expect(logMemberChange).not.toHaveBeenCalled();
  });

  it("a member that already has a subscription returns member_already_has_subscription and inserts nothing", async () => {
    getMemberSubscriptionState.mockResolvedValue({ data: { gymId: GYM_ID, hasSubscription: true }, error: null });
    const { assignInitialPlan } = await import("./actions");

    const result = await assignInitialPlan(MEMBER_ID, PLAN_ID, "2026-01-15");

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("member_already_has_subscription");
    expect(insertSubscription).not.toHaveBeenCalled();
    expect(logMemberChange).not.toHaveBeenCalled();
  });

  it("a plan from another gym (or missing) returns not_found and inserts nothing", async () => {
    getPlanTypeForGym.mockResolvedValue({
      data: null,
      error: { code: "plan_not_found", message: "plans.errors.planNotFound" },
    });
    const { assignInitialPlan } = await import("./actions");

    const result = await assignInitialPlan(MEMBER_ID, "plan-other-gym", "2026-01-15");

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("not_found");
    expect(insertSubscription).not.toHaveBeenCalled();
  });

  it("an unknown or cross-gym member returns the lookup's not_found and inserts nothing", async () => {
    getMemberSubscriptionState.mockResolvedValue({ data: null, error: { code: "not_found", message: "nope" } });
    const { assignInitialPlan } = await import("./actions");

    const result = await assignInitialPlan(MEMBER_ID, PLAN_ID, "2026-01-15");

    expect(result.error?.code).toBe("not_found");
    expect(insertSubscription).not.toHaveBeenCalled();
  });

  it("a receptionist's insert is denied by RLS and the denial is returned, with no audit row", async () => {
    insertSubscription.mockResolvedValue({ data: null, error: { code: "unknown", message: "denied" } });
    const { assignInitialPlan } = await import("./actions");

    const result = await assignInitialPlan(MEMBER_ID, PLAN_ID, "2026-01-15");

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("unknown");
    expect(logMemberChange).not.toHaveBeenCalled();
  });

  it.each([
    ["a malformed member id", "not-a-uuid", PLAN_ID, "2026-01-15"],
    ["an empty plan id", MEMBER_ID, "", "2026-01-15"],
    ["a malformed start date", MEMBER_ID, PLAN_ID, "15/01/2026"],
  ])("rejects %s with validation_error before touching the database", async (_label, memberId, planId, startDate) => {
    const { assignInitialPlan } = await import("./actions");

    const result = await assignInitialPlan(memberId, planId, startDate);

    expect(result.error?.code).toBe("validation_error");
    expect(getMemberSubscriptionState).not.toHaveBeenCalled();
    expect(insertSubscription).not.toHaveBeenCalled();
  });

  it("reports audit_log_failed as a partial success carrying the new subscription id", async () => {
    logMemberChange.mockResolvedValue({ error: { code: "unknown", message: "x" } });
    const { assignInitialPlan } = await import("./actions");

    const result = await assignInitialPlan(MEMBER_ID, PLAN_ID, "2026-01-15");

    expect(result.data).toEqual({ id: "sub-1" });
    expect(result.error?.code).toBe("audit_log_failed");
  });
});
