/**
 * Story 18.5: `createMember` is fee-aware. The fee is read server-side
 * (`getGymSettings().registrationFee`), never from a client flag.
 *
 * - Fee 0: the one-step flow, its fields, the subscription insert and the
 *   `member_created` audit metadata are unchanged.
 * - Fee above 0: the member is created awaiting (no plan, no subscription);
 *   an input that still carries planId / subscriptionStatus / expiryDate is
 *   rejected with registration_fee_due before anything is created.
 *
 * Collaborators are mocked at the service boundary, so this exercises the
 * action's orchestration only. The database side is covered by pgTAP
 * (registration_fee_foundation*.test.sql).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getGymSettings = vi.fn();
const memberCountForGym = vi.fn();
const getPlanTypeForGym = vi.fn();
const provisionMemberRow = vi.fn();
const logMemberChange = vi.fn();

vi.mock("@/services/members", () => ({
  getMemberForInvite: vi.fn(),
  getMemberSubscriptionState: vi.fn(),
  insertSubscription: vi.fn(),
  deactivateMember: vi.fn(),
  exportMembersCsv: vi.fn(),
  updateMember: vi.fn(),
  getPlanTypeForGym: (...args: unknown[]) => getPlanTypeForGym(...args),
  logMemberChange: (...args: unknown[]) => logMemberChange(...args),
  memberCountForGym: (...args: unknown[]) => memberCountForGym(...args),
  provisionMemberRow: (...args: unknown[]) => provisionMemberRow(...args),
}));

vi.mock("@/services/gym-settings", () => ({
  getGymSettings: (...args: unknown[]) => getGymSettings(...args),
}));

vi.mock("@/services/coaches", () => ({
  assignCoach: vi.fn(),
  getCoachAssignments: vi.fn(),
}));

vi.mock("@/services/csvImport", () => ({
  confirmCsvImport: vi.fn(),
  mapCsvRows: vi.fn(),
  validateCsvImport: vi.fn(),
}));

vi.mock("@/services/session", () => ({
  getDashboardShellContext: vi.fn(),
}));

vi.mock("@/lib/i18n/get-request-locale", () => ({
  getRequestLocale: vi.fn(async () => "en"),
}));

vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}(${JSON.stringify(vars)})` : key),
  })),
}));

vi.mock("@/lib/messaging/EvolutionApiMessageProvider", () => ({
  sendEvolutionApiMessage: vi.fn(),
}));

const PLAN_ID = "plan-1";

const identity = {
  name: "Alice Mballa",
  phone: "+237680811041",
  email: null,
  dob: null,
  photoUrl: null,
  emergencyContact: null,
  joinDate: "2026-01-15",
};

const feeZeroInput = {
  ...identity,
  planId: PLAN_ID,
  subscriptionStatus: "active",
  expiryDate: "2099-02-14",
};

function setFee(fee: number) {
  getGymSettings.mockResolvedValue({ data: { registrationFee: fee }, error: null });
}

describe("createMember (Story 18.5)", () => {
  beforeEach(() => {
    getGymSettings.mockReset();
    memberCountForGym.mockReset();
    getPlanTypeForGym.mockReset();
    provisionMemberRow.mockReset();
    logMemberChange.mockReset();

    memberCountForGym.mockResolvedValue({ count: 3, cap: 30, error: null });
    getPlanTypeForGym.mockResolvedValue({ data: { planType: "recurring", durationDays: 30 }, error: null });
    provisionMemberRow.mockResolvedValue({
      data: { id: "member-1", userId: "user-1", authUserCreated: true },
      error: null,
    });
    logMemberChange.mockResolvedValue({ error: null });
    setFee(0);
  });

  describe("fee 0 (unchanged one-step flow)", () => {
    it("creates the member with its plan and subscription fields, and the original audit metadata", async () => {
      const { createMember } = await import("./actions");

      const result = await createMember(feeZeroInput);

      expect(result).toEqual({ data: { id: "member-1" }, error: null });
      expect(provisionMemberRow).toHaveBeenCalledWith({
        name: "Alice Mballa",
        phone: "+237680811041",
        email: null,
        dob: null,
        photoUrl: null,
        emergencyContact: null,
        joinDate: "2026-01-15",
        planId: PLAN_ID,
        subscriptionStatus: "active",
        expiryDate: "2099-02-14",
      });
      expect(logMemberChange).toHaveBeenCalledWith("member_created", "member-1", {
        name: "Alice Mballa",
        phone: "+237680811041",
        plan_id: PLAN_ID,
        join_date: "2026-01-15",
      });
    });

    it("still requires a plan (createMemberSchema is not loosened)", async () => {
      const { createMember } = await import("./actions");

      const result = await createMember(identity);

      expect(result.data).toBeNull();
      expect(result.error?.code).toBe("validation_error");
      expect(provisionMemberRow).not.toHaveBeenCalled();
    });

    it("surfaces the gate's registration_fee_due when the fee was switched on between the read and the insert", async () => {
      provisionMemberRow.mockResolvedValue({
        data: null,
        error: { code: "registration_fee_due", message: "fee due" },
      });
      const { createMember } = await import("./actions");

      const result = await createMember(feeZeroInput);

      expect(result.data).toBeNull();
      expect(result.error?.code).toBe("registration_fee_due");
      expect(logMemberChange).not.toHaveBeenCalled();
    });
  });

  describe("fee above 0 (awaiting member)", () => {
    beforeEach(() => setFee(5000));

    it("creates the member from identity fields only: no plan lookup, no subscription fields", async () => {
      const { createMember } = await import("./actions");

      const result = await createMember(identity);

      expect(result).toEqual({ data: { id: "member-1" }, error: null });
      expect(getPlanTypeForGym).not.toHaveBeenCalled();
      expect(provisionMemberRow).toHaveBeenCalledTimes(1);
      const call = provisionMemberRow.mock.calls[0][0] as Record<string, unknown>;
      expect(call).toEqual({
        name: "Alice Mballa",
        phone: "+237680811041",
        email: null,
        dob: null,
        photoUrl: null,
        emergencyContact: null,
        joinDate: "2026-01-15",
      });
      expect(call).not.toHaveProperty("planId");
      expect(call).not.toHaveProperty("importExempt");
    });

    it("writes the awaiting member_created audit metadata", async () => {
      const { createMember } = await import("./actions");

      await createMember(identity);

      expect(logMemberChange).toHaveBeenCalledWith("member_created", "member-1", {
        name: "Alice Mballa",
        phone: "+237680811041",
        join_date: "2026-01-15",
        awaiting_registration_fee: true,
      });
    });

    it.each([
      ["planId", { planId: PLAN_ID }],
      ["subscriptionStatus", { subscriptionStatus: "active" }],
      ["expiryDate", { expiryDate: "2099-02-14" }],
      ["all three", { planId: PLAN_ID, subscriptionStatus: "active", expiryDate: "2099-02-14" }],
    ])("rejects an input carrying %s with registration_fee_due, creating nothing", async (_label, extra) => {
      const { createMember } = await import("./actions");

      const result = await createMember({ ...identity, ...extra });

      expect(result.data).toBeNull();
      expect(result.error?.code).toBe("registration_fee_due");
      expect(result.error?.message).toBe("The registration fee has not been collected for this member yet.");
      expect(memberCountForGym).not.toHaveBeenCalled();
      expect(provisionMemberRow).not.toHaveBeenCalled();
      expect(logMemberChange).not.toHaveBeenCalled();
    });

    it("never trusts a client-supplied fee flag: the read happens server-side", async () => {
      const { createMember } = await import("./actions");

      // A client claiming fee 0 by sending a one-step payload still hits the fee gym path.
      const result = await createMember({ ...feeZeroInput, registrationFee: 0 });

      expect(getGymSettings).toHaveBeenCalled();
      expect(result.error?.code).toBe("registration_fee_due");
      expect(provisionMemberRow).not.toHaveBeenCalled();
    });

    it("counts the awaiting member toward the cap (cap check runs, and a full gym is refused)", async () => {
      memberCountForGym.mockResolvedValue({ count: 30, cap: 30, error: null });
      const { createMember } = await import("./actions");

      const result = await createMember(identity);

      expect(memberCountForGym).toHaveBeenCalled();
      expect(result.error?.code).toBe("member_cap_reached");
      expect(provisionMemberRow).not.toHaveBeenCalled();
    });

    it("validates the identity fields", async () => {
      const { createMember } = await import("./actions");

      const result = await createMember({ ...identity, phone: "not-a-phone" });

      expect(result.error?.code).toBe("validation_error");
      expect(provisionMemberRow).not.toHaveBeenCalled();
    });

    it("reports audit_log_failed as a partial success carrying the new id", async () => {
      logMemberChange.mockResolvedValue({ error: { code: "unknown", message: "x" } });
      const { createMember } = await import("./actions");

      const result = await createMember(identity);

      expect(result.data).toEqual({ id: "member-1" });
      expect(result.error?.code).toBe("audit_log_failed");
    });
  });

  it("fails closed when the fee cannot be read: nothing is created", async () => {
    getGymSettings.mockResolvedValue({ data: null, error: { code: "not_found", message: "gym" } });
    const { createMember } = await import("./actions");

    const result = await createMember(feeZeroInput);

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("not_found");
    expect(provisionMemberRow).not.toHaveBeenCalled();
  });
});
