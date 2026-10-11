/**
 * `validateCsvImport` reads a phone cell written without a country code against
 * the gym's own country (gyms.country, 0105), and keeps a number that carries
 * its own "+". Duplicate and already-a-member checks run on the RESOLVED number,
 * so "670123456" and "+237670123456" in one file are the same person.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getGymSettings = vi.fn();
const listPlans = vi.fn();
const existingPhones = vi.fn();

vi.mock("@/services/gym-settings", () => ({
  getGymSettings: (...args: unknown[]) => getGymSettings(...args),
}));
vi.mock("@/services/plans", () => ({ listPlans: (...args: unknown[]) => listPlans(...args) }));
vi.mock("@/services/members", () => ({
  memberCountForGym: vi.fn(),
  provisionMemberRow: vi.fn(),
  logMemberChange: vi.fn(),
  deleteMemberForCleanup: vi.fn(),
  deleteAuthUserForCleanup: vi.fn(),
}));
vi.mock("@/services/session", () => ({
  mapAndLog: vi.fn(async (e: { message: string }) => ({ code: "x", message: e.message })),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      in: (_col: string, phones: string[]) => existingPhones(phones),
    };
    return {
      auth: { getClaims: async () => ({ data: { claims: { gym_id: "gym-1" } }, error: null }) },
      from: () => chain,
    };
  }),
}));
vi.mock("@/lib/i18n/get-request-locale", () => ({ getRequestLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/i18n/get-server-translation", () => ({
  getServerTranslation: vi.fn(async () => ({
    t: (key: string) => key,
  })),
}));

import { validateCsvImport } from "./csvImport";

function row(rowNumber: number, phone: string) {
  return {
    row: rowNumber,
    malformed: false,
    fields: {
      member_name: `Member ${rowNumber}`,
      phone,
      plan_type: "Monthly",
      join_date: "2026-01-15",
      subscription_status: "active",
      expiry_date: "2099-02-14",
    },
  };
}

describe("validateCsvImport phone normalization", () => {
  beforeEach(() => {
    getGymSettings.mockReset();
    listPlans.mockReset();
    existingPhones.mockReset();
    getGymSettings.mockResolvedValue({ data: { country: "CM", registrationFee: 0 }, error: null });
    listPlans.mockResolvedValue({ data: [{ id: "plan-1", name: "Monthly" }], error: null });
    existingPhones.mockResolvedValue({ data: [], error: null });
  });

  it("reads local-format numbers against the gym's country and keeps +numbers as written", async () => {
    const result = await validateCsvImport([
      row(2, "670123456"),
      row(3, "6 71-23 45 67"),
      row(4, "+2348031234567"),
      row(5, "00237672345678"),
    ]);

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.rows.map((r) => r.phone)).toEqual([
      "+237670123456",
      "+237671234567",
      "+2348031234567",
      "+237672345678",
    ]);
  });

  it("uses the gym's own country, not a hardcoded one", async () => {
    getGymSettings.mockResolvedValue({ data: { country: "NG", registrationFee: 0 }, error: null });

    const result = await validateCsvImport([row(2, "8031234567")]);

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.rows[0]?.phone).toBe("+2348031234567");
  });

  it("looks up already-existing members by the resolved number", async () => {
    await validateCsvImport([row(2, "670123456")]);

    expect(existingPhones).toHaveBeenCalledWith(["+237670123456"]);
  });

  it("flags a local and an international spelling of the same number as duplicates", async () => {
    const result = await validateCsvImport([row(2, "670123456"), row(3, "+237670123456")]);

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors).toEqual([
      expect.objectContaining({ row: 3, column: "phone" }),
    ]);
  });

  it("still rejects a number that is not valid in the gym's country", async () => {
    const result = await validateCsvImport([row(2, "12345")]);

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors[0]).toMatchObject({ row: 2, column: "phone" });
  });

  it("stops without guessing when the gym's country cannot be read", async () => {
    getGymSettings.mockResolvedValue({ data: null, error: { code: "not_found", message: "Gym not found" } });

    const result = await validateCsvImport([row(2, "670123456")]);

    expect(result).toEqual({
      valid: false,
      errors: [{ row: 0, column: "file", message: "Gym not found" }],
    });
    expect(listPlans).not.toHaveBeenCalled();
  });
});
