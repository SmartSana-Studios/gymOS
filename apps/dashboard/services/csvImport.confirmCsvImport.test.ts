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
    birthYear: null,
    profession: null,
    neighborhood: null,
  }));
}

function makeNoPlanRows(n: number): ValidatedCsvRow[] {
  return Array.from({ length: n }, (_, i) => ({
    row: i + 2,
    name: `Person ${i + 1}`,
    phone: `+23768091104${i}`,
    planId: null,
    planName: null,
    joinDate: "2026-10-23",
    subscriptionStatus: null,
    expiryDate: null,
    birthYear: 1990,
    profession: "Baker",
    neighborhood: "Bonanjo",
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

    expect(result).toEqual({ data: { count: 3, awaiting: 0 }, error: null });
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

    expect(result).toEqual({ data: { count: 2, awaiting: 0 }, error: null });
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

  // Story 26.2: one template, each row decides for itself.
  it("fee gym: a no-plan row is not exempt, has no plan fields, carries the profile fields and awaits", async () => {
    const result = await confirmCsvImport(makeNoPlanRows(3));

    expect(result).toEqual({ data: { count: 3, awaiting: 3 }, error: null });
    for (const call of provisionMemberRow.mock.calls) {
      expect(call[0]).not.toHaveProperty("importExempt");
      expect(call[0]).not.toHaveProperty("planId");
      expect(call[0]).not.toHaveProperty("subscriptionStatus");
      expect(call[0]).toMatchObject({ birthYear: 1990, profession: "Baker", neighborhood: "Bonanjo" });
    }
  });

  it("fee gym: the no-plan audit has no name and no phone", async () => {
    await confirmCsvImport(makeNoPlanRows(2));

    for (const call of logMemberChange.mock.calls) {
      expect(call[2]).toEqual({ join_date: "2026-10-23", via: "csv_import", awaiting_registration_fee: true });
      expect(call[2]).not.toHaveProperty("name");
      expect(call[2]).not.toHaveProperty("phone");
    }
  });

  it("fee gym, mixed file: the plan row is exempt and audited as before, the other awaits", async () => {
    const rows = [...makeRows(1), ...makeNoPlanRows(1)];

    const result = await confirmCsvImport(rows);

    expect(result).toEqual({ data: { count: 2, awaiting: 1 }, error: null });
    expect(provisionMemberRow.mock.calls[0][0]).toMatchObject({ importExempt: true, planId: "plan-1" });
    expect(provisionMemberRow.mock.calls[1][0]).not.toHaveProperty("importExempt");
    expect(logMemberChange.mock.calls[0][2]).toMatchObject({ name: "Member 1", registration_fee_exempt: true });
    expect(logMemberChange.mock.calls[1][2]).not.toHaveProperty("name");
  });

  it("fee 0: no-plan rows are refused without the acknowledgement and nothing is written", async () => {
    setFee(0);

    for (const options of [undefined, {}, { acknowledgeNoFee: false }, { acknowledgeNoFee: "true" as unknown as boolean }]) {
      const result = await confirmCsvImport(makeNoPlanRows(2), options);
      expect(result.data).toBeNull();
      expect(result.error?.code).toBe("csv_fee_ack_required");
    }
    expect(provisionMemberRow).not.toHaveBeenCalled();
    expect(logMemberChange).not.toHaveBeenCalled();
  });

  it("fee 0: acknowledged no-plan rows are imported, none awaiting", async () => {
    setFee(0);

    const result = await confirmCsvImport(makeNoPlanRows(2), { acknowledgeNoFee: true });

    expect(result).toEqual({ data: { count: 2, awaiting: 0 }, error: null });
    expect(provisionMemberRow).toHaveBeenCalledTimes(2);
    expect(logMemberChange.mock.calls[0][2]).toEqual({
      join_date: "2026-10-23",
      via: "csv_import",
      awaiting_registration_fee: false,
    });
  });

  it("fee 0: plan-only files need no acknowledgement", async () => {
    setFee(0);
    const result = await confirmCsvImport(makeRows(1));
    expect(result.error).toBeNull();
  });

  it("no-plan rows over the cap: refused before any write", async () => {
    memberCountForGym.mockResolvedValue({ count: 99, cap: 100, error: null });
    const result = await confirmCsvImport(makeNoPlanRows(2));
    expect(result.error?.code).toBe("member_cap_reached");
    expect(provisionMemberRow).not.toHaveBeenCalled();
  });

  it("no-plan rows, failure on row 3 of 3: earlier rows rolled back and nothing audited", async () => {
    let n = 0;
    provisionMemberRow.mockImplementation(async () => {
      n += 1;
      if (n === 3) return { data: null, error: { code: "unknown", message: "boom" } };
      return { data: { id: `member-${n}`, userId: `user-${n}`, authUserCreated: true }, error: null };
    });

    const result = await confirmCsvImport(makeNoPlanRows(3));

    expect(result.error?.code).toBe("csv_import_failed");
    expect(deleteMemberForCleanup.mock.calls.map((c) => c[0])).toEqual(["member-2", "member-1"]);
    expect(logMemberChange).not.toHaveBeenCalled();
  });
});
