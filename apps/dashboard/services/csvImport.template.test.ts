/**
 * Story 26.2: one CSV template. Only member_name and phone are required;
 * each row decides for itself whether it has a plan. Synthetic rows only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CSV_REQUIRED_COLUMNS, CSV_TEMPLATE_COLUMNS, csvMemberRowSchema } from "@gymos/types";

const getGymSettings = vi.fn();
const listPlans = vi.fn();
const existingPhones = vi.fn();

vi.mock("@/services/gym-settings", () => ({ getGymSettings: (...a: unknown[]) => getGymSettings(...a) }));
vi.mock("@/services/plans", () => ({ listPlans: (...a: unknown[]) => listPlans(...a) }));
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
      in: (_c: string, phones: string[]) => existingPhones(phones),
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
    // Echoes interpolation variables when there are any, so a test can see which columns or values a message names.
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}(${JSON.stringify(vars)})` : key),
  })),
}));

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCsvRows } from "@/lib/csv";
import { mapCsvRows, validateCsvImport } from "./csvImport";

const NO_PLAN = { member_name: "Ada Test", phone: "+237670000001" };
function raw(row: number, fields: Record<string, string>) {
  return { row, malformed: false, fields };
}
const PLAN_ROW = {
  member_name: "Plan Person",
  phone: "+237670000002",
  plan_type: "Monthly",
  join_date: "2026-01-15",
  subscription_status: "active",
  expiry_date: "2099-02-14",
};

describe("template columns", () => {
  it("download header is the nine columns and only name and phone are required", () => {
    expect(CSV_TEMPLATE_COLUMNS.join(",")).toBe(
      "member_name,phone,plan_type,join_date,subscription_status,expiry_date,birth_year,profession,neighborhood",
    );
    expect([...CSV_REQUIRED_COLUMNS]).toEqual(["member_name", "phone"]);
  });
});

describe("csvMemberRowSchema", () => {
  const base = { memberName: "Ada", phone: "+237670000001" };
  const parse = (extra: Record<string, unknown>) => csvMemberRowSchema.safeParse({ ...base, ...extra });
  const issueFor = (r: ReturnType<typeof parse>, field: string) =>
    !r.success && r.error.issues.some((i) => i.path[0] === field);

  it("accepts name and phone only", () => {
    const r = parse({});
    expect(r.success).toBe(true);
  });
  it("accepts all blank optional cells", () => {
    expect(
      parse({ planName: "", joinDate: "", subscriptionStatus: "", expiryDate: "", birthYear: "", profession: "", neighborhood: "" })
        .success,
    ).toBe(true);
  });
  it("accepts a full plan row", () => {
    expect(parse({ planName: "Monthly", joinDate: "2026-01-15", subscriptionStatus: "Active", expiryDate: "2099-02-14" }).success).toBe(true);
  });
  it("a whitespace-only plan cell is a no-plan row, so a status beside it is the error", () => {
    expect(parse({ planName: "   " }).success).toBe(true);
    const withStatus = parse({ planName: "   ", subscriptionStatus: "active" });
    expect(withStatus.success).toBe(false);
    expect(withStatus.success ? [] : withStatus.error.issues.map((i) => i.path.join("."))).toContain("subscriptionStatus");
  });
  it("a plan row still needs join date and status", () => {
    const r = parse({ planName: "Monthly" });
    expect(issueFor(r, "joinDate")).toBe(true);
    expect(issueFor(r, "subscriptionStatus")).toBe(true);
  });
  it("status or expiry without a plan is an error", () => {
    expect(issueFor(parse({ subscriptionStatus: "active" }), "subscriptionStatus")).toBe(true);
    expect(issueFor(parse({ expiryDate: "2099-01-01" }), "expiryDate")).toBe(true);
  });
  it("join date on a no-plan row: valid past ok, future refused", () => {
    expect(parse({ joinDate: "2020-01-01" }).success).toBe(true);
    expect(issueFor(parse({ joinDate: "2999-01-01" }), "joinDate")).toBe(true);
  });
  it("birth year bounds", () => {
    expect(parse({ birthYear: "1990" }).success).toBe(true);
    expect(issueFor(parse({ birthYear: "1850" }), "birthYear")).toBe(true);
    expect(issueFor(parse({ birthYear: "2999" }), "birthYear")).toBe(true);
    expect(issueFor(parse({ birthYear: "abc" }), "birthYear")).toBe(true);
  });
  it("profession and neighborhood at most 120 characters", () => {
    expect(parse({ profession: "x".repeat(120) }).success).toBe(true);
    expect(issueFor(parse({ profession: "x".repeat(121) }), "profession")).toBe(true);
    expect(issueFor(parse({ neighborhood: "x".repeat(121) }), "neighborhood")).toBe(true);
  });
});

describe("QA sample files (Story 26.2)", () => {
  const dir = join(__dirname, "..", "..", "..", "scripts", "epic18-qa");
  it.each([
    ["import-members-only-sample.csv", 2],
    ["import-mixed-sample.csv", 3],
    ["import-sample.csv", 2],
  ])("%s has a valid header and %i data rows", async (file, rows) => {
    const result = await mapCsvRows(parseCsvRows(readFileSync(join(dir, file), "utf8")));
    expect(result.error).toBeNull();
    expect(result.data?.rows).toHaveLength(rows);
  });
});

describe("mapCsvRows header check", () => {
  it("accepts name and phone only, any case and order", async () => {
    const r = await mapCsvRows([[" PHONE ", "Member_Name"], ["+237670000001", "Ada"]]);
    expect(r.error).toBeNull();
    expect(r.data?.rows[0].fields.member_name).toBe("Ada");
    expect(r.data?.rows[0].fields.plan_type).toBe("");
  });
  it("accepts the old six-column header", async () => {
    const r = await mapCsvRows([
      ["member_name", "phone", "plan_type", "join_date", "subscription_status", "expiry_date"],
      ["Ada", "+237670000001", "Monthly", "2026-01-15", "active", "2099-02-14"],
    ]);
    expect(r.error).toBeNull();
  });
  it("refuses a missing phone, naming only phone (never the optional columns)", async () => {
    const r = await mapCsvRows([["member_name"], ["Ada"]]);
    expect(r.error?.code).toBe("csv_invalid_template");
    expect(r.error?.message).toContain('"columns":"phone"');
    expect(r.error?.message).not.toContain("plan_type");
    expect(r.error?.message).not.toContain("birth_year");
  });
  it("names both required columns when both are missing", async () => {
    const r = await mapCsvRows([["plan_type"], ["Monthly"]]);
    expect(r.error?.code).toBe("csv_invalid_template");
    expect(r.error?.message).toContain('"columns":"member_name, phone"');
  });
  it("refuses a duplicated known column and ignores unknown ones", async () => {
    expect((await mapCsvRows([["member_name", "phone", "phone"], ["a", "b", "c"]])).error?.code).toBe("csv_invalid_template");
    expect((await mapCsvRows([["member_name", "phone", "color"], ["a", "b", "c"]])).error).toBeNull();
  });
  it("refuses more than 1000 rows", async () => {
    const rows = [["member_name", "phone"], ...Array.from({ length: 1001 }, (_, i) => [`M${i}`, `+2376700${i}`])];
    expect((await mapCsvRows(rows)).error?.code).toBe("csv_too_many_rows");
  });
});

describe("validateCsvImport (one template)", () => {
  beforeEach(() => {
    getGymSettings.mockReset();
    listPlans.mockReset();
    existingPhones.mockReset();
    getGymSettings.mockResolvedValue({ data: { country: "CM", registrationFee: 2000 }, error: null });
    listPlans.mockResolvedValue({ data: [{ id: "plan-1", name: "Monthly", planType: "monthly" }], error: null });
    existingPhones.mockResolvedValue({ data: [], error: null });
  });

  it("mixed file: each row follows its own rules, profile fields kept, no flag in a fee gym", async () => {
    const r = await validateCsvImport([
      raw(2, PLAN_ROW),
      raw(3, { ...NO_PLAN, birth_year: "1990", profession: "Baker", neighborhood: "Bonanjo" }),
    ]);
    expect(r.valid).toBe(true);
    if (!r.valid) return;
    expect(r.rows[0].planId).toBe("plan-1");
    expect(r.rows[1]).toMatchObject({ planId: null, subscriptionStatus: null, birthYear: 1990, profession: "Baker" });
    expect(r.rows[1].joinDate).toBe(new Date().toISOString().slice(0, 10));
    expect(r.feeFreeWithoutPlan).toBe(false);
  });

  it("fee 0 gym with a no-plan row flags it; with only plan rows it does not", async () => {
    getGymSettings.mockResolvedValue({ data: { country: "CM", registrationFee: 0 }, error: null });
    const flagged = await validateCsvImport([raw(2, NO_PLAN)]);
    expect(flagged.valid && flagged.feeFreeWithoutPlan).toBe(true);
    const clean = await validateCsvImport([raw(2, PLAN_ROW)]);
    expect(clean.valid && clean.feeFreeWithoutPlan).toBe(false);
  });

  it("status without a plan, bad optional values, duplicate and existing phones are row errors", async () => {
    existingPhones.mockResolvedValue({ data: [{ phone: "+237670000009" }], error: null });
    const r = await validateCsvImport([
      raw(2, { ...NO_PLAN, subscription_status: "active" }),
      raw(3, { member_name: "B", phone: "+237670000003", birth_year: "1850" }),
      raw(4, { member_name: "C", phone: "+237670000004", profession: "x".repeat(121) }),
      raw(5, { member_name: "D", phone: "+237670000005" }),
      raw(6, { member_name: "E", phone: "+237670000005" }),
      raw(7, { member_name: "F", phone: "+237670000009" }),
    ]);
    expect(r.valid).toBe(false);
    if (r.valid) return;
    const cols = r.errors.map((e) => `${e.row}:${e.column}`);
    expect(cols).toEqual(["2:subscription_status", "3:birth_year", "4:profession", "6:phone", "7:phone"]);
  });

  it("an unknown plan still fails a plan row", async () => {
    const r = await validateCsvImport([raw(2, { ...PLAN_ROW, plan_type: "Nope" })]);
    expect(r.valid).toBe(false);
  });
});
