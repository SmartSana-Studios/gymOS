/**
 * Story 18.5: `confirmCsvImport` and the registration-fee import exemption.
 *
 * A fee gym's CSV import is an existing roster, not new sign-ups: every row is
 * settled (`importExempt`) between the member insert and the subscription
 * insert, with no payment, and each audit entry carries
 * `registration_fee_exempt: true`. A fee-0 gym passes nothing and writes the
 * audit metadata it always did. A mid-file failure rolls every earlier row back.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const memberCountForGym = vi.fn();
const provisionMemberRow = vi.fn();
const logMemberChange = vi.fn();
const deleteMemberForCleanup = vi.fn();
const deleteAuthUserForCleanup = vi.fn();
const getGymSettings = vi.fn();

vi.mock("@/services/members", () => ({
  memberCountForGym: (...args: unknown[]) => memberCountForGym(...args),
  provisionMemberRow: (...args: unknown[]) => provisionMemberRow(...args),
  logMemberChange: (...args: unknown[]) => logMemberChange(...args),
  deleteMemberForCleanup: (...args: unknown[]) => deleteMemberForCleanup(...args),
  deleteAuthUserForCleanup: (...args: unknown[]) => deleteAuthUserForCleanup(...args),
}));

vi.mock("@/services/gym-settings", () => ({
  getGymSettings: (...args: unknown[]) => getGymSettings(...args),
}));

vi.mock("@/services/plans", () => ({ listPlans: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/services/session", () => ({ mapAndLog: vi.fn() }));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}(${JSON.stringify(vars)})` : key),
  })),
}));

import { confirmCsvImport, type ValidatedCsvRow } from "./csvImport";

function makeRows(n: number): ValidatedCsvRow[] {
  return Array.from({ length: n }, (_, i) => ({
    row: i + 2,
    name: `Member ${i + 1}`,
    phone: `+23768081104${i}`,
    planId: "plan-1",
    planName: "Monthly",
    joinDate: "2026-01-15",
    subscriptionStatus: "active" as const,
    expiryDate: "2099-02-14",
  }));
}

function setFee(fee: number) {
  getGymSettings.mockResolvedValue({ data: { registrationFee: fee }, error: null });
}

describe("confirmCsvImport (Story 18.5)", () => {
  beforeEach(() => {
    [memberCountForGym, provisionMemberRow, logMemberChange, deleteMemberForCleanup, deleteAuthUserForCleanup, getGymSettings].forEach(
      (m) => m.mockReset(),
    );
    memberCountForGym.mockResolvedValue({ count: 0, cap: 100, error: null });
    let n = 0;
    provisionMemberRow.mockImplementation(async () => {
      n += 1;
      return { data: { id: `member-${n}`, userId: `user-${n}`, authUserCreated: true }, error: null };
    });
    logMemberChange.mockResolvedValue({ error: null });
    deleteMemberForCleanup.mockResolvedValue(undefined);
    deleteAuthUserForCleanup.mockResolvedValue(undefined);
    setFee(5000);
  });

  it("fee above 0: every row is provisioned with importExempt and no payment is written", async () => {
    const result = await confirmCsvImport(makeRows(3));

    expect(result).toEqual({ data: { count: 3 }, error: null });
    expect(provisionMemberRow).toHaveBeenCalledTimes(3);
    for (const call of provisionMemberRow.mock.calls) {
      expect(call[0]).toMatchObject({ importExempt: true, planId: "plan-1", subscriptionStatus: "active" });
    }
  });

  it("fee above 0: each member_created audit entry carries registration_fee_exempt", async () => {
    await confirmCsvImport(makeRows(2));

    expect(logMemberChange).toHaveBeenCalledTimes(2);
    expect(logMemberChange).toHaveBeenNthCalledWith(1, "member_created", "member-1", {
      name: "Member 1",
      phone: "+237680811040",
      plan_id: "plan-1",
      join_date: "2026-01-15",
      via: "csv_import",
      registration_fee_exempt: true,
    });
    for (const call of logMemberChange.mock.calls) {
      expect(call[2]).toHaveProperty("registration_fee_exempt", true);
    }
  });

  it("fee 0: importExempt is not passed and the audit metadata is exactly what it was", async () => {
    setFee(0);

    const result = await confirmCsvImport(makeRows(2));

    expect(result).toEqual({ data: { count: 2 }, error: null });
    for (const call of provisionMemberRow.mock.calls) {
      expect(call[0]).not.toHaveProperty("importExempt");
    }
    expect(logMemberChange).toHaveBeenNthCalledWith(1, "member_created", "member-1", {
      name: "Member 1",
      phone: "+237680811040",
      plan_id: "plan-1",
      join_date: "2026-01-15",
      via: "csv_import",
    });
  });

  it("fee above 0, failure on row 3 of 3: all earlier rows are rolled back and nothing is audited", async () => {
    let n = 0;
    provisionMemberRow.mockImplementation(async () => {
      n += 1;
      if (n === 3) return { data: null, error: { code: "unknown", message: "boom" } };
      return { data: { id: `member-${n}`, userId: `user-${n}`, authUserCreated: n === 1 }, error: null };
    });

    const result = await confirmCsvImport(makeRows(3));

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("csv_import_failed");
    // Reverse order, each earlier member deleted; only the freshly created auth user is removed.
    expect(deleteMemberForCleanup.mock.calls.map((c) => c[0])).toEqual(["member-2", "member-1"]);
    expect(deleteAuthUserForCleanup.mock.calls.map((c) => c[0])).toEqual(["user-1"]);
    expect(logMemberChange).not.toHaveBeenCalled();
  });

  it("an unreadable fee stops the import before any write", async () => {
    getGymSettings.mockResolvedValue({ data: null, error: { code: "not_found", message: "gym" } });

    const result = await confirmCsvImport(makeRows(2));

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("not_found");
    expect(provisionMemberRow).not.toHaveBeenCalled();
  });

  it("the member cap still fails fast before the fee is even read", async () => {
    memberCountForGym.mockResolvedValue({ count: 99, cap: 100, error: null });

    const result = await confirmCsvImport(makeRows(5));

    expect(result.error?.code).toBe("member_cap_reached");
    expect(provisionMemberRow).not.toHaveBeenCalled();
  });
});
